import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  autoOpenAdminWorkbenchNavigationGroup,
  groupAdminWorkbenchNavigationItems,
  readAdminWorkbenchNavigationExpandedGroups,
  writeAdminWorkbenchNavigationExpandedGroups,
  type AdminWorkbenchNavigationExpandedGroups,
  type AdminWorkbenchNavigationGroupId,
  type AdminWorkbenchNavigationItem,
} from "./adminWorkbenchNavigationModel";
import "./AdminWorkbenchNavigation.css";

type AdminWorkbenchNavigationProps<T extends AdminWorkbenchNavigationItem> = {
  items: T[];
  renderItem: (item: T) => ReactNode;
  location: string;
  accountId: string | number;
  collapsed: boolean;
};

export function AdminWorkbenchNavigation<
  T extends AdminWorkbenchNavigationItem,
>(props: AdminWorkbenchNavigationProps<T>) {
  // Re-mounting by account makes an account switch read only that account's
  // saved state instead of briefly carrying over the previous account's state.
  return (
    <AdminWorkbenchNavigationContent
      key={String(props.accountId)}
      {...props}
    />
  );
}

function AdminWorkbenchNavigationContent<
  T extends AdminWorkbenchNavigationItem,
>({
  items,
  renderItem,
  location,
  accountId,
  collapsed,
}: AdminWorkbenchNavigationProps<T>) {
  const [expandedGroups, setExpandedGroups] =
    useState<AdminWorkbenchNavigationExpandedGroups>(() =>
      autoOpenAdminWorkbenchNavigationGroup(
        readAdminWorkbenchNavigationExpandedGroups(accountId),
        location
      )
    );
  const previousLocationRef = useRef(location);
  const groups = groupAdminWorkbenchNavigationItems(items);

  useEffect(() => {
    if (previousLocationRef.current === location) {
      return;
    }

    previousLocationRef.current = location;
    setExpandedGroups(currentGroups =>
      autoOpenAdminWorkbenchNavigationGroup(currentGroups, location)
    );
  }, [location]);

  useEffect(() => {
    writeAdminWorkbenchNavigationExpandedGroups(accountId, expandedGroups);
  }, [accountId, expandedGroups]);

  const toggleGroup = (groupId: AdminWorkbenchNavigationGroupId) => {
    setExpandedGroups(currentGroups => ({
      ...currentGroups,
      [groupId]: !currentGroups[groupId],
    }));
  };

  return (
    <nav
      className="admin-workbench-nav"
      data-admin-navigation="workbench-v1"
      data-collapsed={collapsed ? "true" : "false"}
      aria-label="后台功能导航"
    >
      {groups.map(group => {
        const isExpanded = collapsed || expandedGroups[group.id];

        return (
          <section
            className="admin-workbench-nav__group"
            data-group={group.id}
            data-expanded={isExpanded ? "true" : "false"}
            key={group.id}
          >
            <button
              type="button"
              className="admin-workbench-nav__group-toggle"
              aria-expanded={expandedGroups[group.id]}
              aria-controls={`admin-workbench-nav-${group.id}`}
              onClick={() => toggleGroup(group.id)}
            >
              <span className="admin-workbench-nav__group-label">
                {group.label}
              </span>
              <span
                aria-hidden="true"
                className="admin-workbench-nav__chevron"
              />
            </button>
            <ul
              className="admin-workbench-nav__menu"
              id={`admin-workbench-nav-${group.id}`}
              hidden={!isExpanded}
            >
              {group.items.map(item => renderItem(item))}
            </ul>
          </section>
        );
      })}
    </nav>
  );
}
