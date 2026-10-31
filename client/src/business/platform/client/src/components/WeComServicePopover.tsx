import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import wecomServiceQr from "../assets/brand/wecom-service-qr.png";

const CARD_WIDTH = 232;
const CARD_GAP = 8;

/**
 * 「联系客服」企微码卡片。
 * 电脑悬停展示，手机点按展开；二维码使用官方海报原像素裁切，不重绘。
 * 卡片用 fixed 定位，避免被搜索页 overflow-x:hidden 裁切。
 */
export default function WeComServicePopover({
  onOpenChat,
  children,
}: {
  onOpenChat: () => void;
  children: ReactNode;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<number | null>(null);
  const [open, setOpen] = useState(false);
  const [coarsePointer, setCoarsePointer] = useState(false);
  const [cardPos, setCardPos] = useState({ top: 0, left: 0 });

  useEffect(() => {
    const media = window.matchMedia("(hover: none), (pointer: coarse)");
    const sync = () => setCoarsePointer(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);

  useLayoutEffect(() => {
    if (!open || !wrapRef.current) return;
    const place = () => {
      const rect = wrapRef.current!.getBoundingClientRect();
      const left = Math.min(
        Math.max(12, rect.right - CARD_WIDTH),
        window.innerWidth - CARD_WIDTH - 12,
      );
      setCardPos({ top: rect.bottom + CARD_GAP, left });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    const onPointerDown = (event: PointerEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open]);

  useEffect(() => () => {
    if (closeTimer.current != null) window.clearTimeout(closeTimer.current);
  }, []);

  const cancelClose = () => {
    if (closeTimer.current != null) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };

  const openCard = () => {
    cancelClose();
    setOpen(true);
  };

  const closeCardSoon = () => {
    cancelClose();
    closeTimer.current = window.setTimeout(() => setOpen(false), 140);
  };

  return (
    <div
      ref={wrapRef}
      className="wecom-service"
      onMouseEnter={() => {
        if (!coarsePointer) openCard();
      }}
      onMouseLeave={() => {
        if (!coarsePointer) closeCardSoon();
      }}
    >
      <div
        className="wecom-service-trigger"
        onClick={event => {
          if (coarsePointer) {
            event.preventDefault();
            event.stopPropagation();
            setOpen(value => !value);
            return;
          }
          onOpenChat();
        }}
      >
        {children}
      </div>
      {open ? (
        <div
          className="wecom-service-card"
          role="dialog"
          aria-label="企业微信客服"
          style={{ top: cardPos.top, left: cardPos.left }}
        >
          <div className="wecom-service-title">企业微信客服</div>
          <img
            className="wecom-service-qr"
            src={wecomServiceQr}
            alt="51电子网小助理企业微信二维码"
            width={176}
            height={176}
            decoding="async"
          />
          <div className="wecom-service-name">51电子网小助理</div>
          <div className="wecom-service-hint">微信扫码添加</div>
          {coarsePointer ? (
            <button type="button" className="wecom-service-chat" onClick={onOpenChat}>
              打开站内客服
            </button>
          ) : null}
        </div>
      ) : null}
      <style>{`
        .wecom-service{position:relative;display:inline-flex;align-items:center}
        .wecom-service-trigger{display:inline-flex;align-items:center;cursor:pointer}
        .wecom-service-card{position:fixed;z-index:80;width:${CARD_WIDTH}px;padding:14px 16px 16px;background:#fff;border:1px solid #e6edf5;border-radius:10px;box-shadow:0 10px 28px rgba(24,95,165,.14);text-align:center}
        .wecom-service-title{font-size:13px;font-weight:650;color:#185FA5;line-height:20px}
        .wecom-service-qr{display:block;width:176px;height:176px;margin:10px auto 8px;object-fit:contain;background:#fff}
        .wecom-service-name{font-size:12px;font-weight:600;color:#30343b;line-height:18px}
        .wecom-service-hint{margin-top:2px;font-size:11px;color:#888;line-height:16px}
        .wecom-service-chat{margin-top:10px;width:100%;height:32px;border:1px solid #c9dcf0;border-radius:7px;background:#f5f9fd;color:#185FA5;font-size:12px;font-weight:650;font-family:inherit;cursor:pointer}
      `}</style>
    </div>
  );
}
