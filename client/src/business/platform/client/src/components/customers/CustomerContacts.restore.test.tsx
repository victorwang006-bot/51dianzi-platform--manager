// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runtime = vi.hoisted(() => {
  const invalidate = vi.fn().mockResolvedValue(undefined);
  const reset = vi.fn().mockResolvedValue(undefined);
  const supplySummary = vi.fn().mockResolvedValue({ items: [], canWrite: false });
  return {
    supplySummary,
    supplyNative: { read: false, write: false, note: false, authorizationVersion: "v1" },
    contextQuery: null as unknown,
    detailQuery: null as unknown,
    updateBasic: vi.fn().mockResolvedValue({ replayed: false }),
    addFollowUp: vi.fn().mockResolvedValue({ replayed: false }),
    transfer: vi.fn().mockResolvedValue({}),
    listQuery: null as unknown,
    contactsQuery: null as unknown,
    listInputs: [] as unknown[],
    summaryInputs: [] as unknown[],
    contactsInputs: [] as unknown[],
    createMulti: vi.fn().mockResolvedValue({ id: 701, replayed: false }),
    contactsAdd: vi.fn().mockResolvedValue({ id: "n", contactId: "n", customerId: 701, replayed: false }),
    contactsEdit: vi.fn().mockResolvedValue({ id: "n", contactId: "n", customerId: 701, replayed: false }),
    contactsStop: vi.fn().mockResolvedValue({ id: "p", contactId: "p", customerId: 701, replayed: false }),
    contactsSetPrimary: vi.fn().mockResolvedValue({ id: "p", contactId: "p", customerId: 701, replayed: false }),
    popoverChange: null as ((open: boolean) => void) | null,
    utils: {
      client: { channelInventory: { customerSupplySummary: { query: supplySummary } } },
      customer: {
        contactsList: { invalidate, reset },
        contactsSummary: { invalidate },
        list: { invalidate },
        get: { invalidate },
      },
    },
  };
});

vi.mock("../../../../../api/business-trpc", () => ({
  trpc: {
    useUtils: () => runtime.utils,
    enterprise: { me: { useQuery: () => query({ currentUserId: 7, enterprise: { id: 31 }, permissionKeys: ["inventory.manage"] }) } },
    customer: {
      context: { useQuery: () => runtime.contextQuery },
      get: { useQuery: () => runtime.detailQuery },
      updateBasic: { useMutation: () => ({ isPending: false, mutateAsync: runtime.updateBasic }) },
      addFollowUp: { useMutation: () => ({ isPending: false, mutateAsync: runtime.addFollowUp }) },
      transfer: { useMutation: () => ({ isPending: false, mutateAsync: runtime.transfer }) },
      archive: { useMutation: () => ({ isPending: false, mutateAsync: vi.fn() }) },
      restore: { useMutation: () => ({ isPending: false, mutateAsync: vi.fn() }) },
      list: {
        useQuery: (input: unknown) => {
          runtime.listInputs.push(input);
          return runtime.listQuery;
        },
      },
      contactsSummary: {
        useQuery: (input: unknown, options?: { enabled?: boolean }) => {
          if (options?.enabled) runtime.summaryInputs.push(input);
          return query({
            items: [
              { customerId: 801, contactCount: 2, primaryContact: { id: "p801", name: "列表主联系人", methods: [{ type: "mobile", value: "13800138000" }], legacy: false } },
              { customerId: 802, contactCount: 1, primaryContact: { id: "p802", name: "列表单联系人", methods: [{ type: "email", value: "one@example.com" }], legacy: false } },
            ],
          });
        },
      },
      ownershipSearch: { useQuery: () => query(null) },
      createMulti: { useMutation: () => ({ isPending: false, mutateAsync: runtime.createMulti }) },
      contactsList: {
        useQuery: (input: unknown, options?: { enabled?: boolean }) => {
          if (options?.enabled) runtime.contactsInputs.push(input);
          return runtime.contactsQuery;
        },
      },
      contactsAdd: { useMutation: () => ({ isPending: false, mutateAsync: runtime.contactsAdd }) },
      contactsEdit: { useMutation: () => ({ isPending: false, mutateAsync: runtime.contactsEdit }) },
      contactsStop: { useMutation: () => ({ isPending: false, mutateAsync: runtime.contactsStop }) },
      contactsSetPrimary: { useMutation: () => ({ isPending: false, mutateAsync: runtime.contactsSetPrimary }) },
    },
  },
}));

