import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const page = readFileSync("client/src/pages/Staff.tsx", "utf8");
const styles = readFileSync("client/src/pages/Staff.css", "utf8");
const sheet = readFileSync(
  "client/src/components/admin/StaffPermissionSheet.tsx",
  "utf8"
);
const officialSection = readFileSync(
  "client/src/components/admin/OfficialTeamPermissionSection.tsx",
  "utf8"
);
function sourceBetween(source: string, start: string, end: string) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex);
  if (startIndex < 0 || endIndex < 0)
    throw new Error(`Missing source range: ${start}`);
  return source.slice(startIndex, endIndex + end.length);
}
function cell(marker: string) {
  const markerIndex = page.indexOf(marker);
  const start = page.lastIndexOf("<TableCell", markerIndex);
  return page.slice(start, page.indexOf("</TableCell>", markerIndex));
}
describe("staff UI contracts", () => {
  it("keeps the approved six-column desktop list compact and identity content limited", () => {
    const tableBody = sourceBetween(page, "<TableBody>", "</TableBody>");
    const table = sourceBetween(
      page,
      '<Table className="staff-management-table',
      "</Table>"
    );
    const identityCell = cell("data-staff-identity");
    const roleCell = cell("data-staff-role");
    expect(table.match(/<col className=/g) ?? []).toHaveLength(6);
    expect(table).toContain(
      'className="staff-management-table min-w-[900px] table-fixed"'
    );
    expect(tableBody).toContain('className="h-14 align-middle"');
    expect(tableBody).toContain(
      'className="staff-action-cell w-[200px] min-w-[200px] py-2.5'
    );
    expect(tableBody).toContain('className="h-8 px-2 text-xs"');
    expect(identityCell).toContain('className="staff-avatar"');
    expect(identityCell).toContain('className="staff-association-action"');
    expect(identityCell).not.toContain("row.member?.phone");
    expect(identityCell).not.toContain("<Badge");
    expect(identityCell).not.toContain("后台账号");
    expect(roleCell).not.toContain("adminPermissionSummary");
    expect(tableBody).toContain("const showEnterpriseStatus");
    expect(tableBody).toContain(
      'row.member.status === "suspended" || !adminStatus'
    );
  });
  it("opens a create dialog in place, with management guard and real cache invalidation", () => {
    expect(page).toContain("新增员工");
    expect(page).toContain("setCreateOpen(true)");
    expect(page).toContain("open={createOpen && canManageAdmin}");
    expect(page).toContain("<CreateStaffDialog");
    expect(page).not.toContain('href="/admins"');
    expect(page).toContain("trpcUtils.adminUser.list.invalidate()");
    expect(page).toContain("trpcUtils.salesStaff.list.invalidate()");
    expect(page).toContain("trpcUtils.staffOrganization.overview.invalidate()");
    expect(page).toContain("trpcUtils.officialTeams.overview.invalidate()");
  });
  it("reads real operations and verified business organizations while preserving native grants independently", () => {
    expect(page).toContain("trpc.staffOrganization.overview.useQuery");
    expect(page).toContain(
      "scopeClient.organization.overview.query(undefined)"
    );
    expect(page).toContain("readStaffBusinessOrganization");
    expect(page).not.toContain("data-staff-official-team");
    expect(page).toContain("officialTeamsOverview");
    expect(page.replace(/\s+/g, " ")).toContain(
      "officialTeamsOverview.serverScope.adminUserId === accountId ? officialTeamsQuery.data : undefined"
    );
    expect(sheet).toContain("<OfficialTeamPermissionSection");
    expect(officialSection).not.toContain(
      "trpc.officialTeams.create.useMutation"
    );
    expect(page).toContain("scopeClient.organization.setMember.mutate");
    expect(page).toMatch(
      /staffBusinessTeamGuard\(\s*target,\s*enterpriseAccess,\s*businessOrganization\s*\)/
    );
  });
  it("partitions business team cache by the current actor and enterprise and validates before display", () => {
    const query = sourceBetween(
      page,
      "const businessTeamsQuery = useQuery({",
      "const enterpriseMeQuery"
    );
    const key = sourceBetween(query, "queryKey: [", "queryFn:");
    expect(key).toContain(
      'staffQueryKey(accountId, merchantId, "organization-teams")'
    );
    expect(key).toContain("contextValidation.context?.frontendUserId ?? null");
    expect(key).toContain("contextValidation.context?.enterpriseId ?? null");
    expect(query).toMatch(
      /readCachedStaffBusinessTeams\(\s*businessTeamsQuery.data,\s*contextValidation.context/
    );
    expect(query).toContain("businessTeamsQuery.isSuccess");
    expect(page).toContain("overview: businessOrganization");
    expect(page).toContain("canEdit: businessTeamGuard.allowed && !businessTeamsQuery.isError");
    expect(page).not.toContain("data-staff-official-team");
  });
  it("uses the Table scroll wrapper and only makes actions sticky on narrow viewports", () => {
    const desktopStyles = styles.slice(
      0,
      styles.indexOf("@media (max-width: 1023px)")
    );
    expect(page).toContain("data-staff-table-scroll");
    expect(styles).toContain(
      '.staff-management-table-scroll > [data-slot="table-container"]'
    );
    expect(desktopStyles).toContain("position: static;");
    expect(desktopStyles).toContain("box-shadow: none;");
    expect(desktopStyles).not.toContain("position: sticky;");
    expect(styles).toContain("position: sticky;");
    expect(styles).toContain("height: 3.5rem;");
    expect(styles).toContain("height: 2rem;");
  });
  it("keeps five real permission tabs outside scroll body and saves only the active page", () => {
    const tabsIndex = sheet.indexOf("data-staff-permission-tabs");
    const bodyIndex = sheet.indexOf("data-staff-permission-body");
    expect(tabsIndex).toBeGreaterThan(
      sheet.indexOf("data-staff-permission-sheet-header")
    );
    expect(bodyIndex).toBeGreaterThan(tabsIndex);
    expect(sheet.indexOf("<SheetFooter")).toBeGreaterThan(bodyIndex);
    expect(sheet).toContain("STAFF_PERMISSION_TABS.map");
    expect(sheet.match(/role="tabpanel"/g) ?? []).toHaveLength(5);
    expect(sheet.match(/hidden=\{activeSection !== /g) ?? []).toHaveLength(5);
    expect(sheet).toContain(
      "staffDraftForPage(activeSection, draft, baseline)"
    );
    expect(sheet).toContain("officialRef.current?.save()");
    expect(sheet).toContain("保存当前页");
    expect(sheet).toContain("window.confirm");
    expect(sheet).not.toContain("scrollToSection");
    expect(officialSection).toContain(
      'data-staff-sheet-section="official-team"'
    );
    expect(officialSection).toContain("渠道库存团队（业务团队）");
  });
  it("retains contact details, binding validation and protected ERP save guards", () => {
    const basicSection = sourceBetween(
      sheet,
      'aria-labelledby="staff-basic-title"',
      "</section>"
    );
    expect(basicSection).toContain("后台账号");
    expect(basicSection).toContain("手机号");
    expect(sheet).toContain("protectedStaffErpKeys");
    expect(sheet).toContain("staffErpMutationGuard");
    expect(sheet).toContain(
      "当前权限中包含你不能调整的项目，ERP 权限在本窗口只读。"
    );
    expect(sheet).toContain("完成成员关联后可查看和配置 ERP 权限。");
    expect(sheet).toContain("加载失败：{securityError}");
    expect(sheet).toMatch(
      /title=\{\s*ERP_PERMISSION_DEFINITIONS\[key\]\s*\.description\s*\}/
    );
    expect(page).toContain("runGuardedStaffErpMutation");
    expect(page).toContain("onSave={saveSelected}");
  });
});
