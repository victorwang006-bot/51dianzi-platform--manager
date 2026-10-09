import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(import.meta.dirname, "../../../..");
const read = (relative: string) => readFileSync(join(root, relative), "utf8");
const tab = read("client/src/components/merchant/AgencyCertificationTab.tsx");
const detail = read("client/src/pages/MerchantDetail.tsx");

describe("商户代理认证 UI 合成", () => {
  it("作为商户详情的独立惰性标签挂载，首次激活后保留组件输入状态", () => {
    expect(detail).toContain('value: "agency", label: "代理认证"');
    expect(detail).toContain('visitedTabs.has("agency")');
    expect(detail).toContain('value="agency" forceMount');
    expect(detail).toContain('<AgencyCertificationTab merchantId={merchant.id} canWrite={canWriteAgencyCertification} />');
    expect(detail).toContain("hasAdminPermission(adminRole, \"merchants.write\", adminPermissions)");
    expect(detail).toContain("Boolean(merchant.canManage)");
  });

  it("品牌编辑按 NFKC、多种分隔符和大小写去重，保留带括号的品牌名称", () => {
    expect(tab).toContain("export function normalizeAgencyCertificationBrands");
    expect(tab).toContain('.normalize("NFKC")');
    expect(tab).toContain("split(/[,;、\\n\\r]+/)");
    expect(tab).toContain("toLocaleLowerCase()");
    expect(tab).toContain("ST(意法半导体)");
    expect(tab).toContain("最多 30 项，每项最多 80 个字符");
  });

  it("仅写权限显示新增、编辑与取消；只读用户仍能加载列表和按需查看证件", () => {
    expect(tab).toContain("canWrite && !draft");
    expect(tab).toContain("canWrite && active");
    expect(tab).toContain("agencyCertifications.useQuery({ merchantId })");
    expect(tab).toContain("agencyCertificationDocument.useMutation()");
    expect(tab).toContain(">新增代理认证<");
    expect(tab).toContain(">编辑<");
    expect(tab).toContain('"取消认证"');
    expect(tab).toContain('"查看"');
  });

  it("前端拒绝坏类型和超过 10MiB 的新文件，失败时保留表单，不输出 base64", () => {
    expect(tab).toContain("MAX_FILE_BYTES = 10 * 1024 * 1024");
    expect(tab).toContain("isAcceptedFile(file)");
    expect(tab).toContain("代理证不能超过 10MiB");
    expect(tab).toContain("accept=\"image/jpeg,image/png,image/webp,application/pdf,.jpg,.jpeg,.png,.webp,.pdf\"");
    expect(tab).toContain("readFileAsBase64");
    expect(tab).toContain("catch (error)");
    expect(tab).toContain("setDraft(null)");
    expect(tab).not.toContain("console.log(base64)");
    expect(tab).not.toContain("console.log(file)");
  });

  it("保存和取消禁用双提交并重试复用 requestId；证件短链只在点击且预开窗口成功时请求", () => {
    expect(tab).toContain("crypto.randomUUID()");
    expect(tab).toContain("saveRequestId ?? requestId()");
    expect(tab).toContain("cancelRequestIds.current.get(item.id) ?? requestId()");
    expect(tab).toContain("if (savingLock.current) return");
    expect(tab).toContain("savingLock.current = true");
    expect(tab).toContain("savingLock.current = false");
    expect(tab).toContain("disabled={saving}");
    expect(tab).toContain("cancelMutation.isPending");
    expect(tab).toContain('window.open("about:blank", "_blank")');
    expect(tab).toContain("preview.opener = null");
    expect(tab).toContain("preview.location.replace(result.url)");
    expect(tab).toContain("preview.close()");
  });
});
