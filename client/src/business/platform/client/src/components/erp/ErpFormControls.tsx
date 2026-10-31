import type { ReactNode } from "react";
import { cn } from "../../lib/utils";

export type ErpSegmentedOption<T extends string | boolean> = {
  value: T;
  label: string;
};

type ErpSegmentedControlProps<T extends string | boolean> = {
  ariaLabel: string;
  value: T;
  options: readonly ErpSegmentedOption<T>[];
  onChange: (value: T) => void;
  disabled?: boolean;
  variant?: "segmented" | "buttons";
  className?: string;
};

export function ErpSegmentedControl<T extends string | boolean>({
  ariaLabel,
  value,
  options,
  onChange,
  disabled = false,
  variant = "segmented",
  className,
}: ErpSegmentedControlProps<T>) {
  return (
    <div
      className={cn("erp-segmented", variant === "buttons" && "erp-choice-buttons", className)}
      role="radiogroup"
      aria-label={ariaLabel}
      aria-disabled={disabled || undefined}
    >
      {options.map((option, index) => {
        const selected = Object.is(value, option.value);
        return (
          <button
            key={String(option.value)}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            disabled={disabled}
            className="erp-segmented-option"
            data-state={selected ? "checked" : "unchecked"}
            onClick={() => onChange(option.value)}
            onKeyDown={event => {
              const backwards =
                event.key === "ArrowLeft" || event.key === "ArrowUp";
              const forwards =
                event.key === "ArrowRight" || event.key === "ArrowDown";
              if (
                !backwards &&
                !forwards &&
                event.key !== "Home" &&
                event.key !== "End"
              )
                return;
              event.preventDefault();
              const nextIndex =
                event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? options.length - 1
                    : (index + (backwards ? -1 : 1) + options.length) %
                      options.length;
              const next = options[nextIndex];
              if (!next) return;
              onChange(next.value);
              const buttons =
                event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>(
                  ".erp-segmented-option"
                );
              buttons?.[nextIndex]?.focus();
            }}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

export function ErpSectionTitle({ children }: { children: ReactNode }) {
  return <div className="erp-section-title">{children}</div>;
}

export function ErpHelperText({
  children,
  tone = "muted",
}: {
  children: ReactNode;
  tone?: "muted" | "warning" | "danger";
}) {
  return <p className={cn("erp-helper", `erp-helper-${tone}`)}>{children}</p>;
}
