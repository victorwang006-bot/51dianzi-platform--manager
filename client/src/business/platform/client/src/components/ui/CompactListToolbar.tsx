import type { ReactNode } from "react";
import "./CompactListToolbar.css";

/** Shared list structure only; callers retain all events, state and guards. */
export function CompactListToolbar({
  title,
  children,
  actions,
  extra,
  className,
}: {
  title: string;
  children?: ReactNode;
  actions?: ReactNode;
  extra?: ReactNode;
  className?: string;
}) {
  return (
    <>
      <h1 className="d51-compact-list-title">{title}</h1>
      <section
        className={`d51-compact-list-toolbar${className ? ` ${className}` : ""}`}
        role="search"
        aria-label={`${title}筛选和操作`}
      >
        <div className="d51-compact-list-toolbar__row">
          <div className="d51-compact-list-toolbar__filters">{children}</div>
          {actions ? (
            <div className="d51-compact-list-toolbar__actions">{actions}</div>
          ) : null}
        </div>
        {extra ? (
          <div className="d51-compact-list-toolbar__extra">{extra}</div>
        ) : null}
      </section>
    </>
  );
}
