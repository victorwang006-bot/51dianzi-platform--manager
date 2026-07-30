import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { ChevronDown } from "lucide-react";
import { useState } from "react";

/**
 * 可折叠卡片：点击标题栏切换展开/折叠。
 * defaultOpen 控制默认状态；headerExtra 用于在标题右侧渲染附加内容（如描述）。
 */
export default function CollapsibleCard({
  title,
  icon: Icon,
  defaultOpen = false,
  description,
  children,
  contentClassName,
}: {
  title: string;
  icon?: React.ComponentType<{ className?: string }>;
  defaultOpen?: boolean;
  description?: React.ReactNode;
  children: React.ReactNode;
  contentClassName?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <Card>
      <CardHeader
        className={cn("cursor-pointer select-none", open ? "pb-3" : "pb-6")}
        onClick={() => setOpen(o => !o)}
        role="button"
        aria-expanded={open}
        tabIndex={0}
        onKeyDown={e => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setOpen(o => !o);
          }
        }}
      >
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base flex items-center gap-2">
            {Icon && <Icon className="h-4 w-4 text-primary" />}
            {title}
          </CardTitle>
          <ChevronDown
            className={cn(
              "h-4 w-4 text-muted-foreground shrink-0 transition-transform duration-200",
              open && "rotate-180",
            )}
          />
        </div>
        {open && description ? (
          <p className="text-sm text-muted-foreground mt-1.5">{description}</p>
        ) : null}
      </CardHeader>
      {open && <CardContent className={contentClassName}>{children}</CardContent>}
    </Card>
  );
}
