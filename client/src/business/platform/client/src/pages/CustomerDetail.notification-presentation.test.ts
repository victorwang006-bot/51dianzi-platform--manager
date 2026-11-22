import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Source contract only: do not mount a customer page or invoke real queries/writes.
const source = readFileSync(resolve(import.meta.dirname, "CustomerDetail.tsx"), "utf8");
const compact = source.replace(/\s+/g, " ");
const expectSource = (text: string) => expect(compact).toContain(text.replace(/\s+/g, " ").trim());

describe("CustomerDetail notification presentation source contract", () => {
  it("removes the entire auxiliary status row, retry controls and display-only locals without a placeholder", () => {
    for (const removed of [
      "customer-detail-read-status", "未读状态核验中", "未读提醒未清除", "已读 · 已确认",
      "顶部待同步", "重查顶部摘要", "重试确认", "正在确认已读", "未读 · 待确认",
      "inspectedCustomer", "readAcknowledged", "newInformationError",
      "newInformationRows.retryDisplayed", "newInformationRows.retrySummary",
    ]) expect(source).not.toContain(removed);
    // The name/grade/archive line is immediately followed by its wrapper close,
    // then the original actions: no hidden row or empty replacement element.
    expect(source).toMatch(/<div className="min-w-0">\s*<div className="flex flex-wrap items-center gap-2"><h1[^\n]*\{customer\.name\}[^\n]*<\/div>\s*<\/div>\s*<div className="customer-workbench-top-buttons">/);
  });

  it("retains the real notification hook, scoped customer ref and visible acknowledgement", () => {
    expectSource('import { useAdminNewInformationContextRows } from "../../../../../lib/adminNewInformation";');
    expectSource(`const newInformationRows = useAdminNewInformationContextRows({ module: "customers",
      refs: customer ? [\`customer:\${customer.id}\`] : [], scope: String(businessScope.merchantId),
      listReady: newInformationDetailReady, acknowledgeOnVisible: true, retainUnreadWhileVisible: false,
      expectedAccountKey: businessScope.staffPrincipal?.adminAccountId });`);
    expectSource('const newInformationRow = newInformationRows.getRow(`customer:${id}`);');
    expectSource('<main ref={newInformationRow.ref} className="erp-ui customer-detail-compact customer-detail-readable customer-workbench customer-profile-tight">');
  });

  it("retains fresh authorized detail queries and the identity/readiness gate", () => {
    expectSource('const authorityReady = contextValid && contextVerified.current;');
    expectSource('const detailQuery = trpc.customer.get.useQuery({ id }, freshListOptions({ enabled: validId && authorityReady, placeholderData: undefined }, d51Ready));');
    expectSource(`const detailValid = authorityReady && !detailQuery.isError && !detailQuery.isPlaceholderData && detailQuery.data?.customer.id === id
      && detailQuery.data.customer.enterpriseId === contactScope.scope?.enterpriseId;`);
    expectSource('const detail = detailValid && detailVerified.current ? detailQuery.data : undefined;');
    expectSource(`const newInformationDetailReady = Boolean(customer) && validId && authorityReady
      && detailQuery.isSuccess && detailQuery.isFetchedAfterMount === true
      && !detailQuery.isError && !detailQuery.isFetching && !detailQuery.isPlaceholderData
      && contextQuery.isSuccess && contextQuery.isFetchedAfterMount === true
      && !contextQuery.isError && !contextQuery.isFetching && !contextQuery.isPlaceholderData
      && businessScope.contextVerification.state === "verified"
      && businessScope.contextVerification.identity === businessScope.storageScope
      && businessScope.staffPrincipal.enterpriseId === contactScope.scope?.enterpriseId
      && businessScope.frontUser.id === contactScope.scope?.actorUserId;`);
  });

  it("retains receipt lifetime and identity guards rather than clearing read state locally", () => {
    expectSource('if (receiptSession.current.identity !== workbenchIdentity || (receiptSession.current.active && !active)) receiptSession.current.generation++;');
    expectSource('return () => { receiptSession.current.mounted = false; receiptSession.current.generation++; };');
    expectSource(`const captureReceiptGuard = () => {
      const generation = receiptSession.current.generation;
      const identity = workbenchIdentity;
      return () => receiptSession.current.mounted && receiptSession.current.active
        && receiptSession.current.generation === generation && receiptSession.current.identity === identity;
    };`);
    expectSource('const isCurrentChildReceipt = captureReceiptGuard();');
    expect(source).not.toMatch(/newInformationRows\.(?:mark|acknowledge|clear|set)\w*\s*\(/);
  });

  it("keeps business error handling and original retry/action buttons", () => {
    expectSource('onRetry={() => contextQuery.refetch()}');
    expectSource('onRetry={() => detailQuery.refetch()}');
    expectSource('{editError}</section>');
    expectSource('{followUpError}</div>');
    expectSource('订单权限核验失败。<button type="button" className="crm-link" onClick={() => void orderAuthority.refresh()}>重试核验</button>');
    for (const label of ["返回上一页", "新增需求", "新增跟进", "管理联系人", "保存修改", "归档客户", "恢复客户"])
      expect(source).toContain(label);
  });
});
