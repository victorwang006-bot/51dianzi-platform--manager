import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const filePath = fileURLToPath(new URL("../../../business/platform/client/src/pages/CustomerDemands.tsx", import.meta.url));
const source = readFileSync(filePath, "utf8");
const ast = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

function findNodes<T extends ts.Node>(guard: (node: ts.Node) => node is T): T[] {
  const nodes: T[] = [];
  const visit = (node: ts.Node) => {
    if (guard(node)) nodes.push(node);
    ts.forEachChild(node, visit);
  };
  visit(ast);
  return nodes;
}

function elements(tag: string) {
  return findNodes(ts.isJsxElement).filter(node => node.openingElement.tagName.getText(ast) === tag);
}

function attribute(node: ts.JsxOpeningElement | ts.JsxSelfClosingElement, name: string) {
  return node.attributes.properties.find((property): property is ts.JsxAttribute =>
    ts.isJsxAttribute(property) && property.name.getText(ast) === name,
  )?.initializer?.getText(ast);
}

function variable(name: string) {
  return findNodes(ts.isVariableDeclaration).find(node => node.name.getText(ast) === name)?.initializer?.getText(ast) ?? "";
}

const openingElements = () => [...findNodes(ts.isJsxOpeningElement), ...findNodes(ts.isJsxSelfClosingElement)];

