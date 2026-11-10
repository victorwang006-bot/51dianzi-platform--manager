// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
    enterprise: null, enterpriseError: false, inputs: [],
    demands: null, demand: null, contacts: null, summary: null, materials: null,
    supply: null, canReadSupply: false, navigate: vi.fn(),
    queryFlags: {} as Record<string, { isFetching?: boolean; isFetchedAfterMount?: boolean; isPlaceholderData?: boolean }>,
}));
vi.mock("wouter", () => ({ useLocation: () => ["/customers/801", state.navigate] }));
vi.mock("./customerSupply", () => ({
    useCustomerSupplyAuthority: () => ({ identity: { key: "SYNTHETIC", enterpriseId: 31, actorUserId: 7 }, canRead: state.canReadSupply, failed: false }),
    supplyLocation: (id) => `/channel-inventory?supplyChannelId=${id}&supplyTab=materials`,
}));
vi.mock("../../../../../api/business-trpc", () => {
    const query = (name, data) => ({ useQuery: (input, options) => {
            state.inputs.push({ name, input, options });
            return { data: data(), isError: name === "enterprise" && state.enterpriseError, isPending: false, isFetching: false, ...state.queryFlags[name], refetch: vi.fn() };
        } });
    return { trpc: {
            enterprise: { me: query("enterprise", () => state.enterprise) },
            customer: { contactsList: query("contacts", () => state.contacts) },
            customerDemand: { list: query("demands", () => state.demands), get: query("demand", () => state.demand) },
            crmSalesOrder: { customerSummary: query("summary", () => state.summary), customerMaterials: query("materials", () => state.materials) },
            channelInventory: { customerSupplySummary: query("supply", () => state.supply) },
        } };
});
import { useCustomerWorkbenchOrders } from "./useCustomerWorkbenchOrders";
import { CustomerWorkbenchOverview } from "./CustomerWorkbenchOverview";
import { CustomerWorkbenchContacts } from "./CustomerWorkbenchContacts";
import { CustomerWorkbenchMaterials } from "./CustomerWorkbenchMaterials";
let root;
let host;
const scope = { enterpriseId: 31, actorUserId: 7, canManageAll: false };
const record = { id: 801, name: "SYNTHETIC", enterpriseId: 31, stage: "following", contactName: "PRIMARY", phone: "010-00000000", nextFollowUpAt: "2026-11-20T00:00:00Z", industryCode: "electronic_components", province: "", city: "", district: "", address: "", archivedAt: null };
async function render(element) { await act(async () => root.render(element)); }
const input = (name) => state.inputs.filter(item => item.name === name).at(-1);
beforeEach(() => {
    Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });
    state.enterprise = { enterprise: { id: 31 }, currentUserId: 7, permissionKeys: [], member: { status: "active" }, isOwner: false };
    state.enterpriseError = false;
    state.inputs = [];
    state.canReadSupply = false;
    state.queryFlags = {};
    state.navigate.mockReset();
    state.demands = { items: [{ id: 901, customerId: 801, demandNo: "D-SYNTHETIC", status: "submitted", projectName: "SAMPLE" }], total: 321, page: 1, pageSize: 3 };
    state.demand = { id: 901, customerId: 801, items: [{ id: 902, partNumber: "CURRENT-MATERIAL", brand: "TI", pkg: "QFN", qty: 12, qtyUnit: "片", deliveryRequirement: "现货" }] };
    state.contacts = { customer: { id: 801 }, contacts: [
            { id: "c1", name: "PRIMARY", isPrimary: true, methods: [{ type: "mobile", value: "13800000000" }] },
            { id: "c2", name: "SECOND", department: "采购", position: "经理", methods: [{ type: "email", value: "synthetic@example.invalid" }] },
            { id: "c3", name: "STOPPED-SECRET", stoppedAt: "2026-01-01", methods: [] },
        ] };
    state.summary = { customerId: 801, totalOrders: 123, awaitingPaymentOrders: 17, awaitingShipmentOrders: 8, monthlyOrders: 3 };
    state.materials = { items: [{ id: 1002, orderId: 1001, customerId: 801, orderNumber: "O-SYNTHETIC", partNumber: "ORDER-MATERIAL", brand: "TI", status: "cancelled", orderedQty: 20, shippedQty: 5, remainingQty: 0, unitPrice: "0.1234", qtyUnit: "片" }], total: 111 };
    state.supply = { items: [{ customerId: 801, channelId: 411, canViewStock: true, materialCount: 9 }] };
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
function Authority({ ready = true }) { const result = useCustomerWorkbenchOrders(scope, ready); return React.createElement("p", null, result.canRead ? "GRANTED" : "DENIED"); }
describe("verified customer workbench read gates", () => {
    it("does not infer order rights from customer ownership/manage labels; accepts only real sales grant", async () => {
        await render(React.createElement(Authority, null));
        expect(host.textContent).toBe("DENIED");
        state.enterprise.permissionKeys = ["sales.business_orders"];
        await render(React.createElement(Authority, null));
        expect(host.textContent).toBe("GRANTED");
        state.enterprise.permissionKeys = [];
        state.enterprise.isOwner = true;
        await render(React.createElement(Authority, null));
        expect(host.textContent).toBe("GRANTED");
    });
    it("fails closed for wrong enterprise, wrong actor, inactive member, error and unresolved scope", async () => {
        state.enterprise.permissionKeys = ["sales.business_orders"];
        for (const patch of [{ enterprise: { id: 32 } }, { currentUserId: 8 }, { member: { status: "inactive" } }]) {
            const old = state.enterprise;
            state.enterprise = { ...old, ...patch };
            await render(React.createElement(Authority, null));
            expect(host.textContent).toBe("DENIED");
            state.enterprise = old;
        }
        state.enterpriseError = true;
        await render(React.createElement(Authority, null));
        expect(host.textContent).toBe("DENIED");
        state.enterpriseError = false;
        await render(React.createElement(Authority, { ready: false }));
        expect(host.textContent).toBe("DENIED");
        expect(input("enterprise").options.enabled).toBe(false);
    });
    it("shows service total not page length, and separately gates whole-customer order aggregate", async () => {
        await render(React.createElement(CustomerWorkbenchOverview, { customer: record, followUps: [], canReadOrders: false, onTab: vi.fn() }));
        expect(host.textContent).toContain("321 笔需求");
        expect(host.textContent).toContain("最近 1 笔");
        expect(input("summary").options.enabled).toBe(false);
        expect(host.textContent).not.toContain("123");
        await render(React.createElement(CustomerWorkbenchOverview, { customer: record, followUps: [], canReadOrders: true, onTab: vi.fn() }));
        expect(input("summary").input).toEqual({ customerId: 801 });
        expect(host.textContent).toContain("123");
        expect(host.textContent).toContain("待登记收款");
        expect(host.textContent).toContain("月结登记不等于实际到账");
        state.summary.customerId = 802;
        await render(React.createElement(CustomerWorkbenchOverview, { customer: record, followUps: [], canReadOrders: true, onTab: vi.fn() }));
        expect(host.textContent).not.toContain("123");
    });
    it("does not grant from a matching cached enterprise response until the mounted read is fresh", async () => {
        state.enterprise.permissionKeys = ["sales.business_orders"];
        for (const flags of [{ isFetching: true }, { isFetchedAfterMount: false }, { isPlaceholderData: true }]) {
            state.queryFlags.enterprise = flags;
            await render(React.createElement(Authority, null)); expect(host.textContent).toBe("DENIED");
        }
        state.queryFlags.enterprise = { isFetchedAfterMount: true };
        await render(React.createElement(Authority, null)); expect(host.textContent).toBe("GRANTED");
    });
    it("masks refreshing or placeholder contact, summary and material responses", async () => {
        state.queryFlags.summary = { isFetching: true };
        await render(React.createElement(CustomerWorkbenchOverview, { customer: record, followUps: [], canReadOrders: true, onTab: vi.fn() }));
        expect(host.textContent).not.toContain("123");
        state.queryFlags.contacts = { isFetchedAfterMount: false };
        await render(React.createElement(CustomerWorkbenchContacts, { customerId: 801, scope, scopeReady: true }));
        expect(host.textContent).not.toContain("SECOND");
        state.queryFlags.demand = { isPlaceholderData: true }; state.queryFlags.materials = { isFetching: true };
        await render(React.createElement(CustomerWorkbenchMaterials, { customerId: 801, scope, scopeReady: true, canReadOrders: true }));
        expect(host.textContent).not.toContain("CURRENT-MATERIAL"); expect(host.textContent).not.toContain("ORDER-MATERIAL");
    });
    it("shows multiple real active contacts and blocks wrong-customer retained response", async () => {
        await render(React.createElement(CustomerWorkbenchContacts, { customerId: 801, scope: scope, scopeReady: true }));
        expect(host.textContent).toContain("SECOND");
        expect(host.textContent).toContain("采购 · 经理");
        expect(host.textContent).not.toContain("STOPPED-SECRET");
        expect(input("contacts").input).toEqual({ customerId: 801, expectedEnterpriseId: 31, expectedActorUserId: 7 });
        state.contacts.customer.id = 802;
        await render(React.createElement(CustomerWorkbenchContacts, { customerId: 801, scope: scope, scopeReady: true }));
        expect(host.textContent).not.toContain("SECOND");
    });
    it("separates demand materials, order snapshots and exact bound supply channel without full-library reads", async () => {
        state.canReadSupply = true;
        await render(React.createElement(CustomerWorkbenchMaterials, { customerId: 801, scope: scope, scopeReady: true, canReadOrders: true }));
        expect(host.textContent).toContain("CURRENT-MATERIAL");
        expect(host.textContent).toContain("ORDER-MATERIAL");
        expect(host.textContent).toContain("已取消");
        expect(host.textContent).toContain("0.1234");
        expect(input("demands").input).toEqual({ customerId: 801, page: 1, pageSize: 20 });
        expect(input("demand").input).toEqual({ id: 901 });
        expect(input("materials").input).toEqual({ customerId: 801, page: 1, pageSize: 20 });
        expect(input("supply").input).toMatchObject({ customerIds: [801], expectedEnterpriseId: 31, expectedActorUserId: 7 });
        await act(async () => [...host.querySelectorAll("button")].find(button => button.textContent?.includes("查看供应库存")).click());
        expect(state.navigate).toHaveBeenCalledWith("/channel-inventory?supplyChannelId=411&supplyTab=materials");
    });
    it("never shows foreign demand/order material or cached inventory when module grants are missing", async () => {
        state.demand.customerId = 802;
        state.materials.items[0].customerId = 802;
        await render(React.createElement(CustomerWorkbenchMaterials, { customerId: 801, scope: scope, scopeReady: true, canReadOrders: true }));
        expect(host.textContent).not.toContain("CURRENT-MATERIAL");
        expect(host.textContent).not.toContain("ORDER-MATERIAL");
        await render(React.createElement(CustomerWorkbenchMaterials, { customerId: 801, scope: scope, scopeReady: true, canReadOrders: false }));
        expect(input("materials").options.enabled).toBe(false);
        expect(input("supply").options.enabled).toBe(false);
        expect(host.textContent).not.toContain("查看供应库存");
        expect(state.inputs.every(item => !item.input?.keyword)).toBe(true);
    });
});
