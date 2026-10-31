import { useEffect, useId, useRef, useState } from "react";
import { trpc } from "../../../../../api/business-trpc";
import { Popover, PopoverAnchor, PopoverContent } from "../ui/popover";

export type DemandPartSuggestion = { id: number; partNumber: string; brand: string; package: string };
type Props = { value: string; disabled: boolean; rowIndex: number; className: string; onChange: (value: string) => void; onSelect: (item: DemandPartSuggestion) => void };
export function DemandPartNumberInput({ value, disabled, rowIndex, className, onChange, onSelect }: Props) {
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [keyword, setKeyword] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const normalized = value.normalize("NFKC").trim().toUpperCase();
  const query = trpc.customerDemand.suggestPartNumbers.useQuery({ keyword, limit: 8 }, {
    enabled: !disabled && open && keyword.length >= 2 && keyword === normalized,
    staleTime: 60_000, refetchOnWindowFocus: false, retry: false,
  });
  useEffect(() => {
    const timer = window.setTimeout(() => setKeyword(normalized), 220);
    return () => window.clearTimeout(timer);
  }, [normalized]);
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
  const matching = keyword === normalized;
  const suggestions = matching ? query.data ?? [] : [];
  const expanded = !disabled && open && normalized.length >= 2;
  const loading = !matching || query.isFetching;
  const choose = (item: DemandPartSuggestion) => {
    if (disabled || !matching) return;
    onSelect(item);
    inputRef.current?.focus();
    setActive(-1); setOpen(false);
  };
  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape" && expanded) { event.preventDefault(); event.stopPropagation(); setOpen(false); return; }
    if (event.key === "Tab") { setOpen(false); return; }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (normalized.length < 2) return;
      event.preventDefault(); setOpen(true);
      if (suggestions.length) setActive(current => event.key === "ArrowDown" ? (current + 1) % suggestions.length : (current <= 0 ? suggestions.length - 1 : current - 1));
    }
    if (event.key === "Enter" && expanded) {
      event.preventDefault();
      if (active >= 0 && suggestions[active]) choose(suggestions[active]);
    }
  };
  return <Popover open={expanded} onOpenChange={next => { setOpen(next); if (!next) setActive(-1); }}>
    <PopoverAnchor asChild><div className="min-w-0">
      <input ref={inputRef} data-testid={`demand-item-${rowIndex}-partNumber`} aria-label={`第${rowIndex + 1}行型号`} maxLength={128} value={value} disabled={disabled}
        role="combobox" aria-autocomplete="list" aria-expanded={expanded} aria-controls={expanded ? listId : undefined}
        aria-activedescendant={expanded && active >= 0 && suggestions[active] ? `${listId}-${active}` : undefined}
        autoComplete="off" placeholder="输入2位联想" className={className}
        onChange={event => { const next = event.target.value.normalize("NFKC").toUpperCase(); onChange(next); setActive(-1); setOpen(next.trim().length >= 2); }}
        onFocus={() => { if (normalized.length >= 2) setOpen(true); }}
        onKeyDown={onKeyDown} />
    </div></PopoverAnchor>
    <PopoverContent align="start" sideOffset={4} collisionPadding={16} className="z-[100] w-[min(360px,calc(100vw-40px))] max-h-60 overflow-y-auto border-slate-200 bg-white p-1 shadow-lg"
      onOpenAutoFocus={event => event.preventDefault()} onCloseAutoFocus={event => event.preventDefault()}
      onEscapeKeyDown={event => { event.preventDefault(); event.stopPropagation(); setOpen(false); }}
      onInteractOutside={event => { if (event.target === inputRef.current) event.preventDefault(); }}>
      <div id={listId} role="listbox" aria-label={`第${rowIndex + 1}行匹配型号`}>
        {loading && <p role="status" className="px-2 py-2 text-[11px] text-slate-500">联想中…</p>}
        {!loading && suggestions.map((item, index) => <button key={item.id} id={`${listId}-${index}`} type="button" role="option" tabIndex={-1} aria-selected={active === index}
          className={`flex w-full items-start justify-between gap-2 rounded px-2 py-2 text-left text-xs ${active === index ? "bg-blue-50" : "hover:bg-slate-50"}`}
          onMouseDown={event => event.preventDefault()} onClick={() => choose(item)} onMouseEnter={() => setActive(index)}>
          <span className="break-all font-medium text-[#185FA5]">{item.partNumber}</span><span className="shrink-0 text-[11px] text-slate-500">{[item.brand, item.package].filter(Boolean).join(" / ")}</span>
        </button>)}
        {!loading && !suggestions.length && <p role="status" className="px-2 py-2 text-[11px] text-slate-500">{query.isError ? "联想暂不可用，可继续手动输入" : "未找到匹配型号，可继续手动输入"}</p>}
      </div>
    </PopoverContent>
  </Popover>;
}
