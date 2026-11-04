import React, { useId } from "react";

type Props = {
  children: React.ReactNode;
  onClick: () => void;
  disabledReason?: string;
  className?: string;
};

/** Native Enter/Space activation, with a focusable, explained disabled state. */
export function CustomerSupplyAction({ children, onClick, disabledReason, className = "" }: Props) {
  const reasonId = useId();
  return <span className="customer-list-text-action-wrap">
    <button type="button" className={`customer-list-text-action ${className}`}
      aria-disabled={disabledReason ? true : undefined}
      aria-describedby={disabledReason ? reasonId : undefined} title={disabledReason}
      onClick={() => { if (!disabledReason) onClick(); }}>
      {children}
    </button>
    {disabledReason ? <span id={reasonId} className="customer-list-action-reason">{disabledReason}</span> : null}
  </span>;
}