vi.mock("../../../../../BusinessScope", () => ({ useBusinessScope: () => ({ storageScope: "test-customer-scope", contextVerification: { identity: "test-customer-scope", authorizationVersion: "v1", readVersion: "v1" }, officialInventoryPermissions: runtime.supplyNative, onAuthorizationError: vi.fn() }) }));
vi.mock("../../../../../api/business-auth", () => ({
  useAuth: () => ({ user: { id: 7 }, loading: false, isAuthenticated: true }),
}));

vi.mock("../../hooks/usePageIdentity", () => ({
  usePageIdentity: () => "account:7:enterprise:31",
}));

vi.mock("../../../../../api/business-enterprise-session", () => ({
  useOptionalEnterpriseSession: () => ({
    activeEnterprise: { enterpriseId: 31, memberStatus: "active", accessStatus: "enabled" },
    isLoading: false,
  }),
}));

vi.mock("../ui/button", () => ({
  Button: ({ children, ...props }: React.ComponentProps<"button">) => <button {...props}>{children}</button>,
}));
vi.mock("../ui/input", () => ({
  Input: (props: React.ComponentProps<"input">) => <input {...props} />,
}));
vi.mock("../ui/textarea", () => ({
  Textarea: (props: React.ComponentProps<"textarea">) => <textarea {...props} />,
}));
// Keep the real form/state handlers and make Radix choices native in jsdom.
vi.mock("../ui/select", () => ({
  Select: ({ children, value, onValueChange, disabled }: { children: React.ReactNode; value?: string; onValueChange?: (value: string) => void; disabled?: boolean }) => {
    const [trigger, content] = React.Children.toArray(children) as React.ReactElement<{ children?: React.ReactNode }>[];
    const { children: _children, ...props } = trigger.props;
    return <select {...props} value={value} disabled={disabled} onChange={event => onValueChange?.(event.target.value)}><option value="">请选择所属行业</option>{content.props.children}</select>;
  },
  SelectContent: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  SelectItem: ({ children, value }: { children?: React.ReactNode; value: string }) => <option value={value}>{children}</option>,
  SelectTrigger: () => null,
  SelectValue: () => null,
}));
vi.mock("./BeijingDateTimePicker", () => ({
  BeijingDateTimePicker: ({ value, onChange, clearable: _clearable, ...props }: { value: string; onChange: (value: string) => void; clearable?: boolean }) => <input {...props} value={value} onChange={event => onChange(event.target.value)} />,
}));
vi.mock("./CustomerOwnershipLookup", () => ({ CustomerOwnershipLookup: () => null }));
vi.mock("./ConfirmDialog", () => ({ ConfirmDialog: ({ title, error, confirmLabel, onConfirm, onCancel }: { title: string; error?: string; confirmLabel: string; onConfirm: () => void; onCancel: () => void }) => <div role="dialog"><h2>{title}</h2>{error && <p role="alert">{error}</p>}<button onClick={onConfirm}>{confirmLabel}</button><button onClick={onCancel}>取消确认</button></div> }));
vi.mock("../ui/dialog", () => ({
  Dialog: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  DialogContent: ({ children }: { children?: React.ReactNode }) => <div role="dialog">{children}</div>,
  DialogHeader: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children?: React.ReactNode }) => <h2>{children}</h2>,
  DialogDescription: ({ children }: { children?: React.ReactNode }) => <p>{children}</p>,
  DialogFooter: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("../ui/popover", () => ({
  Popover: ({ children, onOpenChange }: { children?: React.ReactNode; onOpenChange?: (open: boolean) => void }) => {
    runtime.popoverChange = onOpenChange ?? null;
    return <>{children}</>;
  },
  PopoverContent: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  PopoverTrigger: ({ children }: { children?: React.ReactNode }) => <span onClick={() => runtime.popoverChange?.(true)}>{children}</span>,
}));
vi.mock("../../../../../BusinessContentFrame", () => ({ default: ({ children }: { children?: React.ReactNode }) => <main>{children}</main> }));
vi.mock("../customerDemands/CustomerDemandDialog", () => ({ CustomerDemandDialog: () => null }));
vi.mock("../customerDemands/CustomerDemandHistory", () => ({ CustomerDemandHistory: () => null }));
vi.mock("../../hooks/usePageMemory", async () => {
  const react = await import("react");
  return {
    usePageMemory: () => true,
    useRememberedState: <T,>(_key: string, initial: T) => react.useState(initial),
    freshListOptions: <T,>(options: T) => options,
    useRestoringListQuery: <T,>(result: T) => result,
    returnToPageSource: () => undefined,
  };
});
vi.mock("wouter", () => ({ useLocation: () => ["/customers", vi.fn()], useSearch: () => "", useParams: () => ({ id: "801" }) }));

import { CustomerCreateForm } from "./CustomerCreateForm";
import { CustomerContactsManager } from "./CustomerContactsManager";
import { CustomerContactsSummary } from "./CustomerContactsSummary";
import type { CustomerContactScope } from "./customerContacts";
import CustomerList from "../../pages/CustomerList";
import CustomerDetail from "../../pages/CustomerDetail";
import { BUSINESS_INDUSTRY_OPTIONS } from "../../../../shared/businessIndustry";
import { EMPTY_CUSTOMER_FORM, recordToCustomerForm, customerFormToData } from "./customerUtils";
import { customerContactBaseData, validateCustomerContactBase } from "./customerContacts";
import { validateCustomerForm } from "./customerValidation";
import { __resetCustomerCreateDraftStoreForTests, customerCreateDraftEntry, updateCustomerCreateDraft } from "../../lib/customerCreateDraftStore";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
(globalThis as typeof globalThis & { React?: unknown }).React = React;

const scope: CustomerContactScope = { actorUserId: 7, enterpriseId: 31, canManageAll: false };

function query<T>(data: T, overrides: Record<string, unknown> = {}) {
  return {
    data,
    isPending: false,
    isLoading: false,
    isFetching: false,
    isError: false,
    error: new Error("fixture query error"),
    refetch: vi.fn().mockResolvedValue({ error: null }),
    ...overrides,
  };
}

function required<T>(value: T | null | undefined, message: string): T {
  if (value == null) throw new Error(message);
  return value;
}

function button(name: string) {
  return required(Array.from(document.body.querySelectorAll("button")).find(item => item.textContent?.trim() === name), `missing button: ${name}`);
}

function click(element: Element) {
  act(() => element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })));
}

