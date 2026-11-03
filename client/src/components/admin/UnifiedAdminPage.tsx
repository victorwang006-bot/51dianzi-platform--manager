import * as React from "react";
import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Presentational primitives only: no data requests, router, auth or state. */
export function AdminPage({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return <section data-admin-ui-system="channel-inventory" className={cn("aui-page", className)} {...props} />;
}

type AdminPageHeaderProps = Omit<HTMLAttributes<HTMLElement>, "title"> & {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
};

export function AdminPageHeader({ title, description, actions, children, className, ...props }: AdminPageHeaderProps) {
  return (
    <header className={cn("aui-page-header", className)} {...props}>
      <div className="aui-page-heading">
        <h1 className="aui-page-title">{title}</h1>
        {description ? <div className="aui-page-description">{description}</div> : null}
        {children}
      </div>
      {actions ? <div className="aui-page-actions">{actions}</div> : null}
    </header>
  );
}

type AdminPageTabsProps = HTMLAttributes<HTMLElement> & { ariaLabel?: string };
/** Pass existing Link/button children with their genuine href and active state. */
export function AdminPageTabs({ className, ariaLabel = "页面功能", ...props }: AdminPageTabsProps) {
  return <nav aria-label={ariaLabel} className={cn("aui-page-tabs", className)} {...props} />;
}

export function AdminFilterBar({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("aui-filterbar", className)} {...props} />;
}

export function AdminDataPanel({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("aui-data-panel", className)} {...props} />;
}
