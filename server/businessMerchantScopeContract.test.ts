import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = (relative: string) => readFileSync(new URL(relative, import.meta.url), "utf8");

function sourceSection(text: string, start: string, end: string) {
  const startIndex = text.indexOf(start);
  const endIndex = startIndex < 0 ? -1 : text.indexOf(end, startIndex + start.length);
  if (startIndex < 0 || endIndex < 0) {
    throw new Error(`required source section is missing: ${start}`);
  }
  return text.slice(startIndex, endIndex);
}

describe("账号继承 BFF merchant scope 合同", () => {
  it("用独立 schema 和 migration 保存精确 scope、CAS 和不可变审计，而非 native 权限", () => {
    const schema = source("../drizzle/schema.ts");
    const migration = source("../drizzle/0027_business_merchant_scopes.sql");
    expect(schema).toContain('mysqlTable("admin_business_merchant_scopes"');
    expect(schema).toContain("scopeVersion");
    expect(schema).toContain("modulePermissions");
    expect(schema).toContain('mysqlTable("admin_business_merchant_scope_audits"');
    expect(migration).toContain("admin_business_merchant_scopes_admin_merchant_unique");
    expect(migration).toContain("admin_business_merchant_scope_audits_request_unique");
    expect(migration).not.toContain("admin_user_permissions");
  });

  it("每次 BFF 入口同时要求 exact scope、模块、allowlist、绑定和前台上下文", () => {
    const access = source("./businessAccess.ts");
    const router = source("./businessRouter.ts");
    const internalRouter = source("../../front/server/routers/internalBusiness.ts");
    const frontAccess = source("../../front/server/services/internalBusinessAccess.ts");
    const delegation = source("../../front/server/services/internalBusinessDelegation.ts");
    const projection = source("./businessWorkbenchProjection.ts");
    const authorization = sourceSection(
      router,
      "async function withCurrentBusinessAuthorization<T>(",
      "\nasync function forwardBusinessMethod(",
    );
    const forwarder = sourceSection(
      router,
      "async function forwardBusinessMethod(",
      "\nfunction businessQuery(",
    );

    // Preserve the original exact-scope, module, allowlist, and non-native-sales-scope contract.
    expect(access).toContain("getActiveBusinessMerchantScope(account.id, merchantId)");
    expect(access).toContain("businessScopeAllows(scope, module, mode)");
    expect(access).toContain("getBusinessWorkbenchMerchantIds");
    expect(access).not.toContain("getBusinessSalesStaffCodes");
    expect(access).toContain('officialReadProjection && mode === "read" && (module === "context" || module === "inventory")');
    expect(router).toContain("assertBusinessMerchantAccess(ctx, merchantId, capability.module, capability.mode, officialReadProjection)");
    expect(router).toContain("listActiveBusinessMerchantScopes(account.id)");
    expect(router).toContain("merchantScopes: merchantScopesRouter");

    // The old context-specific assertion moved to this common Fence: all fixed
    // businessQuery/businessMutation methods and direct context entries use it.
    expect(authorization).toContain("const account = requireBusinessAdminAccount(ctx);");
    expect(authorization).toContain("return db.withBusinessAuthorizationFence({ adminUserId: account.id, merchantId }, async () => {");
    expect(authorization).toContain("const staffBinding = await requireCurrentBusinessStaffBinding(account.id);");
    const activeBinding = sourceSection(router, "async function requireCurrentBusinessStaffBinding(", "\nfunction intersectOfficialInventoryPermissions(");
    expect(activeBinding).toContain("const staffBinding = await db.getActiveBusinessStaffBinding(adminUserId);");
    expect(activeBinding).toContain("if (!staffBinding)");
    expect(activeBinding).toContain('new BusinessFailureCause("STAFF_BINDING_INVALID")');
    expect(authorization).toContain('const channel = capability.method?.startsWith("channelInventory.") === true;');
    expect(authorization).toContain('const contextProjection = capability.module === "context" && capability.method === undefined;');
    expect(authorization).toContain("channel || contextProjection ? await currentOfficialInventoryPermissions(ctx) : undefined");
    expect(authorization).toContain('const publishing = capability.method === "channelInventory.publishFactoryMaterial";');
    expect(authorization).toContain('const requirement = publishing ? "publish" : notes ? "note" : capability.mode === "write" || managementRead ? "write" : "read";');
    expect(authorization).toContain('const managementRead = ["channelInventory.listMaterials", "channelInventory.getMaterial", "channelInventory.listSharedMaterials", "channelInventory.exportChannelMaterials"].includes(capability.method ?? "");');
    expect(authorization).toContain('if (managementRead && !businessScopeAllows(scope, "inventory", "write"))');
    expect(authorization).toContain("if (!officialInventoryPermissions?.read || !officialInventoryPermissions[requirement])");
    expect(authorization).toContain('const officialReadProjection = officialInventoryPermissions?.read === true && capability.mode === "read"');
    expect(authorization).toContain('&& (contextProjection || profileRead || nativeReadMethods.includes(capability.method ?? ""))');
    expect(authorization).toContain("const merchant = await assertBusinessMerchantAccess(ctx, merchantId, capability.module, capability.mode, officialReadProjection);");
    expect(authorization).toContain("const scope = await db.getActiveBusinessMerchantScope(account.id, merchantId);");
    expect(authorization).toContain("if (!scope) {");
    expect(authorization).toContain('new BusinessFailureCause("TENANT_ACCESS_REVOKED")');
    expect(authorization).toContain("if (!businessScopeAllows(scope, capability.module, capability.mode) && !officialReadProjection)");
    expect(authorization).toContain('customerScopeRead: businessScopeAllows(scope, "customers", "read")');
    expect(authorization).toContain("return operation({ account, staffBinding, scope, merchant, officialInventoryPermissions: requestOfficialInventoryPermissions });");
    expect(authorization.indexOf("const scope = await db.getActiveBusinessMerchantScope(account.id, merchantId);")).toBeLessThan(
      authorization.indexOf("const requestOfficialInventoryPermissions ="),
    );
    const nativeGrant = sourceSection(access, "export async function currentOfficialInventoryPermissions(", "/** Only attested creation IDs");
    expect(nativeGrant).not.toContain("customerScopeRead");
    expect(authorization.indexOf("const staffBinding = await requireCurrentBusinessStaffBinding(account.id);")).toBeLessThan(
      authorization.indexOf("const scope = await db.getActiveBusinessMerchantScope(account.id, merchantId);"),
    );
    expect(forwarder).toContain("return withCurrentBusinessAuthorization(ctx, merchantId, capability, async ({ staffBinding, scope, merchant, officialInventoryPermissions }) => {");
    expect(forwarder).toContain("result = await callPlatformBusinessCommand({");
    expect(forwarder).toContain("staffUserId: staffBinding.frontUserId");
    expect(forwarder).toContain("bindingVersion: staffBinding.bindingVersion");
    expect(forwarder).toContain("method: capability.method");
    expect(forwarder).toContain('write: officialInventoryPermissions.write && businessScopeAllows(scope, "inventory", "write")');
    expect(forwarder).toContain('publish: officialInventoryPermissions.publish === true && businessScopeAllows(scope, "inventory", "write")');
    expect(forwarder).toContain("scopeVersion: scope.scopeVersion");

    const directContextEntries = [
      sourceSection(router, "auth: router({", "  /**\n   * Navigation returns exact per-merchant projections."),
      sourceSection(router, "navigation: publicProcedure.query", "  merchants: publicProcedure"),
      sourceSection(router, "merchants: publicProcedure", "\n\n  context: publicProcedure"),
      sourceSection(router, "context: publicProcedure.query", "\n\n  organization: router({"),
    ];
    for (const entry of directContextEntries) {
      expect(entry).toContain('withCurrentBusinessAuthorization(ctx, merchantId, { module: "context", mode: "read" }');
    }
    expect(router).toContain("forwardBusinessMethod(ctx, input, { method, module, mode })");
    expect(router).toContain("forwardBusinessMethod(ctx, input, { method, module, mode: \"write\" })");

    // The front context is server-key-only and rechecks real user, selected member,
    // owner, ERP authority, and exact original permission on every delegated call.
    expect(internalRouter).toContain("requirePortalKey(ctx.req?.headers as Record<string, unknown> | undefined);");
    expect(internalRouter).toContain("method: z.enum(BUSINESS_METHOD_IDS)");
    expect(internalRouter).toContain("return executeInternalBusinessMethod({");
    expect(frontAccess).toContain("if (!user || user.loginDisabled || !user.lastSignedIn)");
    expect(frontAccess).toContain("if (enterprise.superAdminUserId !== input.expectedOwnerUserId)");
    expect(frontAccess).toContain("if (!ownerMember || ownerMember.status !== \"active\")");
    expect(frontAccess).toContain("await requireCurrentErpAuthority(identity, enterprise.superAdminUserId);");
    expect(frontAccess).toContain("const crmAccess = await requireCrmEnterpriseAccess({ user });");
    expect(frontAccess).toContain("? await requireActiveEnterpriseScope(user.id)");
    expect(frontAccess).toContain("? await requireEnterprisePermission(user.id, input.permission)");
    expect(frontAccess).toContain(": await requireAnyEnterprisePermission(user.id, input.permission);");
    expect(frontAccess).toContain("permissionScope.enterprise.id !== enterprise.enterpriseId");
    expect(frontAccess).toContain("permissionScope.dataOwnerUserId !== enterprise.dataOwnerUserId");
    expect(frontAccess).toContain("actorUserId: user.id");
    expect(delegation).toContain("const capability = BUSINESS_METHOD_CAPABILITIES[input.method];");
    expect(delegation).toContain("const requirement = officialInventoryMethodRequirement(input.method);");
    expect(delegation).toContain("const grant = requirement ? verifyOfficialInventoryGrant(input.officialInventoryGrant, {");
    expect(delegation).toContain("bindingVersion: input.bindingVersion, method: input.method, requestId: input.requestId");
    expect(delegation).toContain("if (grant && (!grant.read || !grant[requirement!]))");
    expect(delegation).toContain("if (grant && !officialInventoryErpEntitled(input.method, grant, capability.permission))");
    expect(delegation).toContain("permission: grant ? undefined : capability.permission");
    expect(delegation.indexOf("if (grant && !officialInventoryErpEntitled(input.method, grant, capability.permission))")).toBeLessThan(
      delegation.indexOf("const principal = await requireInternalBusinessStaffPrincipal({"),
    );
    expect(delegation).toContain("staffUserId: principal.actorUserId");
    expect(delegation).toContain("bindingVersion: input.bindingVersion");
    expect(delegation).toContain("requestId: input.requestId");
    expect(delegation).toContain("if (!target) throw new Error(\"INTERNAL_BUSINESS_METHOD_DISPATCH_MISSING\")");
    expect(projection).toContain("The front service remains the source of each fine-grained");
    expect(projection).toContain("frontWorkbenchCapabilities: readonly string[]");
  });

  it("scope CAS 和 requestId 重放审计均 fail closed，且不对 super_admin 留 bypass", () => {
    const db = source("./db.ts");
    const access = source("./businessAccess.ts");
    const router = source("./businessRouter.ts");
    const fence = source("./businessAuthorizationFence.ts");
    const delegation = source("../../front/server/services/internalBusinessDelegation.ts");

    // Preserve every original CAS/replay/audit/no-super-admin-bypass assertion.
    expect(db).toContain("BUSINESS_SCOPE_VERSION_CONFLICT");
    expect(db).toContain("BUSINESS_SCOPE_REQUEST_ID_REUSED");
    expect(db).toContain('for("update")');
    expect(db).toContain("business.merchant-scope.revoked");
    expect(db).toContain("No super-admin bypass");

    // A newly revoked scope cannot be served from a previous decision: both the
    // command and the grant/revoke mutation use the same account-before-scope Fence,
    // then the command fresh-reads active exact scope and version inside the Fence.
    expect(fence).toContain('const names = [`business-auth:admin:${key.adminUserId}`];');
    expect(fence).toContain('names.push(`business-auth:scope:${key.adminUserId}:${key.merchantId}`);');
    expect(fence).toContain("for (const name of businessAuthorizationFenceNames(key))");
    expect(router).toContain("return db.withBusinessAuthorizationFence({ adminUserId: account.id, merchantId }, async () => {");
    expect(router).toContain("const scope = await db.getActiveBusinessMerchantScope(account.id, merchantId);");
    expect(db).toContain("eq(adminBusinessMerchantScopes.adminUserId, adminUserId)");
    expect(db).toContain("eq(adminBusinessMerchantScopes.merchantId, merchantId)");
    expect(db).toContain('eq(adminBusinessMerchantScopes.status, "active")');
    expect(db).toContain("// Corrupt scope JSON fails closed rather than granting a partial module set.");
    expect(db).toContain("return withBusinessAuthorizationFence({ adminUserId: input.adminUserId, merchantId: input.merchantId }, () => db.transaction(async tx => {");
    expect(db).toContain("status: \"revoked\", scopeVersion, modulePermissions: []");

    // Neither native super-admin nor the outer scope replaces real front rights;
    // audits retain the backend actor, front staff, binding/scope versions and request ID.
    expect(access).toContain("All\n * roles, including super_admin, require the independently auditable exact scope");
    expect(delegation).toContain("Every delegated function enters its original");
    expect(delegation).toContain("bindingVersion: input.bindingVersion");
    expect(delegation).toContain("requestId: input.requestId");
    expect(db).toContain("staffUserId: input.staffUserId");
    expect(db).toContain("bindingVersion: input.bindingVersion");
    expect(db).toContain("scopeVersion: input.scopeVersion ?? null");
    expect(db).toContain("requestId: input.requestId");
    expect(db).toContain('authorizationFence: input.scopeVersion === undefined ? "legacy" : "held"');
  });
});