function change(element: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement, value: string) {
  act(() => {
    const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), "value");
    descriptor?.set?.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

async function settle() {
  await act(async () => { await Promise.resolve(); });
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function render(element: React.ReactNode) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => root?.render(element));
  return {
    rerender: (next: React.ReactNode) => act(() => root?.render(next)),
  };
}

function configureFixtures() {
  runtime.supplyNative = { read: false, write: false, note: false, authorizationVersion: "v1" };
  runtime.supplySummary.mockReset().mockResolvedValue({ items: [], canWrite: false });
  __resetCustomerCreateDraftStoreForTests();
  runtime.updateBasic.mockClear();
  runtime.addFollowUp.mockClear();
  runtime.transfer.mockClear();
  runtime.contextQuery = query({ actorUserId: 7, canManageAll: false, members: [{ userId: 7, name: "测试销售" }] });
  runtime.listInputs = [];
  runtime.summaryInputs = [];
  runtime.contactsInputs = [];
  runtime.createMulti.mockClear();
  runtime.contactsAdd.mockClear();
  runtime.contactsEdit.mockClear();
  runtime.contactsStop.mockClear();
  runtime.contactsSetPrimary.mockClear();
  runtime.utils.customer.contactsList.invalidate.mockClear();
  runtime.utils.customer.contactsList.reset.mockClear();
  runtime.utils.customer.contactsSummary.invalidate.mockClear();
  runtime.utils.customer.list.invalidate.mockClear();
  runtime.utils.customer.get.invalidate.mockClear();
  runtime.popoverChange = null;
  runtime.listQuery = query({
    total: 2,
    page: 1,
    pageSize: 20,
    items: [
      { id: 801, name: "列表客户一", industryCode: "automotive", contactName: "旧联系人一", phone: "13800138000", email: "", grade: "A", stage: "new", scale: "unknown", province: "", city: "", district: "", address: "", source: "", nextFollowUpAt: null, assignedUserId: 7, assignedName: "测试销售", createdByUserId: 7, createdByName: "测试销售", createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z", version: 1, archivedAt: null, archiveReason: null, lastFollowUpAt: null },
      { id: 802, name: "列表客户二", industryCode: null, contactName: "旧联系人二", phone: "13800138001", email: "", grade: "C", stage: "following", scale: "unknown", province: "", city: "", district: "", address: "", source: "", nextFollowUpAt: null, assignedUserId: 7, assignedName: "测试销售", createdByUserId: 7, createdByName: "测试销售", createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z", version: 1, archivedAt: null, archiveReason: null, lastFollowUpAt: null },
    ],
  });
  runtime.detailQuery = query({ customer: { ...(runtime.listQuery as { data: { items: object[] } }).data.items[0], industryCode: null }, followUps: [] });
  runtime.contactsQuery = query({
    customer: { id: 701, name: "合成测试客户", assignedUserId: 7, assignedName: "测试销售", version: 4, archivedAt: null },
    canAdd: true,
    contacts: [
      { id: "p", name: "主联系人", department: "采购部", position: "经理", methods: [{ type: "mobile", value: "13800138000" }], isPrimary: true, legacy: false, authorUserId: 7, authorName: "测试销售", createdAt: null, updatedAt: null, version: 2, stoppedAt: null, canEdit: true },
      { id: "s", name: "替代联系人", department: "工程部", position: "主管", methods: [{ type: "wechat", value: "synthetic_wechat" }], isPrimary: false, legacy: false, authorUserId: 7, authorName: "测试销售", createdAt: null, updatedAt: null, version: 1, stoppedAt: null, canEdit: true },
      { id: "old", name: "历史联系人", department: "", position: "", methods: [{ type: "email", value: "old@example.com" }], isPrimary: false, legacy: false, authorUserId: 7, authorName: "测试销售", createdAt: null, updatedAt: null, version: 1, stoppedAt: "2026-10-01T00:00:00.000Z", canEdit: false },
    ],
  });
}

beforeEach(configureFixtures);
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  document.body.replaceChildren();
});

