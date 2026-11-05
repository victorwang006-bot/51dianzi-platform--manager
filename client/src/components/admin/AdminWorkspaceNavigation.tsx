import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { BEIJING_TIME_ZONE } from "@shared/beijingTime";
import {
  getAdminWorkspaceNavigationState,
  getAdminWorkspaceNavigationTarget,
  groupAdminBusinessNavigationItems,
  type AdminBusinessNavigationGroupId,
  type AdminWorkspaceId,
  type AdminWorkspaceNavigationItem,
} from "./adminWorkspaceNavigationModel";
import "./AdminWorkspaceNavigation.css";

/** UI release only; native/business authorization versions remain independent. */
export const ADMIN_SYSTEM_RELEASE = "20261103-channel-permission-owner-v13-a2";

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
    "button[data-workspace-nav-target]:not([data-workspace-nav-child])"
  );
  if (!button || !event.currentTarget.contains(button)) return;
  const buttons = Array.from(
    event.currentTarget.querySelectorAll<HTMLButtonElement>(
      "button[data-workspace-nav-target]:not([data-workspace-nav-child])"
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
  renderItem,
  renderBadge,
  className,
}: AdminModuleTabsProps<T>) {
  const { workspaces, activeWorkspace, activeItem } = getAdminWorkspaceNavigationState(
    items,
    location
  );
  // Use visible workspaces, not the current workspace: ops URLs can open this too.
  const business = workspaces.find(workspace => workspace.id === "business");
  const entries = groupAdminBusinessNavigationItems(business?.items ?? []);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const instanceId = useId();
  const panelId = `${instanceId}-business`;
  const [open, setOpen] = useState<{
    items: readonly T[];
    location: string;
    top: number;
    left: number;
    maxHeight: number;
    focus?: "first" | "last";
  } | null>(null);
  // Render-time snapshots prevent a stale/unauthorized panel from flashing while
  // an effect is pending. No local selection or remembered navigation target.
  const expanded = !!(
    open && open.items === items && open.location === location && entries.length
  );

  function closeBusiness(restoreFocus = false) {
    // Hide before the parent's potentially synchronous callbacks, without using
    // react-dom/flushSync or a portal. React then removes the closed layer.
    if (layerRef.current) layerRef.current.hidden = true;
    triggerRef.current?.setAttribute("aria-expanded", "false");
    setOpen(null);
    if (restoreFocus) triggerRef.current?.focus({ preventScroll: true });
  }

  function openBusiness(focus?: "first" | "last") {
    const trigger = triggerRef.current;
    if (!trigger || !entries.length) return;
    const rect = trigger.getBoundingClientRect();
    const width = Math.min(336, window.innerWidth - 16);
    setOpen({
      items,
      location,
      top: rect.bottom + 4,
      left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)),
      maxHeight: Math.max(80, window.innerHeight - rect.bottom - 16),
      focus,
    });
  }

  useEffect(() => {
    if (open && !expanded) {
      setOpen(null);
      return;
    }
    if (!expanded || !open?.focus) return;
    const buttons = panelRef.current?.querySelectorAll<HTMLButtonElement>(
      "button[data-workspace-nav-child]"
    );
    const target = open.focus === "last" ? buttons?.[buttons.length - 1] : buttons?.[0];
    target?.focus({ preventScroll: true });
  }, [open, expanded]);

  useEffect(() => {
    if (!expanded) return;
    const isInside = (target: EventTarget | null) =>
      target instanceof Node &&
      (triggerRef.current?.contains(target) || layerRef.current?.contains(target));
    const dismissOutside = (event: Event) => {
      if (!isInside(event.target)) closeBusiness();
    };
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      closeBusiness(true);
    };
    const dismissMoved = (event: Event) => {
      if (event.target instanceof Node && panelRef.current?.contains(event.target)) return;
      closeBusiness();
    };
    document.addEventListener("pointerdown", dismissOutside);
    document.addEventListener("click", dismissOutside);
    document.addEventListener("focusin", dismissOutside);
    document.addEventListener("keydown", escape);
    window.addEventListener("resize", dismissMoved);
    window.addEventListener("scroll", dismissMoved, true);
    return () => {
      document.removeEventListener("pointerdown", dismissOutside);
      document.removeEventListener("click", dismissOutside);
      document.removeEventListener("focusin", dismissOutside);
      document.removeEventListener("keydown", escape);
      window.removeEventListener("resize", dismissMoved);
      window.removeEventListener("scroll", dismissMoved, true);
    };
  }, [expanded]);

  // Same item/button traversal as ModuleTabs, flattened across static groups;
  // drawer controls do not participate in the real navigation item sequence.
  function handleBusinessKeys(event: KeyboardEvent<HTMLElement>) {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const buttons = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>(
        "button[data-workspace-nav-child]"
      )
    );
    if (!buttons.length) return;
    const target = (event.target as HTMLElement).closest<HTMLButtonElement>(
      "button[data-workspace-nav-child]"
    );
    const index = target ? buttons.indexOf(target) : -1;
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? buttons.length - 1
          : (index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
    event.preventDefault();
    event.stopPropagation();
    buttons[next]?.focus({ preventScroll: true });
    buttons[next]?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }

  if (!workspaces.length) return null;

  function renderBusinessItem(item: T) {
    const isActive = item.path === activeItem?.path;
    return (
      <button
        key={item.path}
        type="button"
        className="admin-workspace-nav__tab admin-workspace-nav__module admin-workspace-nav__dropdown-item"
        data-workspace-nav-target={item.path}
        data-workspace-nav-child="true"
        data-business-dropdown-item={item.path}
        data-active={isActive ? "true" : "false"}
        aria-current={isActive ? "page" : undefined}
        onClick={() => {
          closeBusiness();
          onNavigate(item);
        }}
        onPointerEnter={() => (onPreload ?? onItemIntent)?.(item)}
        onFocus={() => (onPreload ?? onItemIntent)?.(item)}
      >
        {renderItem ? renderItem(item, { isActive, workspaceId: "business" }) : item.label}
        {renderBadge?.(item)}
      </button>
    );
  }

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
        const isBusiness = workspace.id === "business";
        return (
          <button
            key={workspace.id}
            ref={isBusiness ? triggerRef : undefined}
            id={isBusiness ? `${panelId}-trigger` : undefined}
            type="button"
            className={`admin-workspace-nav__tab admin-workspace-nav__workspace${isBusiness ? " admin-workspace-nav__business-trigger" : ""}`}
            data-workspace-nav-target={workspace.id}
            data-business-dropdown-trigger={isBusiness ? "true" : undefined}
            data-active={isActive ? "true" : "false"}
            aria-current={isActive ? "location" : undefined}
            aria-expanded={isBusiness ? expanded : undefined}
            aria-controls={isBusiness && expanded ? panelId : undefined}
            onClick={() => {
              if (isBusiness) {
                if (expanded) closeBusiness();
                else openBusiness();
                return;
              }
              closeBusiness();
              if (!isActive && target) onNavigate(target);
            }}
            onKeyDown={isBusiness ? event => {
              if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
              if (!["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)) return;
              event.preventDefault();
              if (expanded && ["Enter", " "].includes(event.key)) closeBusiness();
              else openBusiness(event.key === "ArrowUp" ? "last" : "first");
            } : undefined}
            onPointerEnter={() => {
              if (target) (onPreload ?? onItemIntent)?.(target);
            }}
            onFocus={() => {
              if (target) (onPreload ?? onItemIntent)?.(target);
            }}
          >
            {workspace.label}
            {isBusiness ? <span className="admin-workspace-nav__chevron" aria-hidden="true">▾</span> : null}
          </button>
        );
      })}
      {expanded && open ? (
        <div ref={layerRef} className="admin-workspace-nav__business-layer" data-business-dropdown="layer">
          <div
            className="admin-workspace-nav__business-backdrop"
            data-business-dropdown="backdrop"
            aria-hidden="true"
            onClick={() => closeBusiness(true)}
          />
          <div
            ref={panelRef}
            id={panelId}
            role="region"
            aria-labelledby={`${panelId}-trigger`}
            data-admin-navigation="business-dropdown"
            data-business-dropdown="panel"
            className="admin-workspace-nav__business-panel"
            style={{ top: open.top, left: open.left, maxHeight: open.maxHeight }}
            onKeyDown={handleBusinessKeys}
          >
            <div className="admin-workspace-nav__business-drawer-header">
              <span>业务工作台</span>
              <button
                type="button"
                className="admin-workspace-nav__business-close"
                aria-label="关闭业务工作台菜单"
                data-business-dropdown="close"
                onClick={() => closeBusiness(true)}
              >关闭</button>
            </div>
            <div className="admin-workspace-nav__business-content" data-business-dropdown="content">
              {entries.map(entry => entry.kind === "direct" ? (
                <div key={entry.item.path} className="admin-workspace-nav__business-direct" data-business-direct={entry.item.path}>
                  {renderBusinessItem(entry.item)}
                </div>
              ) : (
                <section
                  key={entry.id}
                  role="group"
                  aria-labelledby={`${panelId}-${entry.id}`}
                  className="admin-workspace-nav__business-section"
                  data-business-group={entry.id}
                  data-active={entry.items.some(item => item.path === activeItem?.path) ? "true" : "false"}
                >
                  <div id={`${panelId}-${entry.id}`} className="admin-workspace-nav__business-heading">{entry.label}</div>
                  {entry.items.map(item => renderBusinessItem(item))}
                </section>
              ))}
            </div>
          </div>
        </div>
      ) : null}
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
  const navRef = useRef<HTMLElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRefs = useRef(
    new Map<AdminBusinessNavigationGroupId, HTMLButtonElement>()
  );
  const pendingFocus = useRef<"first" | "last" | null>(null);
  const instanceId = useId();
  const [open, setOpen] = useState<{
    id: AdminBusinessNavigationGroupId;
    location: string;
    top: number;
    left: number;
    maxHeight: number;
  } | null>(null);
  const entries =
    activeWorkspace?.id === "business"
      ? groupAdminBusinessNavigationItems(activeWorkspace.items)
      : [];
  // A location or permission change must not preserve a stale popup or selection.
  const openEntry =
    open?.location === location
      ? entries.find(entry => entry.kind === "group" && entry.id === open.id)
      : undefined;
  const openId = openEntry?.kind === "group" ? openEntry.id : null;

  function closeGroup(restoreFocus = false) {
    if (restoreFocus && openId) triggerRefs.current.get(openId)?.focus();
    pendingFocus.current = null;
    setOpen(null);
  }

  function openGroup(
    id: AdminBusinessNavigationGroupId,
    focus?: "first" | "last"
  ) {
    const trigger = triggerRefs.current.get(id);
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    pendingFocus.current = focus ?? null;
    setOpen({
      id,
      location,
      top: rect.bottom,
      left: Math.max(8, Math.min(rect.left, window.innerWidth - 188)),
      maxHeight: Math.max(80, window.innerHeight - rect.bottom - 12),
    });
  }

  useEffect(() => {
    if (open && !openId) setOpen(null);
    if (!pendingFocus.current || !openId) return;
    const buttons =
      panelRef.current?.querySelectorAll<HTMLButtonElement>("button");
    const target =
      pendingFocus.current === "last"
        ? buttons?.[buttons.length - 1]
        : buttons?.[0];
    pendingFocus.current = null;
    target?.focus({ preventScroll: true });
  });

  useEffect(() => {
    if (!openId) return;
    const dismissOutside = (event: Event) => {
      if (!navRef.current?.contains(event.target as Node)) closeGroup();
    };
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      closeGroup(navRef.current?.contains(event.target as Node));
    };
    const dismissMoved = (event: Event) => {
      if (
        event.target instanceof Node &&
        panelRef.current?.contains(event.target)
      )
        return;
      closeGroup();
    };
    document.addEventListener("pointerdown", dismissOutside);
    document.addEventListener("click", dismissOutside);
    document.addEventListener("focusin", dismissOutside);
    document.addEventListener("keydown", escape);
    window.addEventListener("resize", dismissMoved);
    window.addEventListener("scroll", dismissMoved, true);
    return () => {
      document.removeEventListener("pointerdown", dismissOutside);
      document.removeEventListener("click", dismissOutside);
      document.removeEventListener("focusin", dismissOutside);
      document.removeEventListener("keydown", escape);
      window.removeEventListener("resize", dismissMoved);
      window.removeEventListener("scroll", dismissMoved, true);
    };
  }, [openId]);

  if (!activeWorkspace) return null;

  function renderModule(item: T, child = false) {
    const isActive = item.path === activeItem?.path;
    return (
      <button
        key={item.path}
        type="button"
        className={`admin-workspace-nav__tab admin-workspace-nav__module${child ? " admin-workspace-nav__dropdown-item" : ""}`}
        data-workspace-nav-target={item.path}
        data-workspace-nav-child={child ? "true" : undefined}
        data-active={isActive ? "true" : "false"}
        aria-current={isActive ? "page" : undefined}
        onClick={() => {
          closeGroup(child);
          onNavigate(item);
        }}
        onPointerEnter={() => (onPreload ?? onItemIntent)?.(item)}
        onFocus={() => (onPreload ?? onItemIntent)?.(item)}
      >
        {renderItem
          ? renderItem(item, { isActive, workspaceId: activeWorkspace!.id })
          : item.label}
        {renderBadge?.(item)}
      </button>
    );
  }

  return (
    <nav
      ref={navRef}
      className={`admin-workspace-nav__tabs admin-workspace-nav__tabs--modules${className ? ` ${className}` : ""}`}
      aria-label={`${activeWorkspace.label}模块菜单`}
      data-admin-navigation="module-tabs"
      data-workspace={activeWorkspace.id}
      onKeyDown={handleNavigationKeys}
    >
      {activeWorkspace.id !== "business"
        ? activeWorkspace.items.map(item => renderModule(item))
        : entries.map(entry => {
            if (entry.kind === "direct") return renderModule(entry.item);
            const expanded = openId === entry.id;
            const isActive = entry.items.some(
              item => item.path === activeItem?.path
            );
            const panelId = `${instanceId}-${entry.id}`;
            return (
              <div key={entry.id} className="admin-workspace-nav__group">
                <button
                  ref={node => {
                    if (node) triggerRefs.current.set(entry.id, node);
                    else triggerRefs.current.delete(entry.id);
                  }}
                  id={`${panelId}-trigger`}
                  type="button"
                  className="admin-workspace-nav__tab admin-workspace-nav__module admin-workspace-nav__group-trigger"
                  data-workspace-nav-target={`group:${entry.id}`}
                  data-active={isActive ? "true" : "false"}
                  aria-current={isActive ? "location" : undefined}
                  aria-expanded={expanded}
                  aria-controls={expanded ? panelId : undefined}
                  onClick={() =>
                    expanded ? closeGroup() : openGroup(entry.id)
                  }
                  onKeyDown={event => {
                    if (event.altKey || event.ctrlKey || event.metaKey) return;
                    if (
                      ["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)
                    ) {
                      event.preventDefault();
                      if (expanded && ["Enter", " "].includes(event.key))
                        closeGroup();
                      else
                        openGroup(
                          entry.id,
                          event.key === "ArrowUp" ? "last" : "first"
                        );
                    }
                  }}
                >
                  {entry.label}
                  <span
                    className="admin-workspace-nav__chevron"
                    aria-hidden="true"
                  >
                    ▾
                  </span>
                </button>
                {expanded && open ? (
                  <div
                    ref={panelRef}
                    id={panelId}
                    role="group"
                    aria-labelledby={`${panelId}-trigger`}
                    className="admin-workspace-nav__dropdown"
                    style={{
                      top: open.top,
                      left: open.left,
                      maxHeight: open.maxHeight,
                    }}
                    onKeyDown={event => {
                      if (
                        event.altKey ||
                        event.ctrlKey ||
                        event.metaKey ||
                        event.shiftKey
                      )
                        return;
                      if (
                        !["ArrowDown", "ArrowUp", "Home", "End"].includes(
                          event.key
                        )
                      )
                        return;
                      const buttons = Array.from(
                        event.currentTarget.querySelectorAll<HTMLButtonElement>(
                          "button"
                        )
                      );
                      const index = buttons.indexOf(
                        event.target as HTMLButtonElement
                      );
                      const next =
                        event.key === "Home"
                          ? 0
                          : event.key === "End"
                            ? buttons.length - 1
                            : (index +
                                (event.key === "ArrowDown" ? 1 : -1) +
                                buttons.length) %
                              buttons.length;
                      event.preventDefault();
                      event.stopPropagation();
                      buttons[next]?.focus({ preventScroll: true });
                    }}
                  >
                    {entry.items.map(item => renderModule(item, true))}
                  </div>
                ) : null}
              </div>
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
