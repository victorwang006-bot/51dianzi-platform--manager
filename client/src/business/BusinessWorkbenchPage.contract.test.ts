import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import ts from "typescript";

const source = (name: string) => readFileSync(new URL(name, import.meta.url), "utf8");

describe("BusinessWorkbenchPage native migration contract", () => {
  it("uses the real front AppRouter for domain procedures and keeps BFF bootstrap separate", () => {
    const client = source("./api/business-trpc.ts");
    expect(client).toContain('import type { AppRouter } from "../platform/front-router-types/server/routers"');
    expect(client).toContain("createTRPCReact<AppRouter>()");
    expect(client).toContain("createTRPCReact<BusinessRouter>()");
    expect(client).toContain('url: "/api/business-trpc"');
    expect(client).toContain('"x-business-merchant-id": String(merchantId)');
    expect(client).toContain('credentials: "include"');
    expect(client).not.toContain("x-portal-key");
    expect(client).not.toContain("ownerUserId");
    expect(client).not.toContain("operatorUserId");
  });

  it("gets the official merchant only through the real root business endpoint", () => {
    const page = source("./BusinessWorkbenchPage.tsx");
    expect(page).toContain("adminTrpc.business.merchants.useQuery");
    expect(page).toContain("const OFFICIAL_ZHIJIE_MERCHANT_ID = 30061");
    expect(page).toContain("const officialMerchant = merchants.find(merchant => merchant.id === OFFICIAL_ZHIJIE_MERCHANT_ID) ?? null");
    expect(page).toContain("return <ScopedBusinessWorkbench merchantId={officialMerchant.id} routeBase={base} />");
    expect(page).not.toContain("merchants[0]");
    expect(page).not.toContain("MerchantSelection");
    expect(page).not.toContain('localStorage.getItem("merchantId")');
  });

  it("opens the verified official workspace without a query but fails closed for explicit IDs, empty scope, and unauthenticated bootstrap", () => {
    const page = source("./BusinessWorkbenchPage.tsx");
    expect(page).toContain('const hasQueryMerchantId = new URLSearchParams(search).has("merchantId")');
    expect(page).toContain("const hasExplicitMerchant = merchantId !== undefined || hasQueryMerchantId");
    expect(page).toContain("if (hasExplicitMerchant && requestedId !== OFFICIAL_ZHIJIE_MERCHANT_ID)");
    expect(page).toContain('title="请求的业务商户不可用"');
    expect(page).toContain("if (!officialMerchant)");
    expect(page).toContain('title="智捷官方工作区不可用"');
    expect(page).toContain("if (merchantList.isError)");
    expect(page).toContain('title="无法读取授权商户"');
    expect(page).toContain("merchantList.error.message ||");
    expect(page).toContain("if (!principal)");
    expect(page).toContain('title="未绑定前台业务主体"');
  });

  it("uses only the selected merchant BFF context for deep-route availability and fails closed for stale write fields", () => {
    const page = source("./BusinessWorkbenchPage.tsx");
    const gate = source("./BusinessWorkbenchAccessGate.tsx");
    expect(page).toContain("businessContextMatchesMerchant(merchantId, contextMerchant)");
    expect(page).toContain("<BusinessWorkbenchAccessProvider");
    expect(page).toContain("merchantCanWrite={contextMerchant?.canWrite === true}");
    expect(page).toContain("workbenchCapabilities={rawContext?.workbenchCapabilities}");
    expect(page).toContain("writeCapabilities={rawContext?.writeCapabilities}");
    expect(page).toContain('<BusinessWorkbenchRouteGate capability={requirement.capability} requiresWrite={requirement.requiresWrite}>');
    expect(page).toContain('return { capability: "inventory.publish", requiresWrite: true }');
    expect(page).toContain('return { capability: "marketplace.seller" }');
    expect(page).not.toContain("adminPermissions");
    expect(gate).toContain("merchantCanWrite ? scopedWriteCapabilities : []");
    expect(gate).toContain("!access.canWrite || !access.writeCapabilities.includes(capability)");
    expect(gate).toContain("不会合并其他商户、后台原生角色或权限");
  });

  it("keeps Dashboard as the only chrome and closes every registered business route", () => {
    const page = source("./BusinessWorkbenchPage.tsx");
    expect(page).not.toContain("iframe");
    const ast = ts.createSourceFile("BusinessWorkbenchPage.tsx", page, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const wrapper = ast.statements.find((node): node is ts.FunctionDeclaration =>
      ts.isFunctionDeclaration(node) && node.name?.text === "BusinessWorkbenchPage");
    expect(wrapper?.body?.statements).toHaveLength(1);
    const statement = wrapper!.body!.statements[0];
    expect(ts.isReturnStatement(statement)).toBe(true);
    if (!ts.isReturnStatement(statement) || !statement.expression) throw new Error("Workbench must return its original admin chrome");
    const jsx = ts.isParenthesizedExpression(statement.expression) ? statement.expression.expression : statement.expression;
    expect(ts.isJsxElement(jsx)).toBe(true);
    if (!ts.isJsxElement(jsx)) throw new Error("Workbench must have one DashboardLayout root");
    expect(jsx.openingElement.tagName.getText(ast)).toBe("DashboardLayout");
    const content = jsx.children.filter(ts.isJsxSelfClosingElement);
    expect(content).toHaveLength(1);
    expect(content[0].tagName.getText(ast)).toBe("BusinessWorkbenchContent");
    expect(content[0].attributes.getText(ast)).toBe("{...props}");
    expect((page.match(/<DashboardLayout>/g) ?? []).length).toBe(1);
    for (const path of [
      "/inventory", "/publish/:id/edit", "/inbound", "/channel-inventory",
      "/customers/new/:id", "/customer-demands", "/orders", "/outbound", "/chat",
      "/procurement-demands", "/procurement-orders/quote", "/procurement-orders/accepted",
      "/procurement-orders/create", "/add-user", "/user-records", "/company-info",
    ]) expect(page).toContain(`<Route path="${path}"`);
    expect(page).toContain("<Route component={UnmatchedBusinessPath} />");
    expect(page).not.toContain("<Route component={MyInventory} />");
  });

  it("mounts the authorized reconstructed Channel Host only inside the native business content scope", () => {
    const page = source("./BusinessWorkbenchPage.tsx");
    expect(page).toContain('import ChannelInventoryHost from "./platform/client/src/pages/ChannelInventoryHost"');
    expect(page).toContain('<Route path="/channel-inventory" component={BusinessChannelInventoryRoute} />');
    expect(page).toContain("<BusinessContentFrame>\n      <ChannelInventoryHost />\n    </BusinessContentFrame>");
    expect(page).not.toContain("UnavailableChannelInventory");
    expect(page).not.toContain("渠道库存尚未接入");
    expect(page).not.toContain("<ChannelInventoryHost enterpriseId=");
    expect(page).not.toContain("<ChannelInventoryHost actorUserId=");
  });

  it("uses the BFF-bound real front staff principal for UI scope and front auth", () => {
    const scope = source("./BusinessScope.tsx");
    const auth = source("./api/business-auth.ts");
    expect(scope).toContain("staffPrincipal.user");
    expect(scope).toContain("front-staff:${frontUser.id}:merchant:${merchantId}");
    expect(scope).not.toContain("useAdminAuth");
    expect(auth).toContain("useBusinessScope");
    expect(auth).not.toContain("@/_core/hooks/useAuth");
  });

  it("mounts only the narrow reception route after the separate BFF-ready capability", () => {
    const page = source("./BusinessWorkbenchPage.tsx");
    const scope = source("./BusinessScope.tsx");
    expect(page).toContain("sessionCapabilities.receptionReady !== true");
    expect(page).not.toContain("sessionCapabilities.chat !== true");
    expect(page).toContain("<ChatPage");
    expect(page).toContain("businessReception={{");
    expect(page).toContain('requiredPermission: "inquiry.receive"');
    expect(page).toContain("BUSINESS_CHAT_PERSONAL_FLOW_MESSAGES");
    expect(scope).toContain("receptionReady?: boolean");
    expect(scope).toContain("chat?: false");
  });
});
