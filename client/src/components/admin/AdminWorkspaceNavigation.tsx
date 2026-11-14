import {
  useEffect,
  useLayoutEffect,
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
  getChannelInventoryNavigationView,
  type ChannelInventoryNavigationTab,
  type ChannelInventoryNavigationView,
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
import { getAdminListLocationLayout } from "./adminListLocationLayout";
import InquiryReceptionNavigationBadge from "./InquiryReceptionNavigationBadge";
import { getSalesOrderNavigationContext, type SalesOrderSource } from "@/lib/salesOrderWorkspace";
import { getAdminWorkspaceDropdownWidth, getAdminWorkspaceDropdownLeft, getAdminWorkspaceSubmenuPlacement } from "@/lib/adminWorkspaceDropdownWidth";
import "./AdminWorkspaceNavigation.css";
import "./AdminListPage.css";

/** UI release only; native/business authorization versions remain independent. */
export const ADMIN_SYSTEM_RELEASE = "20261113-primary-menu-reminders-v1";

export type AdminWorkspaceTabsProps<T extends AdminWorkspaceNavigationItem> = {
  /** Already filtered by the existing native-admin/BFF capability checks. */
  items: readonly T[];
  /** Actual router location; query/hash may be included. No local selection state. */
  location: string;
  /** Original authorized item; optional channel/source arguments are display intents only. */
  onNavigate: (item: T, channelTab?: ChannelInventoryNavigationTab, channelView?: ChannelInventoryNavigationView, salesOrderSource?: SalesOrderSource) => void;
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

type UnifiedWorkspaceId = AdminWorkspaceId | "sales-orders" | "inventory-management" | "procurement-management";
const HOVER_CLOSE_DELAY = 180;

function channelQueryForLocation(location: string) {
  return location.includes("?") ? location.slice(location.indexOf("?") + 1).split("#", 1)[0] : "";
}

function channelTabForLocation(location: string) {
  return getChannelInventoryNavigationTab(channelQueryForLocation(location));
}

function channelViewForLocation(location: string): ChannelInventoryNavigationView {
  const tab = channelTabForLocation(location);
  // Historical channel archives belong to the channel entry; batches/trash to the list.
  return tab === "channels" ? "channels" : tab === "materials"
    ? getChannelInventoryNavigationView(channelQueryForLocation(location)) : "flat";
}

/** Read-only route context. No links, effects, requests or local selection state. */
export function AdminWorkspaceLocation<T extends AdminWorkspaceNavigationItem>({
  items,
  location,
}: Pick<AdminWorkspaceTabsProps<T>, "items" | "location">) {
  const { activeWorkspace, activeItem, route } = getAdminWorkspaceNavigationState(items, location);
  // Customer details already own a compact customer header and back action.
  // Remove this redundant full location row, not the top-level customer entry.
  if (/^\/workbench\/customers\/[^/?#]+(?:[/?#]|$)/.test(location)) return null;
  const salesContext = getSalesOrderNavigationContext(items, location);
  if (!salesContext.active && (!activeWorkspace || !activeItem)) return null;
  if (/^\/workbench\/(?:orders|sales-orders|outbound)(?:[/?#]|$)/.test(location) && !salesContext.active) return null;
  // An authorized outbound object can represent seller-only /orders. This is
  // display context only, never a synthesized CRM navigation item or grant.
  const labels = salesContext.active ? ["销售订单", salesContext.label!] : (() => {
    if (!activeWorkspace || !activeItem) return [];
    const channel = activeItem.path === CHANNEL_INVENTORY_ROUTE;
    const customer = activeItem.path === "/workbench/customers";
    const reception = activeItem.path === "/workbench/inquiries";
    const tab = channel ? channelTabForLocation(location) : null;
    const entry = !channel
      ? groupAdminWorkspaceModuleNavigationItems(activeWorkspace.items, activeWorkspace.id).find(entry =>
        entry.kind === "group" && entry.items.some(item => item.path === activeItem.path))
      : null;
    return channel
      ? ["库存列表", ...(channelViewForLocation(location) === "channels" ? ["渠道库存"] : []),
        ...(tab !== "materials" ? [CHANNEL_INVENTORY_TABS.find(item => item.id === tab)!.label] : [])]
      : customer ? [activeItem.label, ...(route?.label && route.label !== activeItem.label ? [route.label] : [])]
      : reception ? ["询价接待"]
      : activeItem.path === "/workbench/inbound" ? ["入库管理"]
      : activeWorkspace.id === "business" && entry?.kind === "group" ? [entry.label, activeItem.label]
      : [activeWorkspace.label, ...(entry?.kind === "group" ? [entry.label] : []), activeItem.label];
  })();
  return (
    <nav aria-label="当前位置" className="admin-workspace-nav__location" data-admin-navigation="current-location"
      data-admin-list-location-layout={getAdminListLocationLayout(location, labels)}>
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
  const customerItem = items.find(item => item.path === "/workbench/customers");
  const channelItem = items.find(item => item.path === CHANNEL_INVENTORY_ROUTE);
  const receptionItem = items.find(item => item.path === "/workbench/inquiries");
  const salesContext = getSalesOrderNavigationContext(items, location);
  const salesItem = salesContext.item;
  const filteredBusinessItems = state.workspaces.find(workspace => workspace.id === "business")
    ?.items.filter(item => item.path !== CHANNEL_INVENTORY_ROUTE && item.path !== "/workbench/customers" && item.path !== "/workbench/inquiries" && item.path !== "/workbench/orders" && item.path !== "/workbench/outbound") ?? [];
  const businessEntries = groupAdminBusinessNavigationItems(filteredBusinessItems);
  const operationsEntries = groupAdminOperationsNavigationItems(
    state.workspaces.find(workspace => workspace.id === "operations")?.items ?? []
  );
  const channelActive = !!channelItem && state.route?.canonicalPath === CHANNEL_INVENTORY_ROUTE;
  const customerActive = !!customerItem && state.route?.canonicalPath === "/workbench/customers";
  const receptionActive = !!receptionItem && state.route?.canonicalPath === "/workbench/inquiries";
  const salesActive = !!salesItem && salesContext.active;
  // Promote only already parent-authorized groups. Their canonical business
  // routes and the original item objects remain untouched.
  const workspaces: { id: UnifiedWorkspaceId; workspaceId: AdminWorkspaceId; label: string; items: readonly T[]; directItem?: T }[] = [
    ...businessEntries.flatMap(entry => entry.kind === "group" && (entry.id === "inventory" || entry.id === "procurement")
      ? [{ id: (entry.id === "inventory" ? "inventory-management" : "procurement-management") as UnifiedWorkspaceId,
        workspaceId: "business" as const,
        label: entry.id === "inventory" && entry.items.length === 1 && entry.items[0].path === "/workbench/inbound" ? "入库管理" : entry.label,
        items: entry.items,
        directItem: entry.id === "inventory" && entry.items.length === 1 && entry.items[0].path === "/workbench/inbound" ? entry.items[0] : undefined }] : [])
      .sort((left, right) => left.id === "procurement-management" ? -1 : right.id === "procurement-management" ? 1 : 0),
    ...(salesContext.entries.length ? [{ id: "sales-orders" as const, workspaceId: "business" as const,
      label: "销售订单", items: salesContext.entries.map(entry => entry.item) }] : []),
    ...state.workspaces.filter(workspace => workspace.id !== "business").map(workspace => ({
      ...workspace,
      workspaceId: workspace.id,
      directItem: workspace.id === "personal" ? workspace.items[0] : undefined,
    })),
  ];
  const activeWorkspaceId = state.activeWorkspace?.id === "business"
    ? workspaces.find(workspace => workspace.workspaceId === "business" && workspace.items.some(item => item.path === state.activeItem?.path))?.id ?? null
    : state.activeWorkspace?.id ?? null;
  const operationsMessageItem = operationsEntries.flatMap(entry => entry.kind === "group" ? entry.items : [entry.item])
    .find(item => item.path === "/messages");
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
    width: number;
    maxHeight: number;
    group: null | {
      id: AdminWorkspaceNavigationGroupId;
      source: "hover" | "activation";
      top: number;
      left: number;
      width: number;
      maxHeight: number;
      side: "left" | "right";
    };
    focus?: { level: 2 | 3; target: "first" | "last" | AdminWorkspaceNavigationGroupId };
  } | null>(null);
  const openWorkspace = open?.items === items && open.location === location
    ? workspaces.find(workspace => workspace.id === open.id) : undefined;
  const expanded = !!openWorkspace;
  const moduleEntries = open?.id === "operations" ? operationsEntries : [];
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

  function workspacePanelWidth(workspace: typeof workspaces[number], measuredWidth?: number) {
    const labels = workspace.id === "sales-orders" ? salesContext.entries.map(entry => entry.label)
      : workspace.id === "operations" ? operationsEntries.map(entry => entry.kind === "group" ? entry.label : entry.item.label)
      : workspace.items.map(item => item.label);
    return getAdminWorkspaceDropdownWidth(workspace.id, 2, {
      measuredWidth, labels, hasArrow: workspace.id === "operations", viewportWidth: window.innerWidth,
    });
  }

  function openWorkspaceMenu(id: UnifiedWorkspaceId, focus?: "first" | "last", source: "hover" | "activation" = "activation") {
    cancelHoverClose();
    // Re-entering a parent must not reset its selected child or steal focus.
    if (source === "hover" && expanded && open?.id === id) return;
    const workspace = workspaces.find(entry => entry.id === id);
    const trigger = triggerRefs.current.get(id);
    if (!workspace || workspace.directItem || !trigger) return;
    const rect = trigger.getBoundingClientRect();
    const width = workspacePanelWidth(workspace);
    const top = Math.max(8, Math.min(rect.bottom + 4, window.innerHeight - 56));
    setOpen({
      id, source, items, location, mobile: window.innerWidth <= 767,
      top, width,
      left: getAdminWorkspaceDropdownLeft(rect.left, width, window.innerWidth),
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
    const parentWidth = workspacePanelWidth(openWorkspace!, panelRef.current?.getBoundingClientRect().width);
    const childWidth = getAdminWorkspaceDropdownWidth(open.id, 3, { labels: entry.items.map(item => item.label), viewportWidth: window.innerWidth });
    const placement = getAdminWorkspaceSubmenuPlacement(open.left, parentWidth, childWidth, window.innerWidth);
    const desiredHeight = Math.min(entry.items.length * 40 + 10, window.innerHeight - 16);
    const top = Math.max(8, Math.min(rect.top, window.innerHeight - desiredHeight - 8));
    setOpen({
      ...open,
      group: {
        id, source, top, ...placement, width: childWidth,
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

  // CSS max-content sizes each level from its real longest rendered row. Measure
  // before paint, then remeasure badge/custom content/font changes without focus.
  useLayoutEffect(() => {
    if (!expanded || !open || !openWorkspace || open.mobile) return;
    let disposed = false;
    const measurePanels = () => {
      if (disposed || layerRef.current?.hidden) return;
      const trigger = triggerRefs.current.get(open.id);
      if (!trigger || !panelRef.current) return;
      const width = workspacePanelWidth(openWorkspace, panelRef.current.getBoundingClientRect().width);
      const left = getAdminWorkspaceDropdownLeft(trigger.getBoundingClientRect().left, width, window.innerWidth);
      const childWidth = group ? getAdminWorkspaceDropdownWidth(open.id, 3, {
        measuredWidth: childPanelRef.current?.getBoundingClientRect().width,
        labels: group.items.map(item => item.label), viewportWidth: window.innerWidth,
      }) : null;
      const placement = childWidth !== null ? getAdminWorkspaceSubmenuPlacement(left, width, childWidth, window.innerWidth) : null;
      setOpen(current => {
        if (!current || current.id !== open.id || current.items !== items || current.location !== location) return current;
        const childChanged = current.group && placement && (current.group.left !== placement.left || current.group.side !== placement.side || current.group.width !== childWidth);
        if (current.width === width && current.left === left && !childChanged) return current;
        return { ...current, width, left,
          group: current.group && placement ? { ...current.group, ...placement, width: childWidth! } : current.group };
      });
    };
    measurePanels();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measurePanels);
    observer?.observe(panelRef.current!);
    if (childPanelRef.current) observer?.observe(childPanelRef.current);
    document.fonts?.addEventListener("loadingdone", measurePanels);
    void document.fonts?.ready.then(measurePanels);
    return () => { disposed = true; observer?.disconnect(); document.fonts?.removeEventListener("loadingdone", measurePanels); };
  }, [open, expanded]);

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

  function renderLeaf(item: T, workspaceId: AdminWorkspaceId, level: 2 | 3, salesSource?: SalesOrderSource) {
    const salesEntry = salesSource ? salesContext.entries.find(entry => entry.source === salesSource && entry.item === item) : undefined;
    const isActive = salesSource ? salesContext.active && salesContext.source === salesSource : item.path === state.activeItem?.path;
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
        data-order-source={salesSource}
        data-active={isActive ? "true" : "false"}
        aria-current={isActive ? "page" : undefined}
        onClick={() => {
          closeWorkspace();
          if (salesSource) onNavigate(item, undefined, undefined, salesSource);
          else onNavigate(item);
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
        {salesEntry ? salesEntry.label : renderItem ? renderItem(item, { isActive, workspaceId }) : item.label}
        {renderBadge?.(item)}
      </button>
    );
  }

  if (!customerItem && !channelItem && !receptionItem && !salesItem && !workspaces.length) return null;

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
      {customerItem ? (
        <button type="button"
          className="admin-workspace-nav__tab admin-workspace-nav__workspace"
          data-workspace-nav-target="customers" data-navigation-level="1"
          data-active={customerActive ? "true" : "false"} aria-current={customerActive ? "page" : undefined}
          onClick={() => { closeWorkspace(); onNavigate(customerItem); }}
          onPointerEnter={event => {
            cancelHoverClose();
            if (isDesktopMouse(event) && expanded) closeWorkspace();
            (onPreload ?? onItemIntent)?.(customerItem);
          }}
          onFocus={() => (onPreload ?? onItemIntent)?.(customerItem)}
        >客户列表{renderBadge?.(customerItem)}</button>
      ) : null}
      {channelItem ? (
        <button type="button"
          className="admin-workspace-nav__tab admin-workspace-nav__workspace"
          title="渠道物料查询"
          data-workspace-nav-target="inventory"
          data-navigation-level="1" data-channel-view="flat"
          data-active={channelActive ? "true" : "false"} aria-current={channelActive ? "page" : undefined}
          onClick={() => { closeWorkspace(); onNavigate(channelItem, "materials", "flat"); }}
          onPointerEnter={event => {
            cancelHoverClose();
            if (isDesktopMouse(event) && expanded) closeWorkspace();
            (onPreload ?? onItemIntent)?.(channelItem);
          }}
          onFocus={() => (onPreload ?? onItemIntent)?.(channelItem)}
        >库存列表{renderBadge?.(channelItem)}</button>
      ) : null}
      {receptionItem ? (
        <button type="button"
          className="admin-workspace-nav__tab admin-workspace-nav__workspace"
          data-workspace-nav-target="inquiries" data-navigation-level="1"
          data-active={receptionActive ? "true" : "false"} aria-current={receptionActive ? "page" : undefined}
          onClick={() => { closeWorkspace(); onNavigate(receptionItem); }}
          onPointerEnter={event => {
            cancelHoverClose();
            if (isDesktopMouse(event) && expanded) closeWorkspace();
            (onPreload ?? onItemIntent)?.(receptionItem);
          }}
          onFocus={() => (onPreload ?? onItemIntent)?.(receptionItem)}
        >询价接待<InquiryReceptionNavigationBadge /></button>
      ) : null}
      {workspaces.map(workspace => {
        const isActive = workspace.id === "sales-orders" ? salesActive : workspace.id === activeWorkspaceId;
        const isExpanded = expanded && open?.id === workspace.id;
        const id = `${instanceId}-${workspace.id}`;
        if (workspace.directItem) {
          const item = workspace.directItem;
          return (
            <button key={workspace.id} type="button"
              className="admin-workspace-nav__tab admin-workspace-nav__workspace"
              title={workspace.label} data-workspace-nav-target={workspace.id} data-navigation-level="1"
              data-workspace-direct-item={item.path}
              data-active={isActive ? "true" : "false"} aria-current={isActive ? "page" : undefined}
              onClick={() => { closeWorkspace(); onNavigate(item); }}
              onPointerEnter={event => {
                cancelHoverClose();
                if (isDesktopMouse(event) && expanded) closeWorkspace();
                (onPreload ?? onItemIntent)?.(item);
              }}
              onFocus={() => (onPreload ?? onItemIntent)?.(item)}
            >{workspace.label}{renderBadge?.(item)}</button>
          );
        }
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
            title={workspace.id === "inventory-management" ? "入库管理" : undefined}
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
              (onPreload ?? onItemIntent)?.(workspace.id === "sales-orders" ? salesItem! : workspace.items[0]);
            }}
            onPointerLeave={scheduleHoverClose}
            onFocus={() => (onPreload ?? onItemIntent)?.(workspace.id === "sales-orders" ? salesItem! : workspace.items[0])}
          >
            {workspace.label}
            {workspace.id === "sales-orders" && salesItem ? renderBadge?.(salesItem) : null}
            {workspace.id === "operations" && operationsMessageItem ? renderBadge?.(operationsMessageItem) : null}
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
            data-dropdown-measured-width={open.width}
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
              {open.id === "operations" ? moduleEntries.map(entry => entry.kind === "direct"
                ? renderLeaf(entry.item, openWorkspace.workspaceId, 2)
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
                    {entry.label}
                    {entry.items.find(item => item.path === "/messages") ? renderBadge?.(entry.items.find(item => item.path === "/messages")!) : null}
                    <span className="admin-workspace-nav__chevron" aria-hidden="true">›</span>
                  </button>
                )) : open.id === "sales-orders" ? salesContext.entries.map(entry => renderLeaf(entry.item, openWorkspace.workspaceId, 2, entry.source))
                  : openWorkspace.items.map(item => renderLeaf(item, openWorkspace.workspaceId, 2))}
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
              data-dropdown-measured-width={open.group.width}
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
                {group.items.map(item => renderLeaf(item, openWorkspace.workspaceId, 3))}
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
    items: readonly T[];
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
    open?.items === items && open.location === location
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
      items,
      location,
      top: rect.bottom,
      left: Math.max(8, Math.min(rect.left, window.innerWidth - 188)),
      maxHeight: Math.max(80, window.innerHeight - rect.bottom - 12),
    });
  }

  useEffect(() => {
    if (open && !openId) {
      pendingFocus.current = null;
      setOpen(null);
      return;
    }
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