describe("customer contacts restore UI", () => {
  it("uses one current-page contactsSummary request without fetching full contacts for each list row", async () => {
    render(<CustomerList />);
    await settle();
    expect(Array.from(new Map(runtime.summaryInputs.map(input => [JSON.stringify(input), input])).values())).toEqual([{ customerIds: [801, 802], expectedActorUserId: 7, expectedEnterpriseId: 31 }]);
    expect(runtime.contactsInputs).toHaveLength(0);
    expect(document.body.textContent).toContain("列表主联系人");
    expect(button("更多")).toBeTruthy();
  });

  it("creates one customer with one primary contact through createMulti rather than the legacy create API", async () => {
    render(<CustomerCreateForm onCollapse={vi.fn()} onDiscarded={vi.fn()} onSaved={vi.fn()} onStateChange={vi.fn()} />);
    change(required(document.querySelector('[data-customer-field="name"]'), "missing customer name") as HTMLInputElement, "合成测试客户");
    change(required(document.querySelector('input[aria-label="联系人1姓名"]'), "missing contact name") as HTMLInputElement, "主联系人");
    change(required(document.querySelector('input[aria-label="联系人1联系方式值"]'), "missing contact method") as HTMLInputElement, "13800138000");
    change(required(document.querySelector('[data-customer-field="industryCode"]'), "missing industry") as HTMLSelectElement, "automotive");
    click(button("保存"));
    await settle();
    expect(runtime.createMulti).toHaveBeenCalledWith(expect.objectContaining({
      expectedActorUserId: 7,
      expectedEnterpriseId: 31,
      data: expect.objectContaining({ name: "合成测试客户", industryCode: "automotive" }),
      contacts: [{ name: "主联系人", department: "", position: "", methods: [{ type: "mobile", value: "13800138000" }], isPrimary: true }],
      initialFollowUp: "",
      requestId: expect.stringMatching(/^customer_[A-Za-z0-9_-]{16,}$/),
      confirmDuplicate: false,
    }));
    const payload = runtime.createMulti.mock.calls[0]?.[0] as { data: Record<string, unknown> };
    expect(payload.data).not.toHaveProperty("contactName");
    expect(payload.data).not.toHaveProperty("phone");
    expect(payload.data).not.toHaveProperty("email");
  });

  it("only fetches the full contacts list after the user selects 更多", async () => {
    render(<CustomerContactsSummary customerId={701} contactName="主联系人" primaryMethod="手机：13800138000" contactCount={2} scope={scope} scopeReady identityKey="7:31:7:ready" />);
    expect(runtime.contactsInputs).toHaveLength(0);
    click(button("更多"));
    await settle();
    expect(runtime.contactsInputs).toEqual([{ customerId: 701, expectedActorUserId: 7, expectedEnterpriseId: 31 }]);
    expect(document.body.textContent).toContain("共 2 位");
    expect(document.body.textContent).toContain("替代联系人");
    expect(document.body.textContent).not.toContain("历史联系人");
  });

  it("requires an explicit replacement before stopping a primary contact and closes/resets on identity change", async () => {
    const onClose = vi.fn();
    const view = render(<CustomerContactsManager customerId={701} open onClose={onClose} scope={scope} scopeReady identityKey="7:31:7:ready" />);
    click(button("停用"));
    expect(document.body.textContent).toContain("主联系人必须选择有效替代人");
    const confirm = button("确认停用");
    expect(confirm.disabled).toBe(true);
    change(required(document.querySelector('select[aria-label="主联系人替代人"]'), "missing replacement selector") as HTMLSelectElement, "s");
    click(button("确认停用"));
    await settle();
    expect(runtime.contactsStop).toHaveBeenCalledWith(expect.objectContaining({
      expectedActorUserId: 7,
      expectedEnterpriseId: 31,
      customerId: 701,
      contactId: "p",
      version: 2,
      replacementContactId: "s",
      requestId: expect.stringMatching(/^customer_[A-Za-z0-9_-]{16,}$/),
    }));

    view.rerender(<CustomerContactsManager customerId={701} open onClose={onClose} scope={{ ...scope, enterpriseId: 32 }} scopeReady identityKey="7:32:7:ready" />);
    await settle();
    expect(runtime.utils.customer.contactsList.reset).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });
});


