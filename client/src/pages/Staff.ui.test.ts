import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const page = readFileSync("client/src/pages/Staff.tsx", "utf8");
const styles = readFileSync("client/src/pages/Staff.css", "utf8");
const sheet = readFileSync("client/src/components/admin/StaffPermissionSheet.tsx", "utf8");

function sourceBetween(source: string, start: string, end: string) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex);
  if (startIndex < 0 || endIndex < 0) throw new Error(`Missing source range: ${start}`);
  return source.slice(startIndex, endIndex + end.length);
}

describe("staff UI contracts", () => {
  it("keeps the six-column desktop list compact and limits identity content to name, avatar, and association entry", () => {
    const tableBody = sourceBetween(page, "<TableBody>", "</TableBody>");
    const table = sourceBetween(page, '<Table className="staff-management-table', "</Table>");
    const identityCell = sourceBetween(tableBody, '<TableCell className="min-w-[190px] py-2.5" data-staff-identity>', "</TableCell>");
    const roleCell = sourceBetween(tableBody, '<TableCell className="py-2.5 text-sm" data-staff-role>', "</TableCell>");

    expect((table.match(/<col className=/g) ?? [])).toHaveLength(6);
    expect(table).toContain('className="staff-management-table min-w-[860px] table-fixed"');
    expect(tableBody).toContain('className="h-14 align-middle"');
    expect(tableBody).toContain('className="staff-action-cell w-[112px] min-w-[112px] py-2.5');
    expect(tableBody).toContain('className="h-8 px-2 text-xs"');
    expect(identityCell).toContain('className="min-w-[190px] py-2.5"');
    expect(identityCell).toContain('className="staff-avatar"');
    expect(identityCell).toContain('className="staff-association-action"');
    expect(identityCell).not.toContain("row.member?.phone");
    expect(identityCell).not.toContain("<Badge");
    expect(identityCell).not.toContain("后台账号");
    expect(roleCell).toContain('className="py-2.5 text-sm"');
    expect(roleCell).not.toContain("adminPermissionSummary");
    expect(tableBody).toContain("const showEnterpriseStatus");
    expect(tableBody).toContain('row.member.status === "suspended" || !adminStatus');
  });

  it("uses the Table-generated scroll wrapper and only makes the action column sticky on narrow viewports", () => {
    const desktopStyles = styles.slice(0, styles.indexOf("@media (max-width: 1023px)"));

    expect(page).toContain("data-staff-table-scroll");
    expect(styles).toContain('.staff-management-table-scroll > [data-slot="table-container"]');
    expect(styles).toContain("overflow: visible;");
    expect(desktopStyles).toContain("position: static;");
    expect(desktopStyles).toContain("box-shadow: none;");
    expect(desktopStyles).not.toContain("position: sticky;");
    expect(styles).toContain("@media (max-width: 1023px)");
    expect(styles).toContain("position: sticky;");
    expect(styles).toContain("overflow: visible;");
    expect(styles).toContain("height: 3.5rem;");
    expect(styles).toContain("height: 2rem;");
  });

  it("keeps the permission tabs outside the scroll body and performs all section navigation through the body ref", () => {
    const headerIndex = sheet.indexOf("data-staff-permission-sheet-header");
    const tabsIndex = sheet.indexOf("data-staff-permission-tabs");
    const bodyIndex = sheet.indexOf("data-staff-permission-body");
    const footerIndex = sheet.indexOf("<SheetFooter");
    const navStart = sheet.lastIndexOf("<nav", tabsIndex);
    const tabRegion = sheet.slice(navStart, sheet.indexOf("</nav>", tabsIndex) + "</nav>".length);

    expect(headerIndex).toBeGreaterThan(-1);
    expect(navStart).toBeGreaterThan(headerIndex);
    expect(tabsIndex).toBeGreaterThan(headerIndex);
    expect(bodyIndex).toBeGreaterThan(tabsIndex);
    expect(footerIndex).toBeGreaterThan(bodyIndex);
    expect(sheet).toContain("const bodyRef = useRef<HTMLDivElement | null>(null)");
    expect(sheet).toContain("ref={bodyRef}");
    expect(sheet).toContain("body.scrollTo({ top: Math.max(0, top), behavior: \"auto\" })");
    expect(sheet).toContain("body.scrollTo({ top: Math.max(0, top), behavior: \"smooth\" })");
    expect(sheet).not.toContain("scrollIntoView");
    expect(sheet).not.toContain("window.scroll");
    expect(tabRegion).not.toContain("sticky");
    expect(tabRegion).not.toContain("backdrop");
    expect(tabRegion).not.toContain("-mx");
    expect((sheet.match(/data-staff-section-tab=/g) ?? [])).toHaveLength(6);
    expect((sheet.match(/data-staff-sheet-section=/g) ?? [])).toHaveLength(6);
    expect(tabRegion).toContain("h-11");
    expect(tabRegion).toContain("overflow-x-auto");
  });

  it("retains account contact details and protected save/readonly guards while making permission options compact", () => {
    const basicSection = sourceBetween(sheet, 'aria-labelledby="staff-basic-title"', "</section>");

    expect(basicSection).toContain("后台账号");
    expect(basicSection).toContain("手机号");
    expect(sheet).toContain("protectedStaffErpKeys");
    expect(sheet).toContain("staffErpMutationGuard");
    expect(sheet).toContain("当前权限中包含你不能调整的项目，ERP 权限在本窗口只读。");
    expect(sheet).toContain("完成成员关联后可查看和配置 ERP 权限。");
    expect(sheet).toContain("加载失败：{securityError}");
    expect(sheet).toContain('title={ERP_PERMISSION_DEFINITIONS[key].description}');
    expect(sheet).toContain('className="flex h-8 items-center gap-2 rounded-md border px-2 text-sm"');
    expect(page).toContain("runGuardedStaffErpMutation");
    expect(page).toContain("onSave={saveSelected}");
  });
});
