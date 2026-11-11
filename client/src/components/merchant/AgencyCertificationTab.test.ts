import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
const root = join(import.meta.dirname, "../../../..");
const read = (relative: string) => readFileSync(join(root, relative), "utf8");
const tab = read("client/src/components/merchant/AgencyCertificationTab.tsx");
const detail = read("client/src/pages/MerchantDetail.tsx");
describe("商户代理认证 UI 合同", () => {
  it("独立惰性tab、强身份key以及路由商户一致校验，不改变其他tab", () => {
    expect(detail).toContain('visitedTabs.has("agency")');
    expect(detail).toContain('value="agency" forceMount');
    expect(detail).toContain("merchant.id === id ? <AgencyCertificationTab");
    expect(detail).toContain("key={agencyIdentityKey} identityKey={agencyIdentityKey}");
    expect(detail).toContain("merchant.crmOwnerPortalUserId");
    expect(detail).toContain('hasAdminPermission(adminRole, "merchants.write", adminPermissions)');
    expect(tab).toContain('refetchOnMount: "always"');
  });
  it("人工认定与审核申请分开，驳回原因必填，审核/撤销有确认对话框", () => {
    for (const text of ["后台人工认定", "审核申请", "驳回原因不能为空", "确认撤销", "审核历史和原件不会删除", "旧审核结果与原件保留"]) expect(tab).toContain(text);
    expect(tab).toContain("reviewAgencyCertification.useMutation()");
    expect(tab).toContain("expectedRevision: review.item.revision");
    expect(tab).toContain("requestId: review.requestId");
    expect(tab).not.toContain("保存立即生效，无需审核");
  });
  it("只有write用户可见查看原件按钮且原件函数再守权限；待审/驳回/期限/替代均可辨认", () => {
    const view = tab.slice(tab.indexOf("const viewDocument"), tab.indexOf("return <div"));
    expect(view).toContain("if (!canWrite");
    for (const text of ["待审核", "已驳回", "已撤销", "已过期", "尚未生效", "已替代", "审核意见", "提交", "承接历史记录", "当前有效品牌"]) expect(tab).toContain(text);
    expect(tab).toContain("effectiveAgencyCertificationItems");
  });
  it("保留10MiB、品牌规范化、幂等重试和双击锁；失败不丢表单", () => {
    for (const source of ['.normalize("NFKC")', "toLocaleLowerCase()", "MAX_FILE_BYTES = 10 * 1024 * 1024", "isAcceptedFile(file)", "saveRequestId ?? requestId()", "cancelRequestIds.current.get(item.id) ?? requestId()", "savingLock.current = true", "savingLock.current = false"]) expect(tab).toContain(source);
    expect(tab).not.toContain("console.log(base64)");
  });
  it("晚回响应检查当前强身份，切换/卸载关闭预览，短链不存React state", () => {
    expect(tab).toContain("liveIdentity.current === identity");
    expect(tab).toContain("if (!current(identity)) return");
    expect(tab).toContain("if (!current(identity) || preview.closed)");
    expect(tab).toContain("preview.opener = null");
    expect(tab).toContain("preview.location.replace(result.url)");
    expect(tab).toContain("previews.current.forEach");
    expect(tab).not.toMatch(/useState.*url/i);
  });
});
