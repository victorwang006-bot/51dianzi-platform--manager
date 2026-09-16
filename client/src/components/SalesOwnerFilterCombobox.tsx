import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Check, ChevronsUpDown } from "lucide-react";
import { useMemo, useState } from "react";

type SalesOwnerOption = {
  staffCode: string;
  displayName: string;
  active: boolean;
};

export default function SalesOwnerFilterCombobox({
  value,
  onChange,
  options,
  canViewUnassigned,
}: {
  value: string;
  onChange: (value: string) => void;
  options: SalesOwnerOption[];
  canViewUnassigned: boolean;
}) {
  const [open, setOpen] = useState(false);
  const duplicateNames = useMemo(() => {
    const counts = new Map<string, number>();
    for (const staff of options) {
      const name = staff.displayName.trim().toLowerCase();
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    return new Set(Array.from(counts).filter(([, count]) => count > 1).map(([name]) => name));
  }, [options]);
  const selected = options.find(option => option.staffCode === value);
  const label = value === "all"
    ? "全部负责人"
    : value === "$unassigned"
      ? "未分配"
      : selected
        ? `${selected.displayName}${duplicateNames.has(selected.displayName.trim().toLowerCase()) ? `（${selected.staffCode}）` : ""}`
        : "全部负责人";

  const select = (nextValue: string) => {
    onChange(nextValue);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-label="按销售负责人筛选商户"
          className="h-9 w-[210px] justify-between font-normal"
        >
          <span className="truncate">{label}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[260px] p-0" align="end">
        <Command>
          <CommandInput placeholder="搜索姓名或工号" />
          <CommandList className="max-h-[min(420px,60vh)]">
            <CommandEmpty>未找到负责人</CommandEmpty>
            <CommandGroup heading={`负责人（${options.length}人）`}>
              <CommandItem value="全部负责人 all" onSelect={() => select("all")}>
                <Check className={`h-4 w-4 ${value === "all" ? "opacity-100" : "opacity-0"}`} />
                全部负责人
              </CommandItem>
              {canViewUnassigned && (
                <CommandItem value="未分配 unassigned" onSelect={() => select("$unassigned")}>
                  <Check className={`h-4 w-4 ${value === "$unassigned" ? "opacity-100" : "opacity-0"}`} />
                  未分配
                </CommandItem>
              )}
              {options.map(staff => {
                const displayLabel = `${staff.displayName}${duplicateNames.has(staff.displayName.trim().toLowerCase()) ? `（${staff.staffCode}）` : ""}${staff.active ? "" : "（已停用）"}`;
                return (
                  <CommandItem
                    key={staff.staffCode}
                    value={`${staff.displayName} ${staff.staffCode} ${staff.active ? "启用" : "停用"}`}
                    onSelect={() => select(staff.staffCode)}
                  >
                    <Check className={`h-4 w-4 ${value === staff.staffCode ? "opacity-100" : "opacity-0"}`} />
                    <span className="truncate">{displayLabel}</span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
