import fs from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { describe, expect, it } from "vitest";
// @ts-expect-error The real static build helper is JavaScript, not a second implementation.
import { nullablePageReceiver, H, parse, nodes, ts } from "../../../deploy/admin-new-information-v1/build-page-markers.mjs";

const asset = fs.readFileSync(path.join(import.meta.dirname, "__fixtures__/Orders-new-information-e30f28c6506b3062.js"), "utf8");
const ast = parse(asset);
const fn = nodes(ast, (node: any) => ts.isFunctionDeclaration(node) && node.name?.text === "ls")[0];
const original: string = fn.getText(ast);
const token = "const __niPageRows=(o.data.rows??[])";
const candidate = original.replace(token, `const __niPageRows=(${nullablePageReceiver("Orders", "o.data.rows")}??[])`);
const success = { isLoading: false, isFetching: false, isSuccess: true, isError: false, isPlaceholderData: false, isFetchedAfterMount: true, error: null };
const row = { id: 123, orderNo: "SYNTHETIC-123", buyerId: 1, sellerId: 2, status: "refunded", totalAmount: 1, createdAt: "2026-01-01" };
function run(text: string, query: Record<string, unknown>, stats?: Record<string, unknown>, stateValues = [1, "", "", "all"]) {
  const calls: any[] = [];
  const context: Record<string, any> = {};
  for (const node of nodes(fn, (node: any) => ts.isIdentifier(node))) context[node.text] = `Mock:${node.text}`;
  let stateIndex = 0;
  const jsx = (type: unknown, props: any, key: unknown) => ({ type, props, key });
  Object.assign(context, { Math, Object, Boolean, Number, String, Array, Promise, undefined,
    H: () => ["/orders", (target: string) => calls.push({ kind: "navigate", target })],
    f: { useState: () => [stateValues[stateIndex++], (value: unknown) => calls.push({ kind: "setState", value })], useMemo: (cb: () => unknown) => cb() },
    C: { order: {
      list: { useQuery: (input: unknown, options: unknown) => { calls.push({ kind: "list", input, options }); return { ...query, refetch: () => { calls.push({ kind: "list-refetch" }); return Promise.resolve(); } }; } },
      stats: { useQuery: (input: unknown, options: unknown) => { calls.push({ kind: "stats", input, options }); return { ...(stats ?? { ...success, data: { totalOrders: 0, statusCounts: {} } }), refetch: () => { calls.push({ kind: "stats-refetch" }); return Promise.resolve(); } }; } },
    } },
    S: Object.fromEntries(["paid", "refunded", "unknown"].map(status => [status, { label: status, className: "mock" }])),
    __NI: { useAdminNewInformationContextRows: (options: any) => { calls.push({ kind: "notification", ...options }); return { getRow: () => ({ isNew: false, ref: () => {} }) }; }, AdminNewInformationRowBadge: "MockBadge" },
    s: { jsx, jsxs: jsx }, m: () => "mock-money", k: () => "mock-date",
  });
  const tree = vm.runInNewContext(`${text}\nls();`, context, { timeout: 1000 });
  const elements: any[] = [];
  function collect(value: any) { if (Array.isArray(value)) value.forEach(collect); else if (value && typeof value === "object" && value.props) { elements.push(value); collect(value.props.children); } }
  collect(tree);
  return { tree, calls, elements, json: JSON.stringify(tree) };
}

describe("actual immutable Orders complete compiled function", () => {
  it("binds the actual downloaded content hash and invokes the production receiver helper", () => {
    expect(H(asset)).toBe("e30f28c6506b3062865c507c1b42999ea5d2c99830f40d14b388d11998e68eed");
    expect(original.split(token)).toHaveLength(2);
    expect(candidate.replace("const __niPageRows=(o.data?.rows??[])", token)).toBe(original);
    expect(nullablePageReceiver("CrmSalesOrders", "q.data.items")).toBe("q.data?.items");
    expect(nullablePageReceiver("Orders", "o.data?.rows")).toBe("o.data?.rows");
    expect(nullablePageReceiver("CustomerList", "q.data.rows")).toBe("q.data.rows");
  });
  for (const name of ["cold-entry", "cold-filter", "cold-page", "identity-cache-cleared"]) {
    it(`${name}: executes full render with undefined data and reaches original loading UI`, () => {
      const query = { ...success, data: undefined, isLoading: true, isFetching: true, isSuccess: false, isFetchedAfterMount: false };
      expect(() => run(original, query)).toThrow("reading 'rows'");
      const result = run(candidate, query);
      expect(result.json).toContain("Mock:R");
      expect(result.json).not.toContain("没有符合条件的真实订单");
      expect(result.calls.find(call => call.kind === "notification")).toMatchObject({ refs: [], listReady: false, module: "sales" });
    });
  }
  it("no-data service error is not rewritten as empty; original retry refetches only list", () => {
    const result = run(candidate, { ...success, data: undefined, isSuccess: false, isError: true, error: { message: "SYNTHETIC_ERROR" } });
    expect(result.json).toContain("商城订单服务暂不可用");
    expect(result.json).not.toContain("没有符合条件的真实订单");
    result.elements.find(element => element.props.children === "重试").props.onClick();
    expect(result.calls.filter(call => /refetch/.test(call.kind))).toEqual([{ kind: "list-refetch" }]);
  });
  for (const [name, extra] of Object.entries({ success: {}, fetching: { isFetching: true }, placeholder: { isPlaceholderData: true }, error: { isSuccess: false, isError: true, error: { message: "synthetic" } }, previousMount: { isFetchedAfterMount: false } })) {
    it(`existing data ${name}: complete output, query ABI and readiness unchanged`, () => {
      const query = { ...success, data: { rows: [row], total: 1 }, ...extra };
      const before = run(original, query), after = run(candidate, query);
      expect(after.json).toBe(before.json);
      expect(JSON.stringify(after.calls)).toBe(JSON.stringify(before.calls));
      expect(after.calls.find(call => call.kind === "notification").listReady).toBe(name === "success");
    });
  }
  it("valid empty success remains empty and stats failure does not suppress a valid list", () => {
    expect(run(candidate, { ...success, data: { rows: [], total: 0 } }).json).toContain("没有符合条件的真实订单");
    const result = run(candidate, { ...success, data: { rows: [row], total: 1 } }, { ...success, data: undefined, error: { message: "STATS_FAILURE" } });
    expect(result.json).toContain("SYNTHETIC-123");
    expect(result.json).toContain("统计暂不可用");
  });
  it("retains list/stats retry ABI, applied filter/page and original detail navigation", () => {
    const result = run(candidate, { ...success, data: { rows: [row], total: 45 } }, undefined, [3, "draft", "applied", "refunded"]);
    expect(result.calls[0]).toMatchObject({ kind: "list", input: { page: 3, pageSize: 20, keyword: "applied", status: "refunded" }, options: { retry: 1 } });
    expect(result.calls[1]).toMatchObject({ kind: "stats", input: undefined, options: { retry: 1 } });
    result.elements.find(element => element.props.children === "查看详情").props.onClick({ stopPropagation() {} });
    expect(result.calls).toContainEqual({ kind: "navigate", target: "/orders/123" });
  });
});
