import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from "react";
import { BEIJING_TIME_ZONE } from "@shared/beijingTime";
import {
  CHANNEL_INVENTORY_ROUTE,
  CHANNEL_INVENTORY_TABS,
  getChannelInventoryNavigationTab,
  type ChannelInventoryNavigationTab,
} from "@/lib/channelInventoryNavigation";
import {
  getAdminWorkspaceNavigationState,
  groupAdminBusinessNavigationItems,
  groupAdminOperationsNavigationItems,
  groupAdminWorkspaceModuleNavigationItems,
  type AdminWorkspaceNavigationGroupId,
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
  /** Original authorized item; the second argument is only a channel tab intent. */
  onNavigate: (item: T, channelTab?: ChannelInventoryNavigationTab) => void;
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

type UnifiedWorkspaceId = "channel" | AdminWorkspaceId;
const WORKSPACE_PANEL_WIDTH = 212;
const HOVER_CLOSE_DELAY = 180;

function channelTabForLocation(location: string) {
  const query = location.includes("?") ? location.slice(location.indexOf("?") + 1).split("#", 1)[0] : "";
  return getChannelInventoryNavigationTab(query);
}

/** Read-only route context. No links, effects, requests or local selection state. */
export function AdminWorkspaceLocation<T extends AdminWorkspaceNavigationItem>({
  items,
  location,
}: Pick<AdminWorkspaceTabsProps<T>, "items" | "location">) {
  const { activeWorkspace, activeItem } = getAdminWorkspaceNavigationState(items, location);
  if (!activeWorkspace || !activeItem) return null;
  const channel = activeItem.path === CHANNEL_INVENTORY_ROUTE;
  const tab = channel ? channelTabForLocation(location) : null;
  const entry = !channel
    ? groupAdminWorkspaceModuleNavigationItems(activeWorkspace.items, activeWorkspace.id).find(entry =>
      entry.kind === "group" && entry.items.some(item => item.path === activeItem.path))
    : null;
  const labels = channel
    ? ["渠道库存", ...(tab !== "materials" ? [CHANNEL_INVENTORY_TABS.find(item => item.id === tab)!.label] : [])]
    : [activeWorkspace.label, ...(entry?.kind === "group" ? [entry.label] : []), activeItem.label];
  return (
    <nav aria-label="当前位置" className="admin-workspace-nav__location" data-admin-navigation="current-location">
      <ol>
        {labels.map((label, index) => (
          <li key={`${index}-${label}`}>
            {index > 0 ? <span className="admin-workspace-nav__location-separator" aria-hidden="true">&gt;</span> : null}
            <span aria-current={index === labels.length - 1 ? "page" : undefined}>{label}</span>
          </li>
        ))}
      </ol>
    </nav>
  );
}

/** One header row, one open workspace, and at most one open module group.
 * Permission/location snapshots also guard delayed focus work before effects run.
 */
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
  const state = getAdminWorkspaceNavigationState(items, location);
  const channelItem = items.find(item => item.path === CHANNEL_INVENTORY_ROUTE);
  const filteredBusinessItems = state.workspaces.find(workspace => workspace.id === "business")
    ?.items.filter(item => item.path !== CHANNEL_INVENTORY_ROUTE) ?? [];
  const businessEntries = groupAdminBusinessNavigationItems(filteredBusinessItems);
  const operationsEntries = groupAdminOperationsNavigationItems(
    state.workspaces.find(workspace => workspace.id === "operations")?.items ?? []
  );
  const channelActive = !!channelItem && state.route?.canonicalPath === CHANNEL_INVENTORY_ROUTE;
  const channelTab = channelTabForLocation(location);
  const workspaces: { id: UnifiedWorkspaceId; label: string; items: readonly T[] }[] = [
    ...(channelItem ? [{ id: "channel" as const, label: "渠道库存", items: [channelItem] }] : []),
    ...state.workspaces.flatMap(workspace => workspace.id === "business"
      ? businessEntries.length ? [{ ...workspace, items: filteredBusinessItems }] : []
      : [workspace]),
  ];
  const activeWorkspaceId = channelActive ? "channel"
    : state.route?.canonicalPath !== CHANNEL_INVENTORY_ROUTE ? state.activeWorkspace?.id : null;
  const navRef = useRef<HTMLElement>(null);
  const triggerRefs = useRef(new Map<UnifiedWorkspaceId, HTMLButtonElement>());
  const groupRefs = useRef(new Map<AdminWorkspaceNavigationGroupId, HTMLButtonElement>());
  const layerRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const childPanelRef = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const instanceId = useId();
  const [open, setOpen] = useState<{
    id: UnifiedWorkspaceId;
    source: "hover" | "activation";
    items: readonly T[];
    location: string;
    mobile: boolean;
    top: number;
    left: number;
    maxHeight: number;
    group: null | {
      id: AdminWorkspaceNavigationGroupId;
      source: "hover" | "activation";
      top: number;
      left: number;
      maxHeight: number;
      side: "left" | "right";
    };
    focus?: { level: 2 | 3; target: "first" | "last" | AdminWorkspaceNavigationGroupId };
  } | null>(null);
  const openWorkspace = open?.items === items && open.location === location
    ? workspaces.find(workspace => workspace.id === open.id) : undefined;
  const expanded = !!openWorkspace;
  const moduleEntries = open?.id === "business" ? businessEntries
    : open?.id === "operations" ? operationsEntries : [];
  const selectedGroup = expanded && open?.group
    ? moduleEntries.find(entry => entry.kind === "group" && entry.id === open.group?.id)
    : undefined;
  const group = selectedGroup?.kind === "group" ? selectedGroup : null;
  const panelId = `${instanceId}-${open?.id ?? "workspace"}`;
  const childPanelId = `${panelId}-${group?.id ?? "group"}`;

  function cancelHoverClose() {
    if (closeTimer.current !== null) clearTimeout(closeTimer.current);
    closeTimer.current = null;
  }

  function isDesktopMouse(event: PointerEvent<HTMLElement>) {
    return event.pointerType === "mouse" && window.innerWidth > 767;
  }

  function scheduleHoverClose(event: PointerEvent<HTMLElement>) {
    if (!isDesktopMouse(event) || !expanded) return;
    // Fixed panels are still nav descendants. Crossing into either panel is safe,
    // and a small outside gap gets time to be traversed before dismissal.
    if (event.relatedTarget instanceof Node && navRef.current?.contains(event.relatedTarget)) return;
    cancelHoverClose();
    closeTimer.current = setTimeout(() => closeWorkspace(), HOVER_CLOSE_DELAY);
  }

  function closeWorkspace(restoreFocus = false) {
    cancelHoverClose();
    // The old layer disappears before a synchronous parent navigation callback.
    if (layerRef.current) layerRef.current.hidden = true;
    if (open) triggerRefs.current.get(open.id)?.setAttribute("aria-expanded", "false");
    setOpen(null);
    if (restoreFocus && expanded && open) triggerRefs.current.get(open.id)?.focus({ preventScroll: true });
  }

  function openWorkspaceMenu(id: UnifiedWorkspaceId, focus?: "first" | "last", source: "hover" | "activation" = "activation") {
    cancelHoverClose();
    // Re-entering a parent must not reset its selected child or steal focus.
    if (source === "hover" && expanded && open?.id === id) return;
    const workspace = workspaces.find(entry => entry.id === id);
    const trigger = triggerRefs.current.get(id);
    if (!workspace || !trigger) return;
    const rect = trigger.getBoundingClientRect();
    const width = Math.min(WORKSPACE_PANEL_WIDTH, window.innerWidth - 16);
    const top = Math.max(8, Math.min(rect.bottom + 4, window.innerHeight - 56));
    setOpen({
      id, source, items, location, mobile: window.innerWidth <= 767,
      top,
      left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)),
      maxHeight: Math.max(0, window.innerHeight - top - 8),
      group: null,
      focus: focus ? { level: 2, target: focus } : undefined,
    });
  }

  function openModuleGroup(id: AdminWorkspaceNavigationGroupId, focus?: "first" | "last", source: "hover" | "activation" = "activation") {
    cancelHoverClose();
    if (source === "hover" && group?.id === id) return;
    const entry = moduleEntries.find(entry => entry.kind === "group" && entry.id === id);
    const trigger = groupRefs.current.get(id);
    if (!expanded || !open || entry?.kind !== "group" || !trigger) return;
    const rect = trigger.getBoundingClientRect();
    const side = open.left + WORKSPACE_PANEL_WIDTH * 2 <= window.innerWidth - 8 ? "right" : "left";
    const desiredHeight = Math.min(entry.items.length * 40 + 10, window.innerHeight - 16);
    const top = Math.max(8, Math.min(rect.top, window.innerHeight - desiredHeight - 8));
    setOpen({
      ...open,
      group: {
        id, source, top, side,
        left: side === "right" ? open.left + WORKSPACE_PANEL_WIDTH
          : Math.max(8, open.left - WORKSPACE_PANEL_WIDTH),
        maxHeight: Math.max(0, window.innerHeight - top - 8),
      },
      focus: focus || open.mobile ? { level: 3, target: focus ?? "first" } : undefined,
    });
  }

  function backToGroups() {
    cancelHoverClose();
    if (!expanded || !open || !group) return;
    if (childPanelRef.current) childPanelRef.current.hidden = true;
    setOpen({ ...open, group: null, focus: { level: 2, target: group.id } });
  }

  // Cancel delayed work on URL/query, permission snapshot changes and unmount.
  useEffect(() => () => cancelHoverClose(), [items, location]);

  useEffect(() => {
    if (open && !expanded) {
      setOpen(null);
      return;
    }
    if (!expanded || !open?.focus) return;
    const panel = open.focus.level === 3 ? childPanelRef.current : panelRef.current;
    if (!panel || panel.hidden) return;
    const buttons = panel.querySelectorAll<HTMLButtonElement>("button[data-navigation-choice]");
    const target = open.focus.target === "last" ? buttons[buttons.length - 1]
      : open.focus.target === "first" ? buttons[0]
      : groupRefs.current.get(open.focus.target);
    // Consume focus, so later renders/badge updates cannot steal it back.
    setOpen(current => current === open ? { ...current, focus: undefined } : current);
    target?.focus({ preventScroll: true });
  }, [open, expanded]);

  useEffect(() => {
    if (!expanded) return;
    const dismissOutside = (event: Event) => {
      const nav = navRef.current;
      // A mobile back/leaf click can remove its target before document bubbling.
      // Its original composed path still proves that the event began inside nav.
      const beganInside = !!nav && (event.composedPath().includes(nav)
        || event.target instanceof Node && nav.contains(event.target));
      if (!beganInside) closeWorkspace();
    };
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      closeWorkspace(true);
    };
    const dismissMoved = (event: Event) => {
      // Focusing a clipped top-level button can scroll this horizontal strip
      // after its click. The mobile drawer is viewport-anchored; desktop can
      // re-anchor its menu instead of dismissing a menu that was just opened.
      if (event.target === navRef.current) {
        if (open && !open.mobile) openWorkspaceMenu(open.id);
        return;
      }
      if (event.target instanceof Node &&
        (panelRef.current?.contains(event.target) || childPanelRef.current?.contains(event.target))) return;
      closeWorkspace();
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
  }, [expanded, open?.id, items, location]);

  function handlePanelKeys(event: KeyboardEvent<HTMLDivElement>, level: 2 | 3) {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (event.key === "ArrowLeft" && level === 3) {
      event.preventDefault();
      event.stopPropagation();
      backToGroups();
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button[data-navigation-choice]"));
    const index = buttons.indexOf((event.target as HTMLElement).closest<HTMLButtonElement>("button")!);
    if (!buttons.length) return;
    const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1
      : (index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
    event.preventDefault();
    event.stopPropagation();
    buttons[next]?.focus({ preventScroll: true });
    buttons[next]?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }

  function renderLeaf(item: T, workspaceId: AdminWorkspaceId, level: 2 | 3) {
    const isActive = item.path === state.activeItem?.path;
    return (
      <button
        key={item.path}
        type="button"
        className="admin-workspace-nav__tab admin-workspace-nav__module admin-workspace-nav__dropdown-item"
        data-workspace-nav-target={item.path}
        data-workspace-nav-child="true"
        data-navigation-choice="item"
        data-navigation-level={level}
        data-workspace-dropdown-item={item.path}
        data-active={isActive ? "true" : "false"}
        aria-current={isActive ? "page" : undefined}
        onClick={() => {
          closeWorkspace();
          onNavigate(item);
        }}
        onPointerEnter={event => {
          cancelHoverClose();
          if (level === 2 && isDesktopMouse(event) && open?.group) {
            setOpen({ ...open, group: null, focus: undefined });
          }
          (onPreload ?? onItemIntent)?.(item);
        }}
        onFocus={() => (onPreload ?? onItemIntent)?.(item)}
      >
        {renderItem ? renderItem(item, { isActive, workspaceId }) : item.label}
        {renderBadge?.(item)}
      </button>
    );
  }

  if (!workspaces.length) return null;

  return (
    <nav
      ref={navRef}
      className={`admin-workspace-nav__tabs admin-workspace-nav__tabs--workspaces${className ? ` ${className}` : ""}`}
      aria-label="工作区切换"
      data-admin-navigation="unified-dropdown"
      data-system-version={ADMIN_SYSTEM_RELEASE}
      data-display-time-zone={BEIJING_TIME_ZONE}
      title={`系统版本：${ADMIN_SYSTEM_RELEASE} · 北京时间（UTC+8）`}
      onKeyDown={handleNavigationKeys}
      onPointerLeave={scheduleHoverClose}
    >
      {workspaces.map(workspace => {
        const isActive = workspace.id === activeWorkspaceId;
        const isExpanded = expanded && open?.id === workspace.id;
        const id = `${instanceId}-${workspace.id}`;
        return (
          <button
            key={workspace.id}
            ref={node => {
              if (node) triggerRefs.current.set(workspace.id, node);
              else triggerRefs.current.delete(workspace.id);
            }}
            id={`${id}-trigger`}
            type="button"
            className="admin-workspace-nav__tab admin-workspace-nav__workspace admin-workspace-nav__workspace-trigger"
            data-workspace-nav-target={workspace.id}
            data-navigation-level="1"
            data-workspace-dropdown-trigger={workspace.id}
            data-active={isActive ? "true" : "false"}
            aria-current={isActive ? "location" : undefined}
            aria-expanded={isExpanded}
            aria-controls={isExpanded ? id : undefined}
            onClick={() => {
              if (isExpanded && open?.source === "activation") closeWorkspace();
              else if (isExpanded && open) {
                cancelHoverClose();
                setOpen({ ...open, source: "activation" });
              } else openWorkspaceMenu(workspace.id);
            }}
            onKeyDown={event => {
              if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
              if (!["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)) return;
              event.preventDefault();
              if (isExpanded && ["Enter", " "].includes(event.key)) closeWorkspace();
              else openWorkspaceMenu(workspace.id, event.key === "ArrowUp" ? "last" : "first");
            }}
            onPointerEnter={event => {
              cancelHoverClose();
              if (isDesktopMouse(event)) openWorkspaceMenu(workspace.id, undefined, "hover");
              (onPreload ?? onItemIntent)?.(workspace.items[0]);
            }}
            onPointerLeave={scheduleHoverClose}
            onFocus={() => (onPreload ?? onItemIntent)?.(workspace.items[0])}
          >
            {workspace.label}
            <span className="admin-workspace-nav__chevron" aria-hidden="true">▾</span>
          </button>
        );
      })}
      {expanded && open && openWorkspace ? (
        <div
          ref={layerRef}
          className="admin-workspace-nav__workspace-layer"
          data-workspace-dropdown="layer"
          data-workspace={open.id}
          data-drawer={open.mobile ? "true" : "false"}
        >
          <div
            className="admin-workspace-nav__workspace-backdrop"
            data-workspace-dropdown="backdrop"
            aria-hidden="true"
            onClick={() => closeWorkspace(true)}
          />
          <div
            ref={panelRef}
            id={panelId}
            role="region"
            aria-labelledby={`${panelId}-trigger`}
            data-admin-navigation="workspace-dropdown"
            data-workspace-dropdown="panel"
            data-workspace={open.id}
            data-navigation-level="2"
            className="admin-workspace-nav__workspace-panel"
            hidden={open.mobile && !!group}
            style={{ top: open.top, left: open.left, maxHeight: open.maxHeight }}
            onKeyDown={event => handlePanelKeys(event, 2)}
            onPointerEnter={cancelHoverClose}
            onPointerLeave={scheduleHoverClose}
          >
            <div className="admin-workspace-nav__workspace-drawer-header">
              <span>{openWorkspace.label}</span>
              <button type="button" className="admin-workspace-nav__workspace-control"
                aria-label={`关闭${openWorkspace.label}菜单`} data-workspace-dropdown="close"
                onClick={() => closeWorkspace(true)}>关闭</button>
            </div>
            <div className="admin-workspace-nav__workspace-content" data-workspace-dropdown="content">
              {open.id === "channel" && channelItem ? CHANNEL_INVENTORY_TABS.map(tab => {
                const isActive = channelActive && channelTab === tab.id;
                return (
                  <button key={tab.id} type="button"
                    className="admin-workspace-nav__tab admin-workspace-nav__module admin-workspace-nav__dropdown-item"
                    data-workspace-nav-target={`channel:${tab.id}`} data-workspace-nav-child="true"
                    data-navigation-choice="item" data-navigation-level="2" data-channel-tab={tab.id}
                    data-active={isActive ? "true" : "false"} aria-current={isActive ? "page" : undefined}
                    onClick={() => { closeWorkspace(); onNavigate(channelItem, tab.id); }}
                    onPointerEnter={() => (onPreload ?? onItemIntent)?.(channelItem)}
                    onFocus={() => (onPreload ?? onItemIntent)?.(channelItem)}
                  >{tab.label}</button>
                );
              }) : open.id === "business" || open.id === "operations" ? moduleEntries.map(entry => entry.kind === "direct"
                ? renderLeaf(entry.item, open.id as AdminWorkspaceId, 2)
                : (
                  <button key={entry.id}
                    ref={node => {
                      if (node) groupRefs.current.set(entry.id, node);
                      else groupRefs.current.delete(entry.id);
                    }}
                    id={`${panelId}-${entry.id}-trigger`} type="button"
                    className="admin-workspace-nav__tab admin-workspace-nav__module admin-workspace-nav__dropdown-item admin-workspace-nav__group-trigger"
                    data-workspace-nav-target={`group:${entry.id}`} data-workspace-nav-child="true"
                    data-navigation-choice="group" data-navigation-level="2" data-workspace-group={entry.id}
                    data-business-group={open.id === "business" ? entry.id : undefined}
                    data-active={entry.items.some(item => item.path === state.activeItem?.path) ? "true" : "false"}
                    aria-current={entry.items.some(item => item.path === state.activeItem?.path) ? "location" : undefined}
                    aria-expanded={group?.id === entry.id}
                    aria-controls={group?.id === entry.id ? childPanelId : undefined}
                    onClick={() => group?.id === entry.id && open.group?.source === "activation" ? backToGroups() : openModuleGroup(entry.id)}
                    onPointerEnter={event => {
                      cancelHoverClose();
                      if (isDesktopMouse(event)) openModuleGroup(entry.id, undefined, "hover");
                    }}
                    onKeyDown={event => {
                      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
                      if (!["ArrowRight", "Enter", " "].includes(event.key)) return;
                      event.preventDefault();
                      event.stopPropagation();
                      if (group?.id === entry.id && event.key !== "ArrowRight") backToGroups();
                      else openModuleGroup(entry.id, "first");
                    }}
                  >
                    {entry.label}<span className="admin-workspace-nav__chevron" aria-hidden="true">›</span>
                  </button>
                )) : openWorkspace.items.map(item => renderLeaf(item, open.id as AdminWorkspaceId, 2))}
            </div>
          </div>
          {group && open.group ? (
            <div
              ref={childPanelRef} id={childPanelId} role="region"
              aria-labelledby={`${childPanelId}-trigger`}
              data-admin-navigation="workspace-dropdown" data-workspace-dropdown="panel"
              data-workspace={open.id} data-navigation-level="3" data-workspace-submenu={group.id}
              data-business-submenu={open.id === "business" ? group.id : undefined}
              data-submenu-side={open.group.side}
              className="admin-workspace-nav__workspace-panel admin-workspace-nav__workspace-panel--children"
              style={{ top: open.group.top, left: open.group.left, maxHeight: open.group.maxHeight }}
              onKeyDown={event => handlePanelKeys(event, 3)}
              onPointerEnter={cancelHoverClose}
              onPointerLeave={scheduleHoverClose}
            >
              <div className="admin-workspace-nav__workspace-drawer-header">
                <button type="button" className="admin-workspace-nav__workspace-control"
                  data-workspace-dropdown="back" aria-label={`返回${openWorkspace.label}菜单`}
                  onClick={backToGroups}>← 返回</button>
                <span>{group.label}</span>
                <button type="button" className="admin-workspace-nav__workspace-control"
                  data-workspace-dropdown="close" aria-label={`关闭${openWorkspace.label}菜单`}
                  onClick={() => closeWorkspace(true)}>关闭</button>
              </div>
              <div className="admin-workspace-nav__workspace-content" data-workspace-dropdown="content">
                {group.items.map(item => renderLeaf(item, open.id as AdminWorkspaceId, 3))}
              </div>
            </div>
          ) : null}
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
    new Map<AdminWorkspaceNavigationGroupId, HTMLButtonElement>()
  );
  const pendingFocus = useRef<"first" | "last" | null>(null);
  const instanceId = useId();
  const [open, setOpen] = useState<{
    id: AdminWorkspaceNavigationGroupId;
    location: string;
    top: number;
    left: number;
    maxHeight: number;
  } | null>(null);
  const entries =
    activeWorkspace
      ? groupAdminWorkspaceModuleNavigationItems(activeWorkspace.items, activeWorkspace.id)
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
    id: AdminWorkspaceNavigationGroupId,
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
      {activeWorkspace.id === "organization"
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

/** @deprecated Prefer WorkspaceTabs directly in the existing header row.
 * This compatibility wrapper intentionally does not render a second module row.
 */
export function AdminWorkspaceNavigation<
  T extends AdminWorkspaceNavigationItem,
>(props: AdminWorkspaceNavigationProps<T>) {
  return (
    <div
      className={`admin-workspace-nav${props.className ? ` ${props.className}` : ""}`}
    >
      <WorkspaceTabs {...props} className={undefined} />
    </div>
  );
}

export { WorkspaceTabs as AdminWorkspaceTabs, ModuleTabs as AdminModuleTabs };
