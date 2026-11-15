import React, { useEffect, useId, useRef, useState, type RefObject } from "react";
import { trpc } from "../../../../../api/business-trpc";
import { Popover, PopoverAnchor, PopoverContent } from "../ui/popover";

export type DemandPartSuggestion = { id: number; partNumber: string; brand: string; package: string };
type Props = {
  value: string; disabled: boolean; rowIndex: number; className: string;
  onChange: (value: string) => void; onSelect: (item: DemandPartSuggestion) => void;
  ariaLabel?: string; autoFocus?: boolean; inputRef?: RefObject<HTMLInputElement | null>;
  required?: boolean; testId?: string; isCurrent?: () => boolean;
};
export function DemandPartNumberInput({ value, disabled, rowIndex, className, onChange, onSelect,
  ariaLabel, autoFocus, inputRef: externalInputRef, required, testId, isCurrent }: Props) {
  const listId = useId();
  const localInputRef = useRef<HTMLInputElement>(null);
  const inputRef = externalInputRef ?? localInputRef;
  const [keyword, setKeyword] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const normalized = value.normalize("NFKC").trim().toUpperCase();
  const current = isCurrent?.() ?? true;
  const unavailable = disabled || !current;
  const generation = useRef(0);
  const mounted = useRef(false);
  const selectionGeneration = generation.current;
  const query = trpc.customerDemand.suggestPartNumbers.useQuery({ keyword, limit: 8 }, {
    enabled: !unavailable && open && keyword.length >= 2 && keyword === normalized,
    staleTime: 60_000, refetchOnWindowFocus: false, retry: false,
  });
  const matching = keyword === normalized;
  const requestBlocked = query.isError || query.isFetching;
  const suggestions: DemandPartSuggestion[] = matching && !unavailable && !requestBlocked ? query.data ?? [] : [];
  const latest = useRef({ unavailable, normalized, keyword, isCurrent, requestBlocked, suggestions });
  latest.current = { unavailable, normalized, keyword, isCurrent, requestBlocked, suggestions };
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; generation.current += 1; };
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => setKeyword(normalized), 220);
    return () => window.clearTimeout(timer);
  }, [normalized]);
  useEffect(() => {
    if (unavailable) { generation.current += 1; setOpen(false); setActive(-1); }
  }, [unavailable]);
  useEffect(() => { if (!matching || requestBlocked) setActive(-1); }, [matching, requestBlocked]);
  const expanded = !unavailable && open && normalized.length >= 2;
  const loading = !matching || query.isFetching;
  const selectionCurrent = (item: DemandPartSuggestion) => {
    const state = latest.current;
    return mounted.current && !state.unavailable && state.isCurrent?.() !== false && !state.requestBlocked
      && selectionGeneration === generation.current && keyword === state.keyword && keyword === state.normalized
      && state.suggestions.includes(item);
  };
  const choose = (item: DemandPartSuggestion) => {
    if (!selectionCurrent(item)) return;
    onSelect(item);
    inputRef.current?.focus();
    setActive(-1); setOpen(false);
  };
  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (latest.current.unavailable || latest.current.isCurrent?.() === false) return;
    if (event.key === "Escape" && expanded) { event.preventDefault(); event.stopPropagation(); setOpen(false); return; }
    if (event.key === "Tab") { setOpen(false); return; }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (normalized.length < 2) return;
      event.preventDefault(); setOpen(true);
      if (suggestions.length && selectionCurrent(suggestions[0])) setActive(current => event.key === "ArrowDown" ? (current + 1) % suggestions.length : (current <= 0 ? suggestions.length - 1 : current - 1));
    }
    if (event.key === "Enter" && expanded) {
      event.preventDefault();
      if (active >= 0 && suggestions[active]) choose(suggestions[active]);
    }
  };
  return <Popover open={expanded} onOpenChange={next => { setOpen(next); if (!next) setActive(-1); }}>
    <PopoverAnchor asChild><div className="min-w-0">
      <input ref={inputRef} data-testid={testId ?? `demand-item-${rowIndex}-partNumber`} aria-label={ariaLabel ?? `第${rowIndex + 1}行型号`} autoFocus={autoFocus} required={required} maxLength={128} value={value} disabled={unavailable}
        role="combobox" aria-autocomplete="list" aria-expanded={expanded} aria-controls={expanded ? listId : undefined}
        aria-activedescendant={expanded && active >= 0 && suggestions[active] ? `${listId}-${active}` : undefined}
        autoComplete="off" placeholder="输入2位联想" className={className}
        onChange={event => { if (latest.current.unavailable || latest.current.isCurrent?.() === false) return; const next = event.target.value.normalize("NFKC").toUpperCase(); onChange(next); setActive(-1); setOpen(next.trim().length >= 2); }}
        onFocus={() => { if (!latest.current.unavailable && latest.current.isCurrent?.() !== false && normalized.length >= 2) setOpen(true); }}
        onKeyDown={onKeyDown} />
    </div></PopoverAnchor>
    <PopoverContent align="start" sideOffset={4} collisionPadding={16} className="z-[100] w-[min(360px,calc(100vw-40px))] max-h-60 overflow-y-auto border-slate-200 bg-white p-1 shadow-lg"
      onOpenAutoFocus={event => event.preventDefault()} onCloseAutoFocus={event => event.preventDefault()}
      onEscapeKeyDown={event => { event.preventDefault(); event.stopPropagation(); setOpen(false); }}
      onInteractOutside={event => { if (event.target === inputRef.current) event.preventDefault(); }}>
      <div id={listId} role="listbox" aria-label={ariaLabel ? `${ariaLabel}匹配型号` : `第${rowIndex + 1}行匹配型号`}>
        {loading && <p role="status" className="px-2 py-2 text-[11px] text-slate-500">联想中…</p>}
        {!loading && suggestions.map((item, index) => <button key={item.id} id={`${listId}-${index}`} type="button" role="option" tabIndex={-1} aria-selected={active === index}
          className={`flex w-full items-start justify-between gap-2 rounded px-2 py-2 text-left text-xs ${active === index ? "bg-blue-50" : "hover:bg-slate-50"}`}
          onMouseDown={event => event.preventDefault()} onClick={() => choose(item)} onMouseEnter={() => { if (selectionCurrent(item)) setActive(index); }}>
          <span className="break-all font-medium text-[#185FA5]">{item.partNumber}</span><span className="shrink-0 text-[11px] text-slate-500">{[item.brand, item.package].filter(Boolean).join(" / ")}</span>
        </button>)}
        {!loading && !suggestions.length && <p role="status" className="px-2 py-2 text-[11px] text-slate-500">{query.isError ? "联想暂不可用，可继续手动输入" : "未找到匹配型号，可继续手动输入"}</p>}
      </div>
    </PopoverContent>
  </Popover>;
}
