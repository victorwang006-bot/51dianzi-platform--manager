import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { Input } from "./ui/input";
import { cn } from "../lib/utils";

/**
 * 可自由输入 + 联想候选的输入框。
 *
 * 用于分类、封装这类「有常用值但不该被穷举限制」的字段：
 * 元器件的封装型号成千上万，固定下拉必然覆盖不全，
 * 商家遇到列表里没有的封装就只能选「其他」，信息就此丢失。
 *
 * 交互约定：
 * - 聚焦即展开全部候选，输入后按子串匹配过滤（不区分大小写）
 * - 候选仅为「建议」，用户输入的任意值都会被原样保留
 * - 支持上下键选择、回车确认、ESC 关闭，避免必须用鼠标
 */
export function ComboInput({
  value,
  onChange,
  options,
  placeholder,
  maxLength,
  id,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  options: readonly string[];
  placeholder?: string;
  maxLength?: number;
  id?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const wrapRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const autoId = useId();
  const listboxId = `${id ?? autoId}-listbox`;

  const filtered = useMemo(() => {
    const kw = value.trim().toLowerCase();
    if (!kw) return options;
    // 前缀匹配优先于子串匹配，让「06」先出 0603 而不是 TO-0603 这类
    const starts: string[] = [];
    const includes: string[] = [];
    for (const o of options) {
      const lower = o.toLowerCase();
      if (lower.startsWith(kw)) starts.push(o);
      else if (lower.includes(kw)) includes.push(o);
    }
    return [...starts, ...includes];
  }, [value, options]);

  // 点击组件外部时收起候选列表
  useEffect(() => {
    if (!open) return;
    const onDocMouseDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, [open]);

  // 键盘选中项滚动进可视区域
  useEffect(() => {
    if (!open || activeIndex < 0) return;
    listRef.current?.querySelectorAll("button")[activeIndex]?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, open]);

  const commit = (v: string) => {
    onChange(v);
    setOpen(false);
    setActiveIndex(-1);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      if (filtered.length === 0) return;
      const step = e.key === "ArrowDown" ? 1 : -1;
      setActiveIndex(i => (i + step + filtered.length) % filtered.length);
      return;
    }
    if (e.key === "Enter" && open && activeIndex >= 0 && filtered[activeIndex]) {
      e.preventDefault();
      commit(filtered[activeIndex]);
      return;
    }
    if (e.key === "Escape" && open) {
      e.preventDefault();
      setOpen(false);
      setActiveIndex(-1);
    }
  };

  return (
    <div ref={wrapRef} className={cn("relative", className)}>
      <Input
        id={id}
        value={value}
        placeholder={placeholder}
        maxLength={maxLength}
        autoComplete="off"
        role="combobox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-autocomplete="list"
        className="pr-8"
        onChange={e => {
          onChange(e.target.value);
          setOpen(true);
          setActiveIndex(-1);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
      />
      <button
        type="button"
        tabIndex={-1}
        aria-label="展开候选"
        className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
        onMouseDown={e => {
          e.preventDefault();
          setOpen(o => !o);
        }}
      >
        <ChevronDown className={cn("h-4 w-4 transition-transform", open && "rotate-180")} />
      </button>

      {open && filtered.length > 0 && (
        <div
          ref={listRef}
          id={listboxId}
          role="listbox"
          className="absolute z-50 top-full left-0 right-0 mt-1 bg-white border border-border rounded-md shadow-lg max-h-56 overflow-y-auto"
        >
          {filtered.map((opt, i) => (
            <button
              key={opt}
              type="button"
              role="option"
              aria-selected={opt === value}
              className={cn(
                "w-full text-left px-3 py-2 text-sm border-b border-border/40 last:border-0",
                i === activeIndex ? "bg-[#f0f6fd]" : "hover:bg-[#f0f6fd]",
                opt === value && "font-medium text-[#185FA5]",
              )}
              onMouseDown={e => {
                e.preventDefault(); // 防止 input 先 blur 导致点击落空
                commit(opt);
              }}
              onMouseEnter={() => setActiveIndex(i)}
            >
              {opt}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
