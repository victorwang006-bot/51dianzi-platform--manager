import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import ts from "typescript";

const source = (name: string) =>
  readFileSync(new URL(name, import.meta.url), "utf8");

// Compare code contracts independent of Prettier-only syntax choices.
// Negative literal and structural AST assertions remain unchanged.
const codeShape = (text: string) =>
  text
    .replace(/\s+/g, "")
    .replace(/,(?=[)\]}])/g, "")
    .replace(/\(([$A-Za-z_][$A-Za-z_0-9]*)\)=>/g, "$1=>")
    .replace(/return\((<[^]*?\/>)\);/g, "return$1;");
const expectCodeToContain = (actual: string, expected: string) =>
  expect(codeShape(actual)).toContain(codeShape(expected));

describe("BusinessWorkbenchPage native migration contract", () => {
  it("uses the real front AppRouter for domain procedures and keeps BFF bootstrap separate", () => {
    const client = source("./api/business-trpc.ts");
    expectCodeToContain(
      client,
      'import type { AppRouter } from "../platform/front-router-types/server/routers"'
    );
    expectCodeToContain(client, "createTRPCReact<AppRouter>()");
    expectCodeToContain(client, "createTRPCReact<BusinessRouter>()");
    expectCodeToContain(client, 'url: "/api/business-trpc"');
    expectCodeToContain(client, '"x-business-merchant-id": String(merchantId)');
    expectCodeToContain(client, 'credentials: "include"');
    expect(client).not.toContain("x-portal-key");
    expect(client).not.toContain("ownerUserId");
    expect(client).not.toContain("operatorUserId");
  });

  it("gets the official merchant only through the narrow mounted BusinessRouter bootstrap", () => {
    const page = source("./BusinessWorkbenchPage.tsx");
    expectCodeToContain(page, "businessScopeTrpc.merchants.useQuery");
    expectCodeToContain(page, "createBusinessScopeTrpcClient()");
    expect(page).not.toContain("adminTrpc.business.merchants.useQuery");
    expectCodeToContain(page, "const OFFICIAL_ZHIJIE_MERCHANT_ID = 30061");
    expectCodeToContain(
      page,
      "const officialMerchant = merchants.find(merchant => merchant.id === OFFICIAL_ZHIJIE_MERCHANT_ID) ?? null"
    );
    expectCodeToContain(
      page,
      "return <ScopedBusinessWorkbench merchantId={officialMerchant.id} routeBase={base} />"
    );
    expect(page).not.toContain("merchants[0]");
    expect(page).not.toContain("MerchantSelection");
    expect(page).not.toContain('localStorage.getItem("merchantId")');
  });

  it("opens the verified official workspace without a query but fails closed for explicit IDs, empty scope, and unauthenticated bootstrap", () => {
    const page = source("./BusinessWorkbenchPage.tsx");
    expectCodeToContain(
      page,
      'const hasQueryMerchantId = new URLSearchParams(search).has("merchantId")'
    );
    expectCodeToContain(
      page,
      "const hasExplicitMerchant = merchantId !== undefined || hasQueryMerchantId"
    );
    expectCodeToContain(
      page,
      "if (hasExplicitMerchant && requestedId !== OFFICIAL_ZHIJIE_MERCHANT_ID)"
    );
    expectCodeToContain(page, 'title="请求的业务商户不可用"');
    expectCodeToContain(page, "if (!officialMerchant)");
    expectCodeToContain(page, 'title="未取得可用授权"');
    expectCodeToContain(page, "if (merchantList.isError)");
    expectCodeToContain(page, 'title="无法读取授权商户"');
    expectCodeToContain(page, "merchantList.error.message ||");
    expectCodeToContain(page, 'retryTestId="business-discovery-retry"');
    expectCodeToContain(page, "if (!principal || !rawContext)");
    expectCodeToContain(page, 'title="未绑定前台业务主体"');
  });

  it("uses only the selected merchant BFF context for deep-route availability and fails closed for stale write fields", () => {
    const page = source("./BusinessWorkbenchPage.tsx");
    const gate = source("./BusinessWorkbenchAccessGate.tsx");
    expectCodeToContain(
      page,
      "businessContextMatchesMerchant(merchantId, contextMerchant)"
    );
    expectCodeToContain(page, "<BusinessWorkbenchAccessProvider");
    expectCodeToContain(
      page,
      "merchantCanWrite={rawContext.merchant?.canWrite === true}"
    );
    expectCodeToContain(
      page,
      "workbenchCapabilities={rawContext.workbenchCapabilities}"
    );
    expectCodeToContain(
      page,
      "writeCapabilities={rawContext.writeCapabilities}"
    );
    expectCodeToContain(
      page,
      "<BusinessWorkbenchRouteGate capability={requirement.capability} requiresWrite={requirement.requiresWrite}>"
    );
    expectCodeToContain(
      page,
      'return { capability: "inventory.publish", requiresWrite: true }'
    );
    expectCodeToContain(page, 'return { capability: "marketplace.seller" }');
    expect(page).not.toContain("adminPermissions");
    expectCodeToContain(
      gate,
      "merchantCanWrite ? scopedWriteCapabilities : []"
    );
    expectCodeToContain(
      gate,
      "!access.canWrite || !access.writeCapabilities.includes(capability)"
    );
    expectCodeToContain(gate, "不会合并其他商户、后台原生角色或权限");
  });

  it("keeps Dashboard as the only chrome and closes every registered business route", () => {
    const page = source("./BusinessWorkbenchPage.tsx");
    expect(page).not.toContain("iframe");
    const ast = ts.createSourceFile(
      "BusinessWorkbenchPage.tsx",
      page,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX
    );
    const wrapper = ast.statements.find(
      (node): node is ts.FunctionDeclaration =>
        ts.isFunctionDeclaration(node) &&
        node.name?.text === "BusinessWorkbenchPage"
    );
    expect(wrapper?.body?.statements).toHaveLength(1);
    const statement = wrapper!.body!.statements[0];
    expect(ts.isReturnStatement(statement)).toBe(true);
    if (!ts.isReturnStatement(statement) || !statement.expression)
      throw new Error("Workbench must return its original admin chrome");
    const jsx = ts.isParenthesizedExpression(statement.expression)
      ? statement.expression.expression
      : statement.expression;
    expect(ts.isJsxElement(jsx)).toBe(true);
    if (!ts.isJsxElement(jsx))
      throw new Error("Workbench must have one DashboardLayout root");
    expect(jsx.openingElement.tagName.getText(ast)).toBe("DashboardLayout");
    const content = jsx.children.filter(ts.isJsxSelfClosingElement);
    expect(content).toHaveLength(1);
    expect(content[0].tagName.getText(ast)).toBe("BusinessWorkbenchContent");
    expect(content[0].attributes.getText(ast)).toBe("{...props}");
    expect((page.match(/<DashboardLayout>/g) ?? []).length).toBe(1);
    for (const path of [
      "/inventory",
      "/publish/:id/edit",
      "/inbound",
      "/channel-inventory",
      "/customers/new/:id",
      "/customer-demands",
      "/orders",
      "/outbound",
      "/chat",
      "/inquiries",
      "/procurement-demands",
      "/procurement-orders/quote",
      "/procurement-orders/accepted",
      "/procurement-orders/create",
      "/add-user",
      "/user-records",
      "/company-info",
    ])
      expectCodeToContain(page, `<Route path="${path}"`);
    expectCodeToContain(page, "<Route component={UnmatchedBusinessPath} />");
    expect(page).not.toContain("<Route component={MyInventory} />");
  });

  it("mounts the authorized reconstructed Channel Host only inside the native business content scope", () => {
    const page = source("./BusinessWorkbenchPage.tsx");
    expectCodeToContain(
      page,
      'import ChannelInventoryHost from "./platform/client/src/pages/ChannelInventoryHost"'
    );
    expectCodeToContain(
      page,
      '<Route path="/channel-inventory" component={BusinessChannelInventoryRoute} />'
    );
    expectCodeToContain(
      page,
      "<BusinessContentFrame>\n      <ChannelInventoryHost />\n    </BusinessContentFrame>"
    );
    expect(page).not.toContain("UnavailableChannelInventory");
    expect(page).not.toContain("渠道库存尚未接入");
    expect(page).not.toContain("<ChannelInventoryHost enterpriseId=");
    expect(page).not.toContain("<ChannelInventoryHost actorUserId=");
  });

  it("uses the BFF-bound real front staff principal for UI scope and front auth", () => {
    const scope = source("./BusinessScope.tsx");
    const auth = source("./api/business-auth.ts");
    expectCodeToContain(scope, "staffPrincipal.user");
    expectCodeToContain(
      scope,
      "business-domain:v1:staff:${frontUser.id}:admin:${staffPrincipal.adminAccountId}:enterprise:${staffPrincipal.enterpriseId}:merchant:${merchantId}:binding:${staffPrincipal.bindingVersion}"
    );
    expectCodeToContain(scope, "bindingVersion: number");
    expect(scope).not.toContain("useAdminAuth");
    expectCodeToContain(auth, "useBusinessScope");
    expect(auth).not.toContain("@/_core/hooks/useAuth");
  });

  it("mounts only the narrow reception route after the separate BFF-ready capability", () => {
    const page = source("./BusinessWorkbenchPage.tsx");
    const scope = source("./BusinessScope.tsx");
    expectCodeToContain(page, "sessionCapabilities.receptionReady !== true");
    expect(page).not.toContain("sessionCapabilities.chat !== true");
    expectCodeToContain(page, "<ChatPage");
    expectCodeToContain(page, "businessReception={{");
    expectCodeToContain(page, 'requiredPermission: "inquiry.receive"');
    expectCodeToContain(page, "BUSINESS_CHAT_PERSONAL_FLOW_MESSAGES");
    expectCodeToContain(scope, "receptionReady?: boolean");
    expectCodeToContain(scope, "chat?: false");
  });

  it("uses the permission-gated inquiry inbox as the entry and hands off to the original scoped chat route", () => {
    const page = source("./BusinessWorkbenchPage.tsx");
    const inbox = source(
      "./platform/client/src/pages/EnterpriseInquiryInbox.tsx"
    );
    expectCodeToContain(
      page,
      '<Route path="/inquiries" component={EnterpriseInquiryInbox} />'
    );
    expectCodeToContain(
      page,
      'if (pathname === "/chat" || pathname === "/inquiries") return { capability: "inquiry.receive" };'
    );
    expectCodeToContain(
      inbox,
      "href={`/chat?conversationId=${encodeURIComponent(String(conversationId))}`}"
    );
  });
});
