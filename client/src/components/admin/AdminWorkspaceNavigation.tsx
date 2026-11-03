import type { KeyboardEvent, ReactNode } from "react";
import { BEIJING_TIME_ZONE } from "@shared/beijingTime";
import {
  getAdminWorkspaceNavigationState,
  getAdminWorkspaceNavigationTarget,
  type AdminWorkspaceId,
  type AdminWorkspaceNavigationItem,
} from "./adminWorkspaceNavigationModel";
import "./AdminWorkspaceNavigation.css";

/** UI release only; native/business authorization versions remain independent. */
export const ADMIN_SYSTEM_RELEASE = "20261103-team-beijing-ui-v2";

export type AdminWorkspaceTabsProps<T extends AdminWorkspaceNavigationItem> = {
  /** Already filtered by the existing native-admin/BFF capability checks. */
  items: readonly T[];
  /** Actual router location; query/hash may be included. No local selection state. */
  location: string;
  /** Reuse the parent's real navigation handler, including merchant query context. */
  onNavigate: (item: T) => void;
  /** Optional route-chunk preloading; never invoked as an authorization check. */
  onItemIntent?: (item: T) => void;
  /** Parent-friendly alias for route-chunk preloading. */
  onPreload?: (item: T) => void;
  className?: string;
};

export type AdminWorkspaceItemRenderState = {
  isActive: boolean;
  workspaceId: AdminWorkspaceId;
};

export type AdminModuleTabsProps<T extends AdminWorkspaceNavigationItem> =
  AdminWorkspaceTabsProps<T> & {
    /** Render label/icons/badges only, not an interactive element or SidebarMenuItem.
     * The component owns the accessible button and calls onNavigate exactly once.
     * A one-argument renderItem(item) callback remains valid.
     */
    renderItem?: (item: T, state: AdminWorkspaceItemRenderState) => ReactNode;
    /** Preserve existing unread/module notification badges, without data fetching. */
    renderBadge?: (item: T) => ReactNode;
  };

export type AdminWorkspaceNavigationProps<
  T extends AdminWorkspaceNavigationItem,
> = AdminModuleTabsProps<T>;

/** Route navigation uses nav/buttons, not ARIA tab panels. Arrow keys move focus
 * without changing routes; Enter/Space activate through the native button.
 */
function handleNavigationKeys(event: KeyboardEvent<HTMLElement>) {
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
  const target = event.target as HTMLElement;
  const button = target.closest<HTMLButtonElement>(
    "button[data-workspace-nav-target]"
  );
  if (!button || !event.currentTarget.contains(button)) return;
  const buttons = Array.from(
    event.currentTarget.querySelectorAll<HTMLButtonElement>(
      "button[data-workspace-nav-target]"
    )
  );
  const index = buttons.indexOf(button);
  if (index < 0 || !buttons.length) return;
  const next =
    event.key === "Home"
      ? 0
      : event.key === "End"
        ? buttons.length - 1
        : (index + (event.key === "ArrowRight" ? 1 : -1) + buttons.length) %
          buttons.length;
  event.preventDefault();
  buttons[next].focus({ preventScroll: true });
  buttons[next].scrollIntoView?.({ block: "nearest", inline: "nearest" });
}

/** Put this beside the existing Logo/account controls in the first header row. */
export function WorkspaceTabs<T extends AdminWorkspaceNavigationItem>({
  items,
  location,
  onNavigate,
  onItemIntent,
  onPreload,
  className,
}: AdminWorkspaceTabsProps<T>) {
  const { workspaces, activeWorkspace } = getAdminWorkspaceNavigationState(
    items,
    location
  );
  if (!workspaces.length) return null;

  return (
    <nav
      className={`admin-workspace-nav__tabs admin-workspace-nav__tabs--workspaces${className ? ` ${className}` : ""}`}
      aria-label="工作区切换"
      data-admin-navigation="workspace-tabs"
      data-system-version={ADMIN_SYSTEM_RELEASE}
      data-display-time-zone={BEIJING_TIME_ZONE}
      title={`系统版本：${ADMIN_SYSTEM_RELEASE} · 北京时间（UTC+8）`}
      onKeyDown={handleNavigationKeys}
    >
      {workspaces.map(workspace => {
        const isActive = workspace.id === activeWorkspace?.id;
        const target = getAdminWorkspaceNavigationTarget(items, workspace.id);
        return (
          <button
            key={workspace.id}
            type="button"
            className="admin-workspace-nav__tab admin-workspace-nav__workspace"
            data-workspace-nav-target={workspace.id}
            data-active={isActive ? "true" : "false"}
            aria-current={isActive ? "location" : undefined}
            onClick={() => {
              if (!isActive && target) onNavigate(target);
            }}
            onPointerEnter={() => {
              if (target) (onPreload ?? onItemIntent)?.(target);
            }}
            onFocus={() => {
              if (target) (onPreload ?? onItemIntent)?.(target);
            }}
          >
            {workspace.label}
          </button>
        );
      })}
    </nav>
  );
}

/** Second row: only the current route's visible real modules. */
export function ModuleTabs<T extends AdminWorkspaceNavigationItem>({
  items,
  location,
  onNavigate,
  onItemIntent,
  onPreload,
  renderItem,
  renderBadge,
  className,
}: AdminModuleTabsProps<T>) {
  const { activeWorkspace, activeItem } = getAdminWorkspaceNavigationState(
    items,
    location
  );
  if (!activeWorkspace) return null;

  return (
    <nav
      className={`admin-workspace-nav__tabs admin-workspace-nav__tabs--modules${className ? ` ${className}` : ""}`}
      aria-label={`${activeWorkspace.label}模块菜单`}
      data-admin-navigation="module-tabs"
      data-workspace={activeWorkspace.id}
      onKeyDown={handleNavigationKeys}
    >
      {activeWorkspace.items.map(item => {
        const isActive = item.path === activeItem?.path;
        return (
          <button
            key={item.path}
            type="button"
            className="admin-workspace-nav__tab admin-workspace-nav__module"
            data-workspace-nav-target={item.path}
            data-active={isActive ? "true" : "false"}
            aria-current={isActive ? "page" : undefined}
            onClick={() => onNavigate(item)}
            onPointerEnter={() => (onPreload ?? onItemIntent)?.(item)}
            onFocus={() => (onPreload ?? onItemIntent)?.(item)}
          >
            {renderItem
              ? renderItem(item, { isActive, workspaceId: activeWorkspace.id })
              : item.label}
            {renderBadge?.(item)}
          </button>
        );
      })}
    </nav>
  );
}

/** Convenience wrapper. For a header with Logo/account on row one, import the
 * two named exports instead and pass the same items/location/onNavigate props.
 */
export function AdminWorkspaceNavigation<
  T extends AdminWorkspaceNavigationItem,
>(props: AdminWorkspaceNavigationProps<T>) {
  return (
    <div
      className={`admin-workspace-nav${props.className ? ` ${props.className}` : ""}`}
    >
      <WorkspaceTabs {...props} className={undefined} />
      <ModuleTabs {...props} className={undefined} />
    </div>
  );
}

export { WorkspaceTabs as AdminWorkspaceTabs, ModuleTabs as AdminModuleTabs };
