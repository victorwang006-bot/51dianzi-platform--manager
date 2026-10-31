import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type WheelEvent,
} from "react";
import type { CompanyAvatarCrop } from "../lib/companyPhotoImage";
import {
  DEFAULT_COMPANY_PHOTO_CROP,
  companyPhotoCropStyle,
  getCompanyPhotoCropGeometry,
  normalizeCompanyPhotoCrop,
  panCompanyPhotoCrop,
  pinchCompanyPhotoCrop,
  zoomCompanyPhotoCropAtPoint,
  type CompanyPhotoCropPoint,
} from "../lib/companyPhotoCrop";

export type CompanyPhotoCropEditorTarget = "home" | "search";
export type CompanyPhotoCropEditorMode = "logo" | "photo";

export interface CompanyPhotoCropEditorProps {
  src: string;
  target: CompanyPhotoCropEditorTarget;
  mode: CompanyPhotoCropEditorMode;
  crop: CompanyAvatarCrop;
  disabled: boolean;
  onChange: (crop: CompanyAvatarCrop) => void;
  onImageError?: () => void;
  /** True only after the current src has a valid natural image size. */
  onReadyChange?: (ready: boolean) => void;
}

type ImageState = {
  src: string;
  width: number;
  height: number;
  failed: boolean;
};

type Gesture =
  | { type: "pan"; crop: CompanyAvatarCrop; point: CompanyPhotoCropPoint }
  | {
    type: "pinch";
    crop: CompanyAvatarCrop;
    first: CompanyPhotoCropPoint;
    second: CompanyPhotoCropPoint;
  };

const KEYBOARD_PAN_PIXELS = 10;
const RESET_CROP: CompanyAvatarCrop = { ...DEFAULT_COMPANY_PHOTO_CROP };
const LOGO_STYLE: CSSProperties = { objectPosition: "center", transform: "none", transformOrigin: "center" };

function cropEquals(left: CompanyAvatarCrop, right: CompanyAvatarCrop) {
  return left.zoom === right.zoom && left.offsetX === right.offsetX && left.offsetY === right.offsetY;
}

/**
 * A controlled crop surface only. Display-mode selection and save/confirm UI
 * belong to the parent, so one editor can be reused by both photo targets.
 */
