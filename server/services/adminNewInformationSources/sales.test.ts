import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getPlatformOrderNewInformationFacts } from "../../platformOrderApi";

const root = path.resolve(import.meta.dirname, "../../..");
function code(file: string) { return readFileSync(path.join(root, file), "utf8"); }
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("sales source fixed native transport", () => {
  it.each([{ codes: undefined }, { codes: [] }, { codes: ["STAFF-A"] }])("preserves server sales-code tri-state $codes on the exact internal path", async ({ codes }) => {
    vi.stubEnv("PLATFORM_API_BASE", "https://offline.test.invalid");
    vi.stubEnv("PORTAL_API_KEY", "synthetic-test-only");
    const facts = { available: true, scope: { identity: "native-orders", version: "v1" }, items: [], snapshot: "snapshot" };
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify([{ result: { data: { json: facts } } }])));
    vi.stubGlobal("fetch", fetchMock);
    expect(await getPlatformOrderNewInformationFacts({ refs: ["order:19"] }, codes)).toEqual(facts);
    const [url, init] = fetchMock.mock.calls[0];
    const parsed = new URL(url);
    expect(parsed.pathname).toBe("/api/trpc/internalOrder.newInformationFacts");
    const input = JSON.parse(parsed.searchParams.get("input")!)["0"].json;
    expect(input.refs).toEqual(["order:19"]);
    if (codes === undefined) expect(input).not.toHaveProperty("salesStaffCodes");
    else expect(input.salesStaffCodes).toEqual(codes);
    expect(init.headers["x-portal-key"]).toBe("synthetic-test-only");
    expect(input).not.toHaveProperty("page");
    expect(input).not.toHaveProperty("actorKey");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("upstream failure rejects instead of converting unknown into available zero", async () => {
    vi.stubEnv("PLATFORM_API_BASE", "https://offline.test.invalid");
    vi.stubEnv("PORTAL_API_KEY", "synthetic-test-only");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 503 })));
    await expect(getPlatformOrderNewInformationFacts({})).rejects.toThrow("503");
  });
});

describe("sales actual page-row hooks", () => {
  const crm = "client/src/business/platform/client/src/pages/CrmSalesOrders.tsx";
  const seller = "client/src/business/platform/client/src/pages/OutboundManagement.tsx";
  const native = "client/src/pages/Orders.tsx";
  it.each([crm, seller, native])("%s only inspects the real displayed page and observes actual rows", file => {
    const source = code(file);
    expect(source).toContain("useAdminNewInformationContextRows({");
    expect(source).toContain('module: "sales"');
    expect(source).toContain("refs: pageRows.map(order =>");
    expect(source).toContain("!listQuery.isPlaceholderData".replace("listQuery", file === crm ? "listQuery" : file === seller ? "sellerOrdersQuery" : "query"));
    expect(source).toContain("isSuccess");
    expect(source).toContain("isError");
    expect(source).toContain("isFetching");
    expect(source).toContain("ref={newInformationRows.getRow(");
    expect(source).toContain("AdminNewInformationRowBadge isNew={newInformationRows.getRow(");
    expect(source).toContain("const displayedRows = [...pageRows].sort(");
    expect(source).toContain("displayedRows.map(order =>");
    expect(source).not.toMatch(/markRead\(|markSeen\(|ChatUnreadBadge|previewRows|proofRows/);
  });
  it("embedded CRM and seller use relative ADMIN core, original merchant and verified current staff", () => {
    for (const file of [crm, seller]) {
      const source = code(file);
      expect(source).toContain('from "../../../../../lib/adminNewInformation"');
      expect(source).toContain("scope: String(businessScope.merchantId)");
      expect(source).toContain('businessScope.contextVerification.state === "verified"');
      expect(source).toContain('businessScope.staffPrincipal.status === "ready"');
    }
    expect(code(crm)).toContain("`crm-sales:${order.id}`");
    expect(code(seller)).toContain("`order:${order.id}`");
    expect(code(seller)).toContain("const pageRows = list.slice(");
  });
  it("native row hook runs below the original Dashboard provider, physical order ID stays separate from inventory", () => {
    const source = code(native);
    expect(source).toContain("<DashboardLayout><OrderListContent /></DashboardLayout>");
    expect(source).toContain("const pageRows = query.data?.rows ?? []");
    expect(source).toContain("`order:${order.id}`");
    expect(source).not.toContain("`order:${item.id}`");
  });
});