describe("客户需求统一呈现契约", () => {
  it("TSX可独立转换且采用公共页面、页头、筛选、数据容器", () => {
    const result = ts.transpileModule(source, {
      reportDiagnostics: true,
      compilerOptions: { jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
      fileName: filePath,
    });
    expect((result.diagnostics ?? []).filter(diagnostic => diagnostic.category === ts.DiagnosticCategory.Error)).toEqual([]);
    expect(elements("AdminPage")).toHaveLength(1);
    expect(elements("AdminFilterBar")).toHaveLength(1);
    expect(elements("AdminDataPanel")).toHaveLength(2);
    const header = openingElements().find(node => node.tagName.getText(ast) === "AdminPageHeader");
    expect(header).toBeDefined();
    expect(attribute(header!, "title")).toBe('"客户需求"');
    expect(attribute(header!, "actions")).toContain("录入需求");
    expect(elements("Card")).toHaveLength(0);
    expect(elements("h1")).toHaveLength(0);
    expect(source).not.toMatch(/\b(?:zoom|transform|!important)\b/);
  });

  it("保留筛选、范围权限和六个阶段统计入口", () => {
    const filters = elements("AdminFilterBar")[0].getText(ast);
    for (const label of ["搜索客户需求", "按需求阶段筛选", "按负责人筛选"]) expect(filters).toContain(label);
    expect(filters).toContain('canManageAll && scope === "all"');
    expect(filters).toContain("onClick={applyFilters}");
    expect(filters).toContain("onClick={resetFilters}");
    expect(variable("countCards").match(/key:/g)).toHaveLength(6);
    expect(source).toContain('card.key === "overdue" ? due === "overdue" : due === "all" && stage === card.key');
    expect(source).toContain('onClick={() => card.key === "overdue" ? (setDue("overdue"), setStage("all"), setPage(1)) : selectStage(card.key as StageFilter)}');
    expect(source).toContain("aria-pressed={selected}");
    expect(source).toContain('onValueChange={value => { setScope(value as ScopeFilter); setAssignedUserId("all"); setPage(1); }}');
  });

  it("保留全部七列并将原下一步操作移到最右且右对齐", () => {
    const heads = elements("TableHead");
    expect(heads.map(node => node.children.map(child => child.getText(ast)).join(""))).toEqual([
      "需求 / 客户", "型号摘要", "当前阶段", "采购报价", "负责人", "更新时间", "下一步",
    ]);
    heads.forEach(node => expect(attribute(node.openingElement, "className")).toContain("text-[11px]"));
    const cells = elements("TableCell");
    expect(cells).toHaveLength(7);
    expect(attribute(cells[6].openingElement, "className")).toContain("text-right");
    expect(cells[6].getText(ast)).toContain("onClick={() => handleNext(row)}");
    expect(cells[6].getText(ast)).toContain('row.workflowStage === "quote_confirmed" || row.workflowStage === "customer_confirmed"');
    expect(cells[1].getText(ast)).toContain("text-right text-[11px] tabular-nums");
    expect(cells[1].getText(ast)).toContain('`${formatQty(row.totalQty)}${row.qtyUnit || ""}`');
  });

  it("原有列表请求、负责人围栏和页面恢复逻辑不变", () => {
    const listInput = variable("listInput");
    expect(listInput).toContain('scope: canManageAll ? scope : "mine" as const');
    expect(listInput).toContain('canManageAll && scope === "all" && assignedUserId !== "all" ? { assignedUserId: Number(assignedUserId) } : {}');
    expect(listInput).toContain('...(stage === "all" ? {} : { stage })');
    expect(listInput).toContain("pageSize: PAGE_SIZE");
    expect(variable("listQuery")).toBe("useRestoringListQuery(trpc.customerDemand.salesList.useQuery(listInput, freshListOptions({ enabled: Boolean(contextQuery.data) }, d51Ready)))");
    expect(source).toContain('useRememberedState("draftKeyword", "")');
    expect(source).toContain('useRememberedState("keyword", "")');
    expect(variable("applyFilters")).toContain("setKeyword(draftKeyword.trim());");
    expect(variable("applyFilters")).toContain("setPage(1);");
    expect(variable("resetFilters")).toContain('setDue("all");');
    expect(source).toContain("if (result && page > totalPages) setPage(totalPages);");
  });

  it("保留报价轮次文本与原销售订单导航参数", () => {
    expect(source).toContain('`${row.quoteCount}份历史报价｜待重新报价`');
    expect(source).toContain('`${row.currentQuoteCount}份报价｜已采用${row.acceptedQuoteCount}份`');
    const handler = variable("handleNext");
    expect(handler).toContain('row.workflowStage === "quote_confirmed"');
    expect(handler).toContain('navigate(`/sales-orders?demandNo=${encodeURIComponent(row.demandNo)}`)');
    expect(handler).toContain('row.workflowStage === "customer_confirmed"');
    expect(handler).toContain('navigate(`/sales-orders?keyword=${encodeURIComponent(row.demandNo)}`)');
    expect(source).toContain('onClick={() => navigate(`/customers/${row.customerId}`)}');
  });

  it("保留新建和详情弹窗、客户选择及列表分页禁用条件", () => {
    const dialogs = openingElements().filter(node => node.tagName.getText(ast) === "CustomerDemandDialog");
    expect(dialogs).toHaveLength(2);
    expect(attribute(dialogs[0], "demandId")).toBe("{activeDemand.id}");
    expect(attribute(dialogs[0], "mode")).toBe('"view"');
    expect(attribute(dialogs[1], "customer")).toBe("{newDemandCustomer}");
    dialogs.forEach(node => expect(attribute(node, "onSaved")).toBe("{() => { void utils.customerDemand.salesList.invalidate(); }}"));
    expect(source).toContain('onOpenChange={open => { setCustomerSelectOpen(open); if (!open) setCustomerKeywordDraft(""); }}');
    expect(source).toContain('onClick={() => navigate("/customers?create=1")}');
    expect(source).toContain("setNewDemandCustomer({ id: customer.id, name: customer.name, archivedAt: customer.archivedAt })");
    expect(source).toContain("disabled={page <= 1 || listQuery.isFetching}");
    expect(source).toContain("disabled={page >= totalPages || listQuery.isFetching}");
    const pagingButtons = elements("Button").filter(node => /set(?:Customer)?Page\(value => value [+-] 1\)/.test(node.getText(ast)));
    expect(pagingButtons).toHaveLength(4);
    pagingButtons.forEach(node => expect(attribute(node.openingElement, "className")).toContain("h-8"));
  });
});
