import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import * as ts from "typescript";
import { describe, expect, it } from "vitest";
import type { StaffAdminAccount, StaffRow } from "@/lib/staffPermissionModel";

const page = readFileSync("client/src/pages/Staff.tsx", "utf8");
const styles = readFileSync("client/src/pages/Staff.css", "utf8");
const source = ts.createSourceFile(
  "Staff.tsx",
  page,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX
);

function attributes(tag: string, name: string) {
  const values: string[] = [];
  const visit = (node: ts.Node) => {
    if (
      (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
      node.tagName.getText(source) === tag
    ) {
      for (const attribute of node.attributes.properties) {
        if (
          ts.isJsxAttribute(attribute) &&
          attribute.name.getText(source) === name
        ) {
          values.push(attribute.initializer?.getText(source) ?? "");
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return values;
}

// Execute only the existing pure helpers, without mounting the page or invoking
// authentication, hooks, network clients, dialogs, or any server code.
function helperText(name: string) {
  const node = source.statements.find(
    statement =>
      ts.isFunctionDeclaration(statement) && statement.name?.text === name
  );
  if (!node) throw new Error(`Missing Staff helper: ${name}`);
  return node.getText(source);
}
const helperCode = ts.transpileModule(
  `${helperText("matchesFilter")}\n${helperText("accountStatus")}\n({ matchesFilter, accountStatus });`,
  { compilerOptions: { target: ts.ScriptTarget.ES2022 } }
).outputText;
const { matchesFilter, accountStatus } = runInNewContext(helperCode) as {
  matchesFilter: (
    row: Pick<StaffRow, "admin" | "member">,
    keyword: string,
    status: string,
    role: string
  ) => boolean;
  accountStatus: (account: StaffAdminAccount) => {
    label: string;
    style: string;
  };
};
const admin: StaffAdminAccount = {
  id: 71,
  username: "Staff.Alice",
  displayName: "员工甲",
  email: "alice@example.test",
  phone: "13800000000",
  adminRole: "operation",
  status: "disabled",
  permissions: [],
};
const member: NonNullable<StaffRow["member"]> = {
  memberId: 31,
  userId: 32,
  displayName: "业务员工甲",
  phone: "13900000000",
  role: "member",
  status: "suspended",
  permissionKeys: ["inventory.manage", "sales_orders.manage"],
  inventoryDataScope: "own",
  isOwner: false,
};

describe("staff unified presentation", () => {
  it("uses shared presentation wrappers without the duplicate card heading", () => {
    expect(page).toContain('from "@/components/admin/UnifiedAdminPage"');
    expect(attributes("AdminPage", "className")).toEqual([
      '"staff-management-page"',
    ]);
    expect(attributes("CompactListToolbar", "title")).toEqual(['"员工与权限"']);
    expect(attributes("AdminPageHeader", "title")).toEqual([]);
    expect(attributes("AdminFilterBar", "role")).toEqual([]);
    expect(page).toContain('from "@/business/platform/client/src/components/ui/CompactListToolbar"');
    expect(attributes("AdminDataPanel", "aria-label")).toEqual(['"员工列表"']);
    expect(page).not.toContain("<CardHeader");
    expect(page).not.toContain("<PageHeader");
    expect(page).not.toContain("<CardTitle");
  });

  it("retains keyword, status and role filters, including disabled and suspended staff", () => {
    const row = { admin, member };
    for (const keyword of [
      " STAFF.ALICE ",
      "员工甲",
      "alice@",
      "138000",
      "139000",
    ]) {
      expect(matchesFilter(row, keyword, "all", "all")).toBe(true);
    }
    expect(matchesFilter(row, "", "disabled", "all")).toBe(true);
    expect(matchesFilter(row, "", "suspended", "all")).toBe(true);
    expect(matchesFilter(row, "", "active", "all")).toBe(false);
    expect(matchesFilter(row, "", "all", "operation")).toBe(true);
    expect(matchesFilter(row, "", "all", "finance")).toBe(false);
    expect(matchesFilter({ member }, "业务员工", "suspended", "all")).toBe(
      true
    );
    expect(matchesFilter({ member }, "", "all", "operation")).toBe(false);
    expect(attributes("Input", "onChange")).toEqual([
      "{event => setKeyword(event.target.value)}",
    ]);
    expect(attributes("select", "value")).toEqual(["{status}", "{role}"]);
    expect(attributes("option", "value")).toEqual([
      '"all"',
      '"active"',
      '"disabled"',
      '"locked"',
      '"suspended"',
      '"deleted"',
      '"all"',
      "{option}",
    ]);
  });

  it("keeps account status semantics and protected native-admin / BFF enterprise paths", () => {
    expect(accountStatus(admin)).toEqual({ label: "停用", style: "gray" });
    expect(accountStatus({ ...admin, status: "locked" })).toEqual({
      label: "锁定",
      style: "warning",
    });
    expect(accountStatus({ ...admin, status: "active" })).toEqual({
      label: "启用",
      style: "success",
    });
    for (const guard of [
      'hasAdminPermission(\n    adminRole,\n    "admins.manage",',
      "trpc.adminUser.list.useQuery",
      "trpc.adminUser.update.useMutation",
      "createBusinessScopeTrpcClient(merchantId)",
      "createBusinessTrpcClient(merchantId)",
      "validateStaffBusinessContext(",
      "validateStaffEnterpriseSummary(value, context)",
      "enterpriseAccess.canManageMembers",
      "runGuardedStaffErpMutation(",
      "protectedStaffErpKeys(",
      "domainClient.enterprise.updatePermissions.mutate",
      "domainClient.enterprise.updateInventoryScope.mutate",
      "adminPermissionsForUpdate(",
    ]) {
      expect(page).toContain(guard);
    }
  });

  it("preserves server pagination, in-place creation, sales refresh, invitation and sheet wiring", () => {
    expect(page).toContain("const PAGE_SIZE = 20;");
    expect(page).toMatch(
      /useEffect\(\(\) => \{\s*setPage\(1\);\s*\}, \[keyword, role, status\]\)/
    );
    expect(page).toContain('{ page, pageSize: PAGE_SIZE, archiveStatus: status === "deleted" ? "deleted" : "current" }');
    expect(attributes("Pagination", "page")).toEqual(["{page}"]);
    expect(attributes("Pagination", "pageSize")).toEqual(["{PAGE_SIZE}"]);
    expect(attributes("Pagination", "total")).toEqual([
      "{adminUsersQuery.data.total}",
    ]);
    expect(attributes("Pagination", "onPageChange")).toEqual(["{setPage}"]);
    expect(attributes("CreateStaffDialog", "open")).toEqual([
      "{createOpen && canManageAdmin}",
    ]);
    expect(page).toContain("trpcUtils.salesStaff.list.invalidate()");
    expect(attributes("a", "href")).toEqual(["{enterpriseAccess.inviteHref}"]);
    expect(page).toContain("`/workbench/add-user?merchantId=${merchantId}`");
    expect(attributes("StaffPermissionSheet", "row")).toEqual([
      "{selectedCurrentRow}",
    ]);
    expect(attributes("StaffPermissionSheet", "initialSection")).toEqual([
      "{selectedSection}",
    ]);
    expect(attributes("StaffPermissionSheet", "onSave")).toEqual([
      "{saveSelected}",
    ]);
    expect(page).toContain('onClick={() => openStaffSheet(row, "erp")}');
    expect(page).toContain('openStaffSheet(row, "member")');
  });

  it("keeps the approved six data columns and compact right-aligned operations without scaling", () => {
    expect(attributes("col", "className")).toHaveLength(6);
    expect(attributes("TableHead", "className")).toHaveLength(6);
    expect(
      attributes("TableHead", "className").every(value =>
        value.includes("text-[11px]")
      )
    ).toBe(true);
    expect(attributes("TableHead", "className").at(-1)).toContain("text-right");
    expect(attributes("Input", "className")[0]).toContain("h-8");
    expect(attributes("Input", "className")[0]).toContain("text-xs");
    expect(page).not.toContain("text-sm");
    expect(styles).toContain("font-size: var(--admin-content-font-body, 12px);");
    expect(styles).toContain("border-radius: 6px;");
    expect(styles).toContain("color: #185fa5;");
    expect(styles).toContain("position: sticky;");
    expect(styles).not.toMatch(/!important|\bzoom\s*:|\btransform\s*:/);
    expect(styles).not.toContain("margin-left: -1.5rem");
    expect(styles).not.toContain('[data-slot="card"]');
  });
});
