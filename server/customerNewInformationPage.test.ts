import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
const page = readFileSync(new URL("../client/src/business/platform/client/src/pages/CustomerList.tsx", import.meta.url), "utf8");

describe("real embedded CustomerList new-information row wiring", () => {
  it("uses only current successful result pageRows and canonical global customer IDs", () => {
    expect(page).toContain("const pageRows = result?.items ?? [];");
    expect(page).toContain("refs: pageRows.map(customer => `customer:${customer.id}`)");
    expect(page).toContain("module: \"customers\"");
    expect(page).toContain("scope: String(businessScope.merchantId)");
  });
  it("requires native query success, NOT error/fetching/placeholder, AND active current identity", () => {
    const readiness = page.slice(page.indexOf("const newInformationListReady"), page.indexOf("const newInformationRows"));
    expect(readiness).toContain("Boolean(result) && canQueryList && listQuery.isSuccess");
    for (const flag of ["!listQuery.isError", "!listQuery.isFetching", "!listQuery.isPlaceholderData", "contextQuery.isSuccess", "!contextQuery.isFetching", "!contextQuery.isPlaceholderData"]) expect(readiness).toContain(flag);
    expect(readiness).toContain('businessScope.contextVerification.state === "verified"');
    expect(readiness).toContain("businessScope.contextVerification.identity === businessScope.storageScope");
    expect(readiness).toContain("businessScope.staffPrincipal.enterpriseId === contactScope.scope?.enterpriseId");
    expect(readiness).toContain("businessScope.frontUser.id === contactScope.scope?.actorUserId");
  });
  it("attaches observation ref to ACTUAL original TableRow and a small shared row badge", () => {
    expect(page).toContain("{displayedCustomerRows.map(customer => {");
    expect(page).toContain("const newInformationRow = newInformationRows.getRow(`customer:${customer.id}`)");
    expect(page).toContain("<TableRow key={customer.id} ref={newInformationRow.ref} data-page-memory-row={String(customer.id)}>");
    expect(page).toContain("<AdminNewInformationRowBadge isNew={newInformationRow.isNew} />");
    expect(page).toContain('from "../../../../../lib/adminNewInformation"');
    expect(page).toContain('from "../../../../../components/admin/AdminNewInformationBadge"');
  });
  it("promotes only original loaded page rows, keeps filters/pagination and original business actions", () => {
    expect(page).toContain("const displayedCustomerRows = [...pageRows].sort");
    expect(page).toContain("pageSize: PAGE_SIZE");
    expect(page).toContain("pageSize: PAGE_SIZE");
    expect(page).toContain("stars.toggle(customer)");
    expect(page).toContain('customerWorkbenchLocation(customer.id, "overview")');
    expect(page).toContain("<CustomerSupplyCell");
    expect(page).toContain("<CustomerDemandDialog");
    expect(page).not.toMatch(/markRead|markDisplayed|newInformation\.summary|newInformation.*fetchNextPage|newInformation.*total/i);
  });
});
