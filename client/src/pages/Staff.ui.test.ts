import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const page = readFileSync("client/src/pages/Staff.tsx", "utf8");
const styles = readFileSync("client/src/pages/Staff.css", "utf8");
const sheet = readFileSync("client/src/components/admin/StaffPermissionSheet.tsx", "utf8");
const officialSection = readFileSync("client/src/components/admin/OfficialTeamPermissionSection.tsx", "utf8");
function sourceBetween(source: string, start: string, end: string) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex);
  if (startIndex < 0 || endIndex < 0) throw new Error(`Missing source range: ${start}`);
  return source.slice(startIndex, endIndex + end.length);
}
function cell(marker: string) {
  const markerIndex = page.indexOf(marker);
  const start = page.lastIndexOf("<TableCell", markerIndex);
  return page.slice(start, page.indexOf("</TableCell>", markerIndex));
}
describe("staff UI contracts", () => {
  it("keeps the seven-column desktop list compact and identity content limited", () => {
    const tableBody = sourceBetween(page, "<TableBody>", "</TableBody>");
    const table = sourceBetween(page, '<Table className="staff-management-table', "</Table>");
    const identityCell = cell("data-staff-identity");
    const roleCell = cell("data-staff-role");
    expect((table.match(/<col className=/g) ?? [])).toHaveLength(7);
    expect(table).toContain('className="staff-management-table min-w-[980px] table-fixed"');
    expect(tableBody).toContain('className="h-14 align-middle"');
    expect(tableBody).toContain('className="staff-action-cell w-[112px] min-w-[112px] py-2.5');
    expect(tableBody).toContain('className="h-8 px-2 text-xs"');
    expect(identityCell).toContain('className="staff-avatar"');
    expect(identityCell).toContain('className="staff-association-action"');
    expect(identityCell).not.toContain("row.member?.phone");
    expect(identityCell).not.toContain("<Badge");
    expect(identityCell).not.toContain("后台账号");
    expect(roleCell).not.toContain("adminPermissionSummary");
    expect(tableBody).toContain("const showEnterpriseStatus");
    expect(tableBody).toContain('row.member.status === "suspended" || !adminStatus');
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
  it("reads real operations and verified business organizations without removing official configuration", () => {
    expect(page).toContain("trpc.staffOrganization.overview.useQuery");
    expect(page).toContain("scopeClient.organization.overview.query(undefined)");
    expect(page).toContain("readStaffBusinessTeams");
    expect(page).toContain("<StaffTeamSummary");
    expect(page).toContain("official={officialTeamsOverview}");
    expect(page).toContain("officialTeamsOverview={officialTeamsQuery.data}");
    expect(sheet).toContain("<OfficialTeamPermissionSection");
    expect(officialSection).toContain("trpc.officialTeams.create.useMutation");
  });
  it("partitions business team cache by the current actor and enterprise and validates before display", () => {
    const query = sourceBetween(page, "const businessTeamsQuery = useQuery({", "const enterpriseMeQuery");
    const key = sourceBetween(query, "queryKey: [", "queryFn:");
    expect(key).toContain('staffQueryKey(accountId, merchantId, "organization-teams")');
    expect(key).toContain("contextValidation.context?.frontendUserId ?? null");
    expect(key).toContain("contextValidation.context?.enterpriseId ?? null");
    expect(query).toMatch(/readCachedStaffBusinessTeams\(\s*businessTeamsQuery.data,\s*contextValidation.context/);
    expect(query).toContain("businessTeamsQuery.isSuccess");
    expect(cell("data-staff-official-team")).toContain("business={businessTeams}");
    expect(cell("data-staff-official-team")).not.toContain("? businessTeamsQuery.data");
  });
  it("uses the Table scroll wrapper and only makes actions sticky on narrow viewports", () => {
    const desktopStyles = styles.slice(0, styles.indexOf("@media (max-width: 1023px)"));
    expect(page).toContain("data-staff-table-scroll");
    expect(styles).toContain('.staff-management-table-scroll > [data-slot="table-container"]');
    expect(desktopStyles).toContain("position: static;");
    expect(desktopStyles).toContain("box-shadow: none;");
    expect(desktopStyles).not.toContain("position: sticky;");
    expect(styles).toContain("position: sticky;");
    expect(styles).toContain("height: 3.5rem;");
    expect(styles).toContain("height: 2rem;");
  });
  it("keeps all seven permission tabs outside the scroll body and retains official team entry", () => {
    const tabsIndex = sheet.indexOf("data-staff-permission-tabs");
    const bodyIndex = sheet.indexOf("data-staff-permission-body");
    expect(tabsIndex).toBeGreaterThan(sheet.indexOf("data-staff-permission-sheet-header"));
    expect(bodyIndex).toBeGreaterThan(tabsIndex);
    expect(sheet.indexOf("<SheetFooter")).toBeGreaterThan(bodyIndex);
    expect(sheet).toContain("const bodyRef = useRef<HTMLDivElement | null>(null)");
    expect(sheet).toContain('body.scrollTo({ top: Math.max(0, top), behavior: "auto" })');
    expect(sheet).toContain('body.scrollTo({ top: Math.max(0, top), behavior: "smooth" })');
    expect(sheet).not.toContain("scrollIntoView");
    expect(sheet).not.toContain("window.scroll");
    expect((sheet.match(/data-staff-section-tab=/g) ?? [])).toHaveLength(7);
    // Six native sections plus the independent official-team component.
    expect((sheet.match(/data-staff-sheet-section=/g) ?? [])).toHaveLength(6);
    expect(officialSection).toContain('data-staff-sheet-section="official-team"');
  });
  it("retains contact details, binding validation and protected ERP save guards", () => {
    const basicSection = sourceBetween(sheet, 'aria-labelledby="staff-basic-title"', "</section>");
    expect(basicSection).toContain("后台账号");
    expect(basicSection).toContain("手机号");
    expect(sheet).toContain("protectedStaffErpKeys");
    expect(sheet).toContain("staffErpMutationGuard");
    expect(sheet).toContain("当前权限中包含你不能调整的项目，ERP 权限在本窗口只读。");
    expect(sheet).toContain("完成成员关联后可查看和配置 ERP 权限。");
    expect(sheet).toContain("加载失败：{securityError}");
    expect(sheet).toMatch(/title=\{\s*ERP_PERMISSION_DEFINITIONS\[key\]\.description\s*\}/);
    expect(page).toContain("runGuardedStaffErpMutation");
    expect(page).toContain("onSave={saveSelected}");
  });
});
