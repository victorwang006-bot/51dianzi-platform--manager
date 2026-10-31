import { useEffect, useId, useState, type ComponentProps } from "react";
import { CalendarDays } from "lucide-react";
import { zhCN } from "date-fns/locale";
import { Calendar } from "../ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { cn } from "../../lib/utils";
import { beijingDateTimeLocalToIso, nowBeijingDateTimeLocal } from "./customerUtils";

type Props = Omit<ComponentProps<"button">, "onChange" | "value"> & {
  /** Beijing civil time, not a browser-local instant: YYYY-MM-DDTHH:mm. */
  value: string;
  onChange: (value: string) => void;
  clearable?: boolean;
  defaultTime?: string;
};
const pad = (n: number) => String(n).padStart(2, "0");
export function dateKeyOffset(dateKey: string, days: number): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + days));
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}
function calendarDate(value: string): Date | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !beijingDateTimeLocalToIso(`${value}T12:00`)) return undefined;
  const [y, m, d] = value.split("-").map(Number);
  // Calendar Date objects represent a civil day only; never serialize them as instants.
  return new Date(y, m - 1, d, 12);
}

export function BeijingDateTimePicker({ value, onChange, clearable = true, defaultTime = "09:00", className, disabled, ...buttonProps }: Props) {
  const prefix = useId();
  const [open, setOpen] = useState(false);
  const [day, setDay] = useState("");
  const [hour, setHour] = useState("09");
  const [minute, setMinute] = useState("00");
  const [month, setMonth] = useState<Date>(() => calendarDate(nowBeijingDateTimeLocal().slice(0, 10))!);
  const [error, setError] = useState("");
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
  const label = String(buttonProps["aria-label"] || "日期时间");
  const selected = calendarDate(day);
  const changeOpen = (next: boolean) => {
    if (next && !disabled) {
      const datePart = value.slice(0, 10);
      const clock = value.slice(11, 16) || defaultTime;
      setDay(datePart);
      setHour(clock.slice(0, 2));
      setMinute(clock.slice(3, 5));
      setMonth(calendarDate(datePart) || calendarDate(nowBeijingDateTimeLocal().slice(0, 10))!);
      setError("");
      setOpen(true);
    } else setOpen(false);
  };
  const commit = (next: string) => { if (disabled) return; onChange(next); setOpen(false); setError(""); };
  const confirm = () => {
    if (!/^\d{1,2}$/.test(hour) || !/^\d{1,2}$/.test(minute)) { setError("请输入小时和分钟"); return; }
    const next = `${day.trim()}T${pad(Number(hour))}:${pad(Number(minute))}`;
    if (!beijingDateTimeLocalToIso(next)) { setError("请选择有效日期，小时为00–23，分钟为00–59"); return; }
    commit(next);
  };
  const setPreset = (offset: number) => {
    const key = dateKeyOffset(nowBeijingDateTimeLocal().slice(0, 10), offset);
    setDay(key); setMonth(calendarDate(key)!); setError("");
  };
  const fieldClass = "h-8 min-w-0 rounded-md border border-slate-300 bg-white px-2 text-xs text-slate-800 outline-none focus:border-[#185FA5] focus:ring-1 focus:ring-[#185FA5]";
  const buttonClass = "h-7 rounded px-2 text-xs text-slate-600 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-[#185FA5]";
  return <Popover open={open && !disabled} onOpenChange={changeOpen}>
    <PopoverTrigger asChild>
      <button {...buttonProps} type="button" disabled={disabled} className={cn("flex h-8 w-full min-w-0 items-center justify-between gap-2 rounded-md border border-slate-300 bg-white px-2.5 text-left text-xs font-normal text-slate-700 shadow-none hover:border-slate-400 focus-visible:outline-2 focus-visible:outline-[#185FA5] disabled:cursor-not-allowed disabled:opacity-50", className)}>
        <span className={cn("truncate tabular-nums", !value && "text-slate-400")}>{value ? value.replace("T", " ") : "选择日期和时间"}</span><CalendarDays aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-slate-500" />
      </button>
    </PopoverTrigger>
    <PopoverContent aria-label={`${label}选择器`} align="start" collisionPadding={8} className="z-[100] w-[300px] max-w-[calc(100vw-16px)] max-h-[var(--radix-popover-content-available-height)] overflow-y-auto p-0 text-xs" onKeyDown={event => {
      if (event.key === "Enter" && (event.target instanceof HTMLInputElement)) { event.preventDefault(); event.stopPropagation(); confirm(); }
    }}>
      <div className="border-b border-slate-100 px-3 py-2">
        <div className="mb-1.5 flex items-center justify-between"><span className="font-medium text-slate-700">选择日期和时间</span><span className="text-[11px] text-slate-500">北京时间 · 24小时制</span></div>
        <div className="flex gap-1">
          <button type="button" className={buttonClass} onClick={() => commit(nowBeijingDateTimeLocal())}>现在</button>
          <button type="button" className={buttonClass} onClick={() => setPreset(0)}>今天</button>
          <button type="button" className={buttonClass} onClick={() => setPreset(1)}>明天</button>
          <button type="button" className={buttonClass} onClick={() => setPreset(7)}>一周后</button>
        </div>
      </div>
      <Calendar mode="single" locale={zhCN} weekStartsOn={1} captionLayout="dropdown" month={month} onMonthChange={setMonth} selected={selected}
        today={calendarDate(nowBeijingDateTimeLocal().slice(0, 10))}
        startMonth={new Date(Math.min(2000, month.getFullYear()), 0)} endMonth={new Date(Math.max(2100, month.getFullYear()), 11)}
        onSelect={date => { if (date) { setDay(`${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`); setError(""); } }}
        formatters={{ formatMonthDropdown: date => `${date.getMonth() + 1}月`, formatYearDropdown: date => `${date.getFullYear()}年`, formatWeekdayName: date => ["日", "一", "二", "三", "四", "五", "六"][date.getDay()] }}
        labels={{ labelPrevious: () => "上个月", labelNext: () => "下个月", labelMonthDropdown: () => "选择月份", labelYearDropdown: () => "选择年份" }}
        className="mx-auto w-full p-3 [--cell-size:2rem]" classNames={{ months: "relative flex w-full flex-col", month: "flex w-full flex-col gap-2", dropdowns: "flex h-8 w-full items-center justify-center gap-1 text-xs font-medium" }}
      />
      <div className="border-t border-slate-100 px-3 py-2.5">
        <div className="grid grid-cols-[minmax(0,1fr)_48px_8px_48px] items-end gap-1.5">
          <label htmlFor={`${prefix}-day`} className="min-w-0"><span className="mb-1 block text-[11px] text-slate-500">日期</span><input id={`${prefix}-day`} aria-label="输入日期" placeholder="YYYY-MM-DD" className={`${fieldClass} w-full`} value={day} maxLength={10} onChange={event => { setDay(event.target.value); setError(""); const date=calendarDate(event.target.value); if(date)setMonth(date); }} /></label>
          <label htmlFor={`${prefix}-hour`}><span className="mb-1 block text-[11px] text-slate-500">时</span><input id={`${prefix}-hour`} aria-label="小时（24小时制）" inputMode="numeric" maxLength={2} className={`${fieldClass} w-full text-center tabular-nums`} value={hour} onFocus={event => event.target.select()} onChange={event => { setHour(event.target.value); setError(""); }} /></label>
          <span className="pb-2 text-center text-slate-400">:</span>
          <label htmlFor={`${prefix}-minute`}><span className="mb-1 block text-[11px] text-slate-500">分</span><input id={`${prefix}-minute`} aria-label="分钟" inputMode="numeric" maxLength={2} className={`${fieldClass} w-full text-center tabular-nums`} value={minute} onFocus={event => event.target.select()} onChange={event => { setMinute(event.target.value); setError(""); }} /></label>
        </div>
        {error && <p role="alert" className="mt-2 text-[11px] text-red-700">{error}</p>}
        <div className="mt-2.5 flex items-center justify-between">
          <div>{clearable && <button type="button" className={buttonClass} onClick={() => commit("")}>清空</button>}</div>
          <div className="flex gap-1.5"><button type="button" className={buttonClass} onClick={() => setOpen(false)}>取消</button><button type="button" className="h-8 rounded-md bg-[#185FA5] px-3 text-xs text-white hover:bg-[#0C447C]" onClick={confirm}>确定</button></div>
        </div>
      </div>
    </PopoverContent>
  </Popover>;
}