const draftIdentity = "account:7:enterprise:31:customer-create:actor:7:enterprise:31:manage-all:no";
function fillCustomer() {
  change(required(document.querySelector('[data-customer-field="name"]'), "missing name") as HTMLInputElement, "行业测试客户");
  change(required(document.querySelector('input[aria-label="联系人1姓名"]'), "missing contact") as HTMLInputElement, "采购联系人");
  change(required(document.querySelector('input[aria-label="联系人1联系方式值"]'), "missing method") as HTMLInputElement, "13800138000");
}
function seedLegacyDraft(pending = false) {
  const request = pending ? { requestId: "customer_legacy_request_001", fingerprint: JSON.stringify({ scope: "31:7", data: { name: "旧客户" }, contacts: [] }) } : null;
  updateCustomerCreateDraft(draftIdentity, { form: { ...EMPTY_CUSTOMER_FORM, name: "旧客户", address: "旧地址", initialFollowUp: "旧备注" }, contacts: [{ id: "old-primary", name: "旧联系人", department: "采购", position: "经理", methods: [{ type: "mobile", value: "13800138000" }, { type: "wechat", value: "legacy_wechat" }], isPrimary: true }], request, pendingSave: request ? { ...request, kind: "unknown", mode: "close", confirmDuplicate: false } : null }, current => current);
  // Simulate an in-memory draft left by the pre-industry bundle, including absent field.
  const legacy = required(customerCreateDraftEntry(draftIdentity).draft, "missing seed draft");
  delete (legacy.form as Partial<typeof legacy.form>).industryCode;
  return legacy;
}

