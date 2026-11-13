import { useEffect, useRef, useState } from "react";

/** 与前台已确认文案一致（包括“数量购吗？”）。 */
export const DEFAULT_QUICK_PHRASES = [
  "你好，这颗有货吗？",
  "你好，这个料询价",
  "交期多久？",
  "年份是什么？",
  "数量购吗？",
  "你好需要多少？",
] as const;

export interface QuickPhrasesProps {
  disabled?: boolean;
  onSelect: (text: string) => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

/** 只返回选中文字，绝不发送；内联样式便于精确生产增量，不依赖新增 CSS。 */
export default function QuickPhrases({ disabled = false, onSelect, open, onOpenChange }: QuickPhrasesProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const [menuId] = useState(() => `chat-quick-phrases-${Math.random().toString(36).slice(2)}`);
  const root = useRef<HTMLDivElement>(null);
  const isOpen = !disabled && (open ?? internalOpen);
  const setOpen = (next: boolean) => {
    if (next && disabled) return;
    setInternalOpen(next);
    onOpenChange?.(next);
  };

  useEffect(() => {
    if (disabled) setOpen(false);
    // Both uncontrolled and externally controlled menus close on permission loss.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [disabled]);

  useEffect(() => {
    if (!isOpen) return;
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, disabled, onOpenChange]);

  return <div ref={root} style={{ position: "relative", flexShrink: 0 }}>
    <button type="button" disabled={disabled} aria-haspopup="menu" aria-expanded={isOpen}
      aria-controls={menuId} onClick={() => setOpen(!isOpen)}
      style={{ height: 28, padding: "0 8px", border: "1px solid #cfe0f1", borderRadius: 6,
        background: "#fff", color: "#185FA5", fontSize: 11, fontWeight: 500,
        cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.4 : 1 }}>
      常用语
    </button>
    {isOpen ? <div id={menuId} role="menu" aria-label="常用语"
      style={{ position: "absolute", bottom: "calc(100% + 8px)", left: 0, zIndex: 50,
        width: "min(300px, calc(100vw - 56px))", padding: 8, display: "grid", gap: 6,
        gridTemplateColumns: "repeat(2, minmax(0, 1fr))", border: "1px solid #cfe0f1",
        borderRadius: 10, background: "#fff", boxShadow: "0 8px 24px rgba(0,0,0,.12)" }}>
      {DEFAULT_QUICK_PHRASES.map(text => <button key={text} type="button" role="menuitem" disabled={disabled}
        onClick={() => { if (disabled) return; setOpen(false); onSelect(text); }}
        style={{ border: 0, borderRadius: 6, padding: "9px 6px", background: "#f3f7fb",
          color: "#185FA5", fontSize: 11, textAlign: "left", cursor: "pointer" }}>{text}</button>)}
    </div> : null}
  </div>;
}
