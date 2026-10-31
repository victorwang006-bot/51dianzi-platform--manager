import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "./ui/dialog";
import { Maximize2, Minus, Plus, RotateCcw, RotateCw, X } from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";

const MIN_SCALE = 1;
const MAX_SCALE = 4;
const SCALE_STEP = 0.25;

interface Point {
  x: number;
  y: number;
}

export interface ImageLightboxProps {
  open: boolean;
  src: string | null;
  alt: string;
  onOpenChange: (open: boolean) => void;
  /** Returns a newly authorized URL after a signed image URL has expired. */
  onRequestRefresh?: () => Promise<string | null>;
  /** Allows legacy callers to retain a stable viewport test selector. */
  viewportTestId?: string;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function pointerDistance(points: Point[]) {
  if (points.length < 2) return 0;
  return Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
}

function normalizeRotation(rotation: number) {
  return ((rotation % 360) + 360) % 360;
}

/**
 * Full-screen image preview shared by chat and forum attachments. It renders the
 * original URL directly; rotation, zoom and panning exist only in the browser.
 */
export default function ImageLightbox({
  open,
  src,
  alt,
  onOpenChange,
  onRequestRefresh,
  viewportTestId = "image-lightbox-viewport",
}: ImageLightboxProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const pointersRef = useRef(new Map<number, Point>());
  const dragOriginRef = useRef<{ pointer: Point; position: Point } | null>(null);
  const pinchOriginRef = useRef<{ distance: number; scale: number } | null>(null);
  const refreshAttemptedRef = useRef(false);
  const [displaySrc, setDisplaySrc] = useState<string | null>(src);
  const [scale, setScale] = useState(MIN_SCALE);
  const [position, setPosition] = useState<Point>({ x: 0, y: 0 });
  const [rotation, setRotation] = useState(0);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  const resetView = useCallback(() => {
    setScale(MIN_SCALE);
    setPosition({ x: 0, y: 0 });
    pointersRef.current.clear();
    dragOriginRef.current = null;
    pinchOriginRef.current = null;
  }, []);

  useEffect(() => {
    if (!open) return;
    resetView();
    setRotation(0);
    setLoading(false);
    setFailed(false);
    refreshAttemptedRef.current = false;
  }, [open, resetView]);

  useEffect(() => {
    if (!open) return;
    setDisplaySrc(src);
    setFailed(false);
  }, [open, src]);

  const constrainPosition = useCallback((next: Point, nextScale = scale) => {
    const viewport = viewportRef.current;
    if (!viewport || nextScale <= MIN_SCALE) return { x: 0, y: 0 };
    const maxX = viewport.clientWidth * (nextScale - 1) / 2;
    const maxY = viewport.clientHeight * (nextScale - 1) / 2;
    return {
      x: clamp(next.x, -maxX, maxX),
      y: clamp(next.y, -maxY, maxY),
    };
  }, [scale]);

  const applyScale = useCallback((value: number) => {
    const nextScale = clamp(value, MIN_SCALE, MAX_SCALE);
    setScale(nextScale);
    setPosition(current => constrainPosition(current, nextScale));
  }, [constrainPosition]);

  const rotate = useCallback((amount: number) => {
    // A 90-degree turn changes the bounds. Resetting zoom and pan guarantees
    // the newly oriented original starts centered and fitted to the viewport.
    resetView();
    setRotation(current => normalizeRotation(current + amount));
  }, [resetView]);

  const handleWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    applyScale(scale + (event.deltaY < 0 ? SCALE_STEP : -SCALE_STEP));
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const points = Array.from(pointersRef.current.values());
    if (points.length === 2) {
      pinchOriginRef.current = { distance: pointerDistance(points), scale };
      dragOriginRef.current = null;
    } else if (points.length === 1 && scale > MIN_SCALE) {
      dragOriginRef.current = {
        pointer: points[0],
        position,
      };
    }
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!pointersRef.current.has(event.pointerId)) return;
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const points = Array.from(pointersRef.current.values());
    if (points.length >= 2 && pinchOriginRef.current?.distance) {
      const nextScale = clamp(
        pinchOriginRef.current.scale * pointerDistance(points) / pinchOriginRef.current.distance,
        MIN_SCALE,
        MAX_SCALE,
      );
      setScale(nextScale);
      setPosition(current => constrainPosition(current, nextScale));
      return;
    }
    const dragOrigin = dragOriginRef.current;
    if (points.length === 1 && dragOrigin && scale > MIN_SCALE) {
      setPosition(constrainPosition({
        x: dragOrigin.position.x + points[0].x - dragOrigin.pointer.x,
        y: dragOrigin.position.y + points[0].y - dragOrigin.pointer.y,
      }));
    }
  };

  const handlePointerEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    pointersRef.current.delete(event.pointerId);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    const points = Array.from(pointersRef.current.values());
    pinchOriginRef.current = null;
    dragOriginRef.current = points.length === 1 && scale > MIN_SCALE
      ? { pointer: points[0], position }
      : null;
  };

  const handleImageError = async () => {
    if (!onRequestRefresh || refreshAttemptedRef.current) {
      setLoading(false);
      setFailed(true);
      return;
    }
    refreshAttemptedRef.current = true;
    setLoading(true);
    const refreshedUrl = await onRequestRefresh();
    setLoading(false);
    if (refreshedUrl) {
      setDisplaySrc(refreshedUrl);
    } else {
      setFailed(true);
    }
  };

  const quarterTurn = rotation === 90 || rotation === 270;
  const imageBoundsClass = quarterTurn
    ? "max-h-[96vw] max-w-[calc(100dvh-7rem)]"
    : "max-h-[calc(100dvh-7rem)] max-w-[96vw]";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        aria-label="图片预览"
        className="h-[100dvh] w-screen max-w-none gap-0 overflow-hidden rounded-none border-0 bg-slate-950/96 p-0 shadow-none"
      >
        <DialogTitle className="sr-only">图片预览</DialogTitle>
        <DialogDescription className="sr-only">可使用滚轮、双击或下方按钮缩放图片，放大后可拖动查看细节，也可旋转图片。</DialogDescription>

        <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start justify-between gap-4 bg-gradient-to-b from-black/65 to-transparent px-4 pb-10 pt-[max(1rem,env(safe-area-inset-top))] sm:px-6">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-white">{alt || "图片"}</p>
            <p className="mt-1 text-[11px] text-white/65">滚轮或双指缩放，放大后拖动查看</p>
          </div>
          <button
            type="button"
            aria-label="关闭图片预览"
            title="关闭"
            onClick={() => onOpenChange(false)}
            className="pointer-events-auto grid h-10 w-10 shrink-0 place-items-center rounded-full bg-black/40 text-white transition hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div
          ref={viewportRef}
          data-testid={viewportTestId}
          className={`relative flex h-full w-full select-none items-center justify-center overflow-hidden ${scale > MIN_SCALE ? "cursor-grab active:cursor-grabbing" : "cursor-zoom-in"}`}
          style={{ touchAction: "none" }}
          onWheel={handleWheel}
          onDoubleClick={() => applyScale(scale > MIN_SCALE ? MIN_SCALE : 2)}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerEnd}
          onPointerCancel={handlePointerEnd}
        >
          {displaySrc && !failed ? (
            <img
              src={displaySrc}
              alt={alt || "图片"}
              draggable={false}
              onLoad={() => {
                setLoading(false);
                setFailed(false);
              }}
              onError={() => void handleImageError()}
              className={`${imageBoundsClass} object-contain will-change-transform`}
              style={{
                transform: `translate3d(${position.x}px, ${position.y}px, 0) scale(${scale}) rotate(${rotation}deg)`,
                transition: pointersRef.current.size ? "none" : "transform 180ms cubic-bezier(0.23, 1, 0.32, 1)",
              }}
            />
          ) : null}
          {loading ? (
            <div className="absolute inset-0 grid place-items-center text-sm text-white/75">正在刷新图片…</div>
          ) : null}
          {failed ? (
            <div className="rounded-xl border border-white/10 bg-white/5 px-6 py-5 text-sm text-white/75">图片已失效或暂时无法访问</div>
          ) : null}
        </div>

        <div className="absolute inset-x-0 bottom-[max(1rem,env(safe-area-inset-bottom))] z-20 flex justify-center px-4">
          <div className="flex items-center gap-1 rounded-full border border-white/10 bg-black/65 p-1.5 text-white shadow-2xl backdrop-blur">
            <button
              type="button"
              aria-label="缩小图片"
              title="缩小"
              disabled={scale <= MIN_SCALE}
              onClick={() => applyScale(scale - SCALE_STEP)}
              className="grid h-9 w-9 place-items-center rounded-full hover:bg-white/15 disabled:opacity-35"
            >
              <Minus className="h-4 w-4" />
            </button>
            <output aria-label="当前缩放比例" className="w-14 text-center text-xs tabular-nums">{Math.round(scale * 100)}%</output>
            <button
              type="button"
              aria-label="放大图片"
              title="放大"
              disabled={scale >= MAX_SCALE}
              onClick={() => applyScale(scale + SCALE_STEP)}
              className="grid h-9 w-9 place-items-center rounded-full hover:bg-white/15 disabled:opacity-35"
            >
              <Plus className="h-4 w-4" />
            </button>
            <span className="mx-1 h-5 w-px bg-white/15" aria-hidden="true" />
            <button
              type="button"
              aria-label="左转90度"
              title="左转90度"
              onClick={() => rotate(-90)}
              className="grid h-9 w-9 place-items-center rounded-full hover:bg-white/15"
            >
              <RotateCcw className="h-4 w-4" />
            </button>
            <output aria-label="当前旋转角度" className="w-8 text-center text-xs tabular-nums">{rotation}°</output>
            <button
              type="button"
              aria-label="右转90度"
              title="右转90度"
              onClick={() => rotate(90)}
              className="grid h-9 w-9 place-items-center rounded-full hover:bg-white/15"
            >
              <RotateCw className="h-4 w-4" />
            </button>
            <span className="mx-1 h-5 w-px bg-white/15" aria-hidden="true" />
            <button
              type="button"
              aria-label="适应屏幕"
              title="适应屏幕"
              onClick={resetView}
              className="grid h-9 w-9 place-items-center rounded-full hover:bg-white/15"
            >
              {scale === MIN_SCALE ? <Maximize2 className="h-4 w-4" /> : <RotateCcw className="h-4 w-4" />}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