describe("business industry customer integration", () => {
  it("starts empty, requires industry on createMulti and submits the explicit selection", async () => {
    render(<CustomerCreateForm onCollapse={vi.fn()} onDiscarded={vi.fn()} onSaved={vi.fn()} onStateChange={vi.fn()} />);
    fillCustomer();
    const industry = required(document.querySelector<HTMLSelectElement>('[data-customer-field="industryCode"]'), "missing industry");
    expect(industry.value).toBe("");
    expect(industry.getAttribute("aria-required")).toBe("true");
    expect(Array.from(industry.options).slice(1).map(option => ({ value: option.value, label: option.text }))).toEqual(BUSINESS_INDUSTRY_OPTIONS);
    click(button("保存"));
    await settle();
    expect(runtime.createMulti).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("请选择所属行业");
    change(industry, "industrial_automation");
    click(button("保存"));
    await settle();
    expect(runtime.createMulti).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ industryCode: "industrial_automation" }), expectedActorUserId: 7, expectedEnterpriseId: 31 }));
  });

  it("places industry immediately after customer name and renders historical NULL as 未设置", async () => {
    render(<CustomerList />);
    await settle();
    expect(Array.from(document.querySelectorAll("thead th")).slice(0, 3).map(node => node.textContent?.trim())).toEqual(["客户名称", "所属行业", "联系人 / 电话"]);
    const rows = document.querySelectorAll("tbody tr");
    expect(rows[0].children[1].textContent).toBe("汽车电子");
    expect(rows[1].children[1].textContent).toBe("未设置");
    expect(document.querySelectorAll("col")).toHaveLength(9);
    expect(rows[0].children).toHaveLength(9);
    expect(runtime.listInputs.at(-1)).toMatchObject({ scope: "mine" });
  });

  it("requires a missing historical industry only when editing basic information", async () => {
    render(<CustomerDetail />);
    await settle();
    expect(document.body.textContent).toContain("所属行业：未设置");
    click(button("展开"));
    const industry = required(document.querySelector<HTMLSelectElement>('[data-customer-field="industryCode"]'), "missing basic industry");
    expect(industry.value).toBe("");
    click(button("保存修改"));
    await settle();
    expect(runtime.updateBasic).not.toHaveBeenCalled();
    change(industry, "semiconductor");
    click(button("保存修改"));
    await settle();
    expect(runtime.updateBasic).toHaveBeenCalledWith(expect.objectContaining({ customerId: 801, data: expect.objectContaining({ industryCode: "semiconductor" }) }));
    expect(runtime.updateBasic.mock.calls[0][0].data).not.toHaveProperty("contactName");
  });

  it("echoes a saved industry in the basic editor without auto-selecting other", async () => {
    const result = runtime.detailQuery as { data: { customer: object } };
    runtime.detailQuery = query({ ...result.data, customer: { ...result.data.customer, industryCode: "medical" } });
    render(<CustomerDetail />);
    await settle();
    click(button("展开"));
    expect(document.querySelector<HTMLSelectElement>('[data-customer-field="industryCode"]')?.value).toBe("medical");
    expect(document.body.textContent).toContain("所属行业：医疗电子");
  });

  it("does not require industry for a separate historical customer follow-up", async () => {
    render(<CustomerDetail />);
    await settle();
    click(button("新增跟进"));
    change(required(document.querySelector('textarea[aria-label="跟进内容"]'), "missing follow-up") as HTMLTextAreaElement, "行业待补，正常追加跟进");
    click(button("保存跟进"));
    await settle();
    expect(runtime.addFollowUp).toHaveBeenCalledTimes(1);
    expect(runtime.addFollowUp.mock.calls[0][0]).not.toHaveProperty("industryCode");
  });

  it("restores a legacy draft with every contact and field, and leaves industry empty", async () => {
    const original = seedLegacyDraft();
    render(<CustomerCreateForm onCollapse={vi.fn()} onDiscarded={vi.fn()} onSaved={vi.fn()} onStateChange={vi.fn()} />);
    await settle();
    expect(document.querySelector<HTMLInputElement>('[data-customer-field="name"]')?.value).toBe("旧客户");
    expect(document.querySelector<HTMLInputElement>('[data-customer-field="address"]')?.value).toBe("旧地址");
    expect(document.querySelector<HTMLTextAreaElement>('[data-customer-field="initialFollowUp"]')?.value).toBe("旧备注");
    expect(document.querySelector<HTMLSelectElement>('[data-customer-field="industryCode"]')?.value).toBe("");
    expect(document.querySelector<HTMLInputElement>('input[aria-label="联系人1姓名"]')?.value).toBe("旧联系人");
    expect(Array.from(document.querySelectorAll<HTMLInputElement>('input[aria-label="联系人1联系方式值"]')).map(input => input.value)).toEqual(["13800138000", "legacy_wechat"]);
    const contacts = customerCreateDraftEntry(draftIdentity).draft?.contacts;
    expect(contacts).toEqual(original.contacts);
    expect(customerCreateDraftEntry("account:8:enterprise:31:customer-create:actor:8:enterprise:31:manage-all:no").draft).toBeNull();
    click(button("保存"));
    await settle();
    expect(runtime.createMulti).not.toHaveBeenCalled();
  });

  it("keeps an uncertain pre-industry request locked without rewriting its fingerprint or reusing its id", async () => {
    const original = seedLegacyDraft(true);
    render(<CustomerCreateForm onCollapse={vi.fn()} onDiscarded={vi.fn()} onSaved={vi.fn()} onStateChange={vi.fn()} />);
    await settle();
    expect(document.querySelector<HTMLSelectElement>('[data-customer-field="industryCode"]')?.disabled).toBe(true);
    click(button("使用相同内容重试"));
    await settle();
    expect(runtime.createMulti).not.toHaveBeenCalled();
    expect(customerCreateDraftEntry(draftIdentity).draft?.pendingSave).toEqual(original.pendingSave);
    expect(customerCreateDraftEntry(draftIdentity).draft?.request).toEqual(original.request);
    expect(document.body.textContent).toContain("请先核对客户保存结果");
    click(button("取消确认"));
    expect(customerCreateDraftEntry(draftIdentity).draft?.pendingSave).toEqual(original.pendingSave);
  });

  it("also keeps the legacy single-contact validation/conversion industry-aware", () => {
    const form = { ...EMPTY_CUSTOMER_FORM, name: "测试客户", contactName: "联系人", phone: "13800138000" };
    expect(validateCustomerForm(form)).toMatchObject({ success: false, errors: { industryCode: "请选择所属行业" } });
    expect(validateCustomerContactBase(form)).toHaveProperty("industryCode");
    form.industryCode = "other";
    expect(customerFormToData(form).industryCode).toBe("other");
    expect(customerContactBaseData(form).industryCode).toBe("other");
    expect(validateCustomerForm(form).success).toBe(true);
    const record = (runtime.listQuery as { data: { items: Parameters<typeof recordToCustomerForm>[0][] } }).data.items[1];
    expect(recordToCustomerForm(record).industryCode).toBe("");
  });
});


