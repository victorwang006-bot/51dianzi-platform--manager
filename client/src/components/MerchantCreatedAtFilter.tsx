import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CalendarDays, Check, ChevronDown } from "lucide-react";
import { useEffect, useState } from "react";
import type { MerchantCreatedAtPreset } from "@shared/merchantCreatedAtFilter";

export type MerchantCreatedAtFilterValue = {
  preset: "all" | MerchantCreatedAtPreset;
  from?: string;
  to?: string;
};

const PRESETS: Array<{ value: MerchantCreatedAtFilterValue["preset"]; label: string }> = [
  { value: "all", label: "全部时间" },
  { value: "today", label: "今天" },
  { value: "last7Days", label: "近 7 天" },
  { value: "last30Days", label: "近 30 天" },
  { value: "thisMonth", label: "本月" },
];

function triggerLabel(value: MerchantCreatedAtFilterValue) {
  if (value.preset === "all") return "入驻时间";
  if (value.preset !== "custom") {
    return PRESETS.find(option => option.value === value.preset)?.label ?? "入驻时间";
  }
  if (!value.from || !value.to) return "自定义时间";
  if (value.from === value.to) return value.from.slice(5);
  return `${value.from.slice(5)} 至 ${value.to.slice(5)}`;
}

export default function MerchantCreatedAtFilter({
  value,
  onChange,
}: {
  value: MerchantCreatedAtFilterValue;
  onChange: (value: MerchantCreatedAtFilterValue) => void;
}) {
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState(value.from ?? "");
  const [to, setTo] = useState(value.to ?? "");

  useEffect(() => {
    if (!open) {
      setFrom(value.from ?? "");
      setTo(value.to ?? "");
    }
  }, [open, value.from, value.to]);

  const customValid = Boolean(from && to && from <= to);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-9 min-w-[132px] justify-between px-3 font-normal"
          aria-label="按入驻时间筛选商户"
        >
          <span className="flex min-w-0 items-center gap-1.5">
            <CalendarDays className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <span className="truncate">{triggerLabel(value)}</span>
          </span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[260px] p-2">
        <div className="space-y-0.5">
          {PRESETS.map(option => (
            <Button
              key={option.value}
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 w-full justify-between px-2 text-xs font-normal"
              onClick={() => {
                onChange({ preset: option.value });
                setOpen(false);
              }}
            >
              {option.label}
              {value.preset === option.value && <Check className="h-3.5 w-3.5 text-primary" />}
            </Button>
          ))}
        </div>
        <div className="mt-2 border-t pt-2">
          <p className="mb-2 px-1 text-[11px] text-muted-foreground">自定义日期（北京时间）</p>
          <div className="grid grid-cols-2 gap-2">
            <Input
              type="date"
              value={from}
              max={to || undefined}
              className="h-8 px-2 text-[11px]"
              aria-label="入驻开始日期"
              onChange={event => setFrom(event.target.value)}
            />
            <Input
              type="date"
              value={to}
              min={from || undefined}
              className="h-8 px-2 text-[11px]"
              aria-label="入驻结束日期"
              onChange={event => setTo(event.target.value)}
            />
          </div>
          <Button
            type="button"
            size="sm"
            className="mt-2 h-7 w-full text-xs"
            disabled={!customValid}
            onClick={() => {
              onChange({ preset: "custom", from, to });
              setOpen(false);
            }}
          >
            应用区间
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
