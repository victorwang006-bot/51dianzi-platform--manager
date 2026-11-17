import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
const state = vi.hoisted(() => ({ permissions: ["business.inventory.read", "business.inventory.write"], scopes: ["business.inventory.read", "business.inventory.write"], binding: true, scope: true, forwarded: [] as any[], audit: vi.fn() }));
vi.mock("./db", () => ({
  withBusinessAuthorizationFence: async (_: unknown, run: () => Promise<unknown>) => run(),
  getActiveBusinessStaffBinding: async () => state.binding ? { frontUserId: 202, bindingVersion: 7 } : null,
  getAdminUserById: async () => ({ id: 303, status: "active", adminRole: "merchant_mgr", sessionVersion: 7 }),
  getAdminUserPermissions: async () => state.permissions,
  getActiveBusinessMerchantScope: async () => state.scope ? { scopeVersion: 4, modulePermissions: state.scopes } : null,
  getBusinessWorkbenchMerchantById: async () => ({ id: 51, crmStatus: "enabled", registrationRegion: "CN", businessLicense: "SYNTHETIC", crmOwnerPortalUserId: "101" }),
  recordBusinessCommandAccess: async (input: unknown) => state.audit(input),
}));
import { businessRouter } from "./businessRouter";
import { inboundDocumentRefSchema as embeddedSchema } from "../client/src/business/platform/shared/inboundDocuments";
import { inboundDocumentRefSchema as mainSchema } from "../../51dianzi-platform/shared/inboundDocuments";
import ts from "typescript";
const ctx = { user: { id: 303, role: "admin" }, adminAccount: { id: 303, status: "active", sessionVersion: 7, adminRole: "merchant_mgr", username: "fixture" }, req: { headers: { "x-business-merchant-id": "51" }, ip: "127.0.0.1" }, res: {} } as never;
const ref = { kind: "contract" as const, key: "inbound-documents/1/202/00000000-0000-0000-0000-000000000000_1234abcd.pdf", name: "合同.pdf", mimeType: "application/pdf" as const, size: 25 };
const upload = { kind: "contract" as const, fileName: "合同.pdf", mimeType: "application/pdf" as const, base64: "JVBERi0xLjcKJSVFT0YK", clientRequestId: "attachment-request01" };
beforeEach(() => {
  state.permissions = ["business.inventory.read", "business.inventory.write"]; state.scopes = [...state.permissions]; state.binding = true; state.scope = true; state.forwarded = []; state.audit.mockClear();
  vi.stubEnv("NODE_ENV", "test"); vi.stubEnv("BUSINESS_WORKBENCH_MERCHANT_IDS", "51"); vi.stubEnv("PLATFORM_API_BASE", "https://synthetic.invalid"); vi.stubEnv("PORTAL_API_KEY", "synthetic-evidence-bff-key");
  vi.stubGlobal("fetch", async (_: string, init: RequestInit) => {
    state.forwarded.push(JSON.parse(String(init.body))["0"].json);
    return new Response(JSON.stringify([{ result: { data: { json: { success: true } } } }]), { status: 200 });
  });
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
describe("入库附件BFF和SDK最小同步（无真实网络/库）", () => {
  it("fixed reads retain read-only grant, upload requires unchanged write grant and forwards real bound actor", async () => {
    state.permissions = ["business.inventory.read"]; state.scopes = [...state.permissions];
    const caller = businessRouter.createCaller(ctx).inbound;
    await caller.documents({ id: 7 }); await caller.documentAccess({ id: 7, key: ref.key });
    await expect(caller.uploadDocument(upload)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(state.forwarded.map(input => input.method)).toEqual(["inbound.documents", "inbound.documentAccess"]);
    expect(state.forwarded.every(input => input.staffUserId === 202 && input.bindingVersion === 7)).toBe(true);
    state.permissions.push("business.inventory.write"); state.scopes.push("business.inventory.write"); await caller.uploadDocument(upload);
    expect(state.forwarded[2]).toMatchObject({ method: "inbound.uploadDocument", params: upload });
  });
  it("forwards five stable fields through original create/update/details/bulk without losing payment/old photos/rows", async () => {
    const caller = businessRouter.createCaller(ctx).inbound;
    const input = { clientRequestId: upload.clientRequestId, partNumber: "PN", documents: [ref], photos: [{ old: "photo" }], payment: { mode: "partial", amount: "1.25" }, buyerUserId: 202 };
    await caller.create(input); await caller.update({ id: 7, data: input });
    await caller.updateDetails({ id: 7, documents: [], note: "keep", photos: [{ old: "photo" }] });
    await caller.bulkCreate({ clientRequestId: upload.clientRequestId, documents: [ref], rows: [{ sourceRow: 2, partNumber: "PN", buyerUserId: 202 }], acceptMissingPrices: true });
    expect(state.forwarded[0].params).toEqual(input); expect(state.forwarded[1].params).toEqual({ id: 7, data: input });
    expect(state.forwarded[2].params).toEqual({ id: 7, documents: [], note: "keep", photos: [{ old: "photo" }] });
    expect(state.forwarded[3].params).toMatchObject({ documents: [ref], acceptMissingPrices: true, rows: [{ sourceRow: 2, partNumber: "PN", buyerUserId: 202 }] });
  });
  it("rejects arbitrary key/URL/actor selectors and over-limit references before any upstream IO", async () => {
    const caller = businessRouter.createCaller(ctx).inbound;
    await expect(caller.uploadDocument({ ...upload, effectiveUserId: 101 } as any)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(caller.documentAccess({ key: ref.key } as any)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(caller.documentAccess({ id: 7, key: "https://public.invalid/file.pdf" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(caller.create({ documents: [{ ...ref, url: "signed" }] })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(caller.bulkCreate({ documents: [ref,ref] })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(state.forwarded).toEqual([]);
  });
  it.each(["binding", "scope"] as const)("revoked %s fails current fence for both upload and download", async key => {
    state[key] = false; const caller = businessRouter.createCaller(ctx).inbound;
    await expect(caller.documents({ id: 7 })).rejects.toBeDefined(); await expect(caller.uploadDocument(upload)).rejects.toBeDefined();
    expect(state.forwarded).toEqual([]);
  });
  it("fixed method permission mapping and shared schema agree, keeping old notification/mall IDs untouched", () => {
    const embedded = readFileSync(new URL("../client/src/business/platform/front-router-types/server/services/internalBusinessDelegation.ts", import.meta.url), "utf8");
    const main = readFileSync(new URL("../../51dianzi-platform/server/services/internalBusinessDelegation.ts", import.meta.url), "utf8");
    for (const [method, mode] of [["inbound.uploadDocument", "write"], ["inbound.documents", "read"], ["inbound.documentAccess", "read"]] as const) {
      for (const source of [embedded, main]) {
        let ids: string[] = [];
        const ast = ts.createSourceFile("manifest.ts", source, ts.ScriptTarget.Latest, true);
        const visit = (node: ts.Node) => {
          if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === "BUSINESS_METHOD_IDS") {
            const array = node.initializer && ts.isAsExpression(node.initializer) ? node.initializer.expression : node.initializer;
            if (array && ts.isArrayLiteralExpression(array)) ids = array.elements.filter(ts.isStringLiteral).map(item => item.text);
          }
          ts.forEachChild(node, visit);
        };
        visit(ast); expect(ids.filter(id => id === method)).toHaveLength(1);
        expect(source).toContain(`BUSINESS_METHOD_CAPABILITIES["${method}"] = INVENTORY_INBOUND${mode === "read" ? "_READ" : ""};`);
      }
    }
    expect(embedded).toContain('"inbound.newInformationFacts"'); expect(main).toContain("...MALL_INVENTORY_METHOD_IDS");
    expect(embeddedSchema.parse(ref)).toEqual(mainSchema.parse(ref));
  });
});