describe("industry legacy draft identity fences", () => {
  it("removes an old identity's customer and contacts when the real draft hook switches identity", async () => {
    seedLegacyDraft();
    const view = render(<CustomerCreateForm draftIdentity={draftIdentity} onCollapse={vi.fn()} onDiscarded={vi.fn()} onSaved={vi.fn()} onStateChange={vi.fn()} />);
    await settle();
    const nextIdentity = "account:8:enterprise:32:customer-create:actor:8:enterprise:32:manage-all:no";
    view.rerender(<CustomerCreateForm draftIdentity={nextIdentity} onCollapse={vi.fn()} onDiscarded={vi.fn()} onSaved={vi.fn()} onStateChange={vi.fn()} />);
    await settle();
    expect(document.querySelector<HTMLInputElement>('[data-customer-field="name"]')?.value).toBe("");
    expect(document.querySelector<HTMLInputElement>('input[aria-label="联系人1姓名"]')?.value).toBe("");
    expect(document.querySelector<HTMLSelectElement>('[data-customer-field="industryCode"]')?.value).toBe("");
    expect(customerCreateDraftEntry(draftIdentity).draft).toBeNull();
    expect(runtime.createMulti).not.toHaveBeenCalled();
  });
});


describe("customer supply list keeps original CRM workflows", () => {
  function enableSupply() { runtime.supplyNative = { read: true, write: true, note: true, authorizationVersion: "v1" }; }
  function supply() { return { items: [{ customerId: 801, channelId: 411, materialCount: 3, canUpload: true, canViewStock: true, disabledReason: null }, { customerId: 802, channelId: null, materialCount: null, canUpload: false, canViewStock: false, disabledReason: "请补全所属行业" }], canWrite: true }; }
  it("places supply after owner/before followup without shrinking contacts or removing demand/follow buttons", async () => {
    enableSupply(); runtime.supplySummary.mockResolvedValue(supply()); render(<CustomerList />); await settle();
    expect(Array.from(document.querySelectorAll("thead th")).slice(4).map(node => node.textContent?.trim())).toEqual(["负责人", "供应库存", "下次跟进", "需求", "操作"]);
    expect(document.querySelectorAll("col")[2].getAttribute("class")).toBe("w-[312px]"); expect(document.querySelectorAll("col")[5].getAttribute("class")).toBe("w-[120px]");
    const row = document.querySelectorAll("tbody tr")[0];
    expect(row.querySelector<HTMLButtonElement>('[data-testid="supply-cell"] button')?.disabled).toBe(false);
    expect(row.querySelector<HTMLButtonElement>('[data-testid="demand-cell"] button')?.disabled).toBe(false);
    expect(row.querySelector<HTMLButtonElement>('[data-testid="actions-cell"] button')?.disabled).toBe(false);
    expect(document.body.textContent).toContain("查看库存（3）"); expect(document.body.textContent).toContain("补全客户档案");
    expect(runtime.supplySummary).toHaveBeenCalledTimes(1); expect(runtime.supplySummary).toHaveBeenCalledWith({ customerIds: [801, 802], expectedEnterpriseId: 31, expectedActorUserId: 7 }, { signal: expect.any(AbortSignal) });
  });
  it("summary failure disables only supply while retaining real contacts, demand and followup", async () => {
    enableSupply(); runtime.supplySummary.mockRejectedValue(new Error("supply denied")); render(<CustomerList />); await settle();
    expect(document.body.textContent).toContain("列表主联系人"); expect(document.body.textContent).not.toContain("查看库存");
    for (const cell of Array.from(document.querySelectorAll('[data-testid="supply-cell"]'))) expect(cell.querySelector<HTMLButtonElement>("button")?.disabled).toBe(true);
    for (const cell of Array.from(document.querySelectorAll('[data-testid="demand-cell"], [data-testid="actions-cell"]'))) expect(cell.querySelector<HTMLButtonElement>("button")?.disabled).toBe(false);
  });
  it("aborts old summary identity and never paints its late channel/count after revocation", async () => {
    enableSupply(); let finish!: (value: unknown) => void;
    runtime.supplySummary.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockResolvedValue({ items: [], canWrite: false });
    const view = render(<CustomerList />); const signal = runtime.supplySummary.mock.calls[0][1].signal as AbortSignal;
    runtime.supplyNative.authorizationVersion = "revoked-v2"; runtime.supplyNative.write = false; view.rerender(<CustomerList />); await settle(); expect(signal.aborted).toBe(true);
    await act(async () => { finish(supply()); }); expect(document.body.textContent).not.toContain("查看库存（3）");
    expect(document.querySelector<HTMLButtonElement>('[data-testid="supply-cell"] button')?.disabled).toBe(true);
    expect(document.body.textContent).toContain("需求录入"); expect(document.body.textContent).toContain("跟进");
  });
});