export function CompanyPhotoCropEditor({
  src,
  target,
  mode,
  crop,
  disabled,
  onChange,
  onImageError,
  onReadyChange,
}: CompanyPhotoCropEditorProps) {
  const frameRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const pointersRef = useRef(new Map<number, CompanyPhotoCropPoint>());
  const gestureRef = useRef<Gesture | null>(null);
  const cropRef = useRef(normalizeCompanyPhotoCrop(crop));
  const onReadyChangeRef = useRef(onReadyChange);
  const [imageState, setImageState] = useState<ImageState>({ src: "", width: 0, height: 0, failed: false });

  const normalizedCrop = normalizeCompanyPhotoCrop(crop);
  cropRef.current = normalizedCrop;
  onReadyChangeRef.current = onReadyChange;
  const imageReady = imageState.src === src && imageState.width > 0 && imageState.height > 0 && !imageState.failed;
  const canEdit = mode === "photo" && !disabled && imageReady;
  const aspectRatio = target === "home" ? "16 / 9" : "4 / 3";

  const markImageReady = useCallback((naturalWidth: number, naturalHeight: number) => {
    if (naturalWidth <= 0 || naturalHeight <= 0) {
      setImageState({ src, width: 0, height: 0, failed: true });
      onReadyChangeRef.current?.(false);
      return;
    }
    setImageState({ src, width: naturalWidth, height: naturalHeight, failed: false });
    onReadyChangeRef.current?.(true);
  }, [src]);

  useEffect(() => {
    pointersRef.current.clear();
    gestureRef.current = null;
    setImageState({ src: "", width: 0, height: 0, failed: false });
    onReadyChangeRef.current?.(false);
    // A cached image can complete before a passive effect is run. Reading the
    // mounted element here compensates for that event/effect ordering.
    const image = imageRef.current;
    if (src && image?.complete) markImageReady(image.naturalWidth, image.naturalHeight);
  }, [src, markImageReady]);

  useEffect(() => {
    if (!canEdit) {
      pointersRef.current.clear();
      gestureRef.current = null;
    }
  }, [canEdit]);

  const emit = useCallback((nextCrop: CompanyAvatarCrop) => {
    const normalized = normalizeCompanyPhotoCrop(nextCrop);
    if (cropEquals(cropRef.current, normalized)) return;
    cropRef.current = normalized;
    onChange(normalized);
  }, [onChange]);

  const framePoint = useCallback((clientX: number, clientY: number): CompanyPhotoCropPoint | null => {
    const rect = frameRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) return null;
    return { x: clientX - rect.left, y: clientY - rect.top };
  }, []);

  const geometryFor = useCallback((value: CompanyAvatarCrop) => {
    const rect = frameRef.current?.getBoundingClientRect();
    if (!rect || !imageReady || rect.width <= 0 || rect.height <= 0) return null;
    return getCompanyPhotoCropGeometry(imageState.width, imageState.height, rect.width, rect.height, value.zoom);
  }, [imageReady, imageState.height, imageState.width]);

  const beginGesture = useCallback(() => {
    const points = Array.from(pointersRef.current.values());
    if (points.length >= 2) {
      gestureRef.current = {
        type: "pinch",
        crop: { ...cropRef.current },
        first: points[0],
        second: points[1],
      };
    } else if (points.length === 1) {
      gestureRef.current = { type: "pan", crop: { ...cropRef.current }, point: points[0] };
    } else {
      gestureRef.current = null;
    }
  }, []);

  const clearPointer = useCallback((pointerId: number, clearAll = false) => {
    if (clearAll) pointersRef.current.clear();
    else pointersRef.current.delete(pointerId);
    beginGesture();
  }, [beginGesture]);

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (!canEdit) return;
    const point = framePoint(event.clientX, event.clientY);
    if (!point) return;
    event.preventDefault();
    pointersRef.current.set(event.pointerId, point);
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Some assistive/browser pointer implementations do not support capture.
    }
    beginGesture();
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!canEdit || !pointersRef.current.has(event.pointerId)) return;
    const point = framePoint(event.clientX, event.clientY);
    if (!point) return;
    event.preventDefault();
    pointersRef.current.set(event.pointerId, point);
    const gesture = gestureRef.current;
    if (!gesture) return;
    const geometry = geometryFor(gesture.crop);
    if (!geometry) return;

    if (gesture.type === "pan") {
      emit(panCompanyPhotoCrop(
        gesture.crop,
        point.x - gesture.point.x,
        point.y - gesture.point.y,
        geometry,
      ));
      return;
    }

    const points = Array.from(pointersRef.current.values());
    if (points.length < 2) return;
    emit(pinchCompanyPhotoCrop(gesture.crop, gesture.first, gesture.second, points[0], points[1], geometry));
  };

  const finishPointer = (event: PointerEvent<HTMLDivElement>, clearAll = false) => {
    clearPointer(event.pointerId, clearAll);
    try {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // Pointer capture may already have been released by the browser.
    }
  };

  const handleWheel = (event: WheelEvent<HTMLDivElement>) => {
    if (!canEdit) return;
    const anchor = framePoint(event.clientX, event.clientY);
    const geometry = geometryFor(cropRef.current);
    if (!anchor || !geometry) return;
    event.preventDefault();
    const scale = Math.exp(-event.deltaY * 0.002);
    emit(zoomCompanyPhotoCropAtPoint(cropRef.current, cropRef.current.zoom * scale, anchor, geometry));
  };

  const zoomFromRange = (nextZoom: number) => {
    if (!canEdit) return;
    const geometry = geometryFor(cropRef.current);
    const rect = frameRef.current?.getBoundingClientRect();
    if (!geometry || !rect) return;
    emit(zoomCompanyPhotoCropAtPoint(cropRef.current, nextZoom, { x: rect.width / 2, y: rect.height / 2 }, geometry));
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!canEdit) return;
    const geometry = geometryFor(cropRef.current);
    if (!geometry) return;
    const step = event.shiftKey ? KEYBOARD_PAN_PIXELS * 2 : KEYBOARD_PAN_PIXELS;
    let deltaX = 0;
    let deltaY = 0;
    if (event.key === "ArrowLeft") deltaX = -step;
    else if (event.key === "ArrowRight") deltaX = step;
    else if (event.key === "ArrowUp") deltaY = -step;
    else if (event.key === "ArrowDown") deltaY = step;
    else return;
    event.preventDefault();
    // Pixel deltas follow the image under the pointer: right/down moves it right/down.
    emit(panCompanyPhotoCrop(cropRef.current, deltaX, deltaY, geometry));
  };

  const imageStyle = mode === "photo" ? companyPhotoCropStyle(normalizedCrop) : LOGO_STYLE;

  return (
    <div
      className="w-full max-w-[720px] min-w-0"
      data-company-photo-crop-editor={target}
      data-ready={imageReady ? "true" : "false"}>
      <div
        ref={frameRef}
        data-testid="crop-frame"
        className={`relative w-full max-w-full overflow-hidden rounded-lg bg-slate-950 outline-none ${canEdit ? "cursor-grab active:cursor-grabbing focus-visible:ring-2 focus-visible:ring-[#185FA5]" : "cursor-default"}`}
        style={{ aspectRatio, touchAction: "none", userSelect: "none", overscrollBehavior: "contain" }}
        tabIndex={canEdit ? 0 : -1}
        aria-label={target === "home" ? "公司展示主图裁剪区域" : "搜索展示图裁剪区域"}
        aria-disabled={!canEdit}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={event => finishPointer(event)}
        onPointerCancel={event => finishPointer(event, true)}
        onLostPointerCapture={event => {
          if (pointersRef.current.has(event.pointerId)) clearPointer(event.pointerId);
        }}
        onWheel={handleWheel}
        onKeyDown={handleKeyDown}>
        <img
          ref={imageRef}
          src={src}
          alt="公司图片裁剪预览"
          draggable={false}
          className={`absolute inset-0 h-full w-full select-none ${mode === "photo" ? "object-cover" : "object-contain"}`}
          style={imageStyle}
          onLoad={event => {
            const { naturalWidth, naturalHeight } = event.currentTarget;
            markImageReady(naturalWidth, naturalHeight);
          }}
          onError={() => {
            setImageState({ src, width: 0, height: 0, failed: true });
            onReadyChangeRef.current?.(false);
            onImageError?.();
          }}
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 z-10 border border-white/70"
          style={{
            backgroundImage: "linear-gradient(to right, transparent 33.2%, rgb(255 255 255 / 0.36) 33.2%, rgb(255 255 255 / 0.36) 33.8%, transparent 33.8%, transparent 66.2%, rgb(255 255 255 / 0.36) 66.2%, rgb(255 255 255 / 0.36) 66.8%, transparent 66.8%), linear-gradient(to bottom, transparent 33.2%, rgb(255 255 255 / 0.36) 33.2%, rgb(255 255 255 / 0.36) 33.8%, transparent 33.8%, transparent 66.2%, rgb(255 255 255 / 0.36) 66.2%, rgb(255 255 255 / 0.36) 66.8%, transparent 66.8%)",
          }}
        />
        {!imageReady && !imageState.failed && (
          <span className="pointer-events-none absolute inset-0 z-20 grid place-items-center bg-slate-950/60 text-xs text-white/80">正在加载图片…</span>
        )}
        {imageState.src === src && imageState.failed && (
          <span className="pointer-events-none absolute inset-0 z-20 grid place-items-center bg-slate-950/70 px-4 text-center text-xs text-white/85">图片加载失败，暂不能裁剪</span>
        )}
      </div>

      <div className="mt-3 flex w-full max-w-full flex-wrap items-center gap-x-3 gap-y-2 text-xs text-slate-600">
        <label className="flex min-w-[min(100%,220px)] flex-1 items-center gap-2">
          <span className="shrink-0">缩放</span>
          <input
            aria-label="图片缩放"
            type="range"
            min="1"
            max="2"
            step="0.01"
            value={normalizedCrop.zoom}
            disabled={!canEdit}
            onChange={event => zoomFromRange(Number(event.target.value))}
            className="min-w-0 flex-1 accent-[#185FA5] disabled:cursor-not-allowed"
          />
          <output className="w-9 shrink-0 text-right tabular-nums">{normalizedCrop.zoom.toFixed(2)}</output>
        </label>
        <button
          type="button"
          disabled={!canEdit}
          onClick={() => emit(RESET_CROP)}
          className="rounded border border-slate-300 px-2.5 py-1 text-xs text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50">
          重置
        </button>
        {mode === "logo" ? (
          <span className="basis-full text-slate-500">完整显示模式不裁切。</span>
        ) : imageReady ? (
          <span className="basis-full text-slate-500">拖动图片、双指缩放或使用滚轮调整；仅存在可移动区域的方向可拖动。</span>
        ) : null}
      </div>
    </div>
  );
}

export default CompanyPhotoCropEditor;
