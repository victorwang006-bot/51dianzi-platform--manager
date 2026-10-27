import type { Express, Request, Response } from "express";
import { parseLocalAdminId } from "../adminAuth";
import { createContext, type TrpcContext } from "../_core/context";
import {
  ZHIJIE_API_PREFIX,
  ZHIJIE_ENTERPRISE_ID,
  isZhijieModule,
  type ZhijieAccessInput,
  type ZhijieContext,
  type ZhijieGrants,
  type ZhijieSetup,
  type ZhijieStaffAccess,
} from "@shared/zhijieBusiness";
import {
  canAccessModule,
  isZhijieRole,
  readableModules,
  scopeOwner,
  validateAccess,
} from "./policy";
import {
  MysqlZhijieSourceAdapter,
  type ZhijieSourceAdapter,
  type ZhijieSourceSnapshot,
} from "./source";
import { MysqlZhijieAccessStore, type ZhijieAccessStore } from "./store";

const NO_STORE = "private, no-store, max-age=0";
const DEFAULT_ADMIN_ORIGIN = "https://admin.51dianzi.com";

type LocalAdminContext = Pick<TrpcContext, "user" | "adminAccount">;
type ContextFactory = (options: {
  req: Request;
  res: Response;
}) => Promise<LocalAdminContext>;

export interface ZhijieRouteOptions {
  source?: ZhijieSourceAdapter;
  store?: ZhijieAccessStore;
  createContext?: ContextFactory;
}

function responseError(
  res: Response,
  status: number,
  code: string,
  message: string
) {
  return res.status(status).json({ error: code, message });
}

function setNoStore(res: Response) {
  res.setHeader("Cache-Control", NO_STORE);
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
}

function currentOrigin(): string {
  return process.env.ADMIN_PUBLIC_ORIGIN || DEFAULT_ADMIN_ORIGIN;
}

function isTestRuntime(): boolean {
  return process.env.VITEST === "true" || process.env.NODE_ENV === "test";
}

function hasAllowedMutationOrigin(req: Request): boolean {
  const allowed = currentOrigin();
  const origin = req.get("origin");
  // Browser-originated mutations require the exact configured origin.  Tests
  // may use an in-memory Express client without an Origin header.
  if (!origin) return isTestRuntime();
  if (origin !== allowed) return false;
  const referer = req.get("referer");
  if (!referer) return true;
  try {
    return new URL(referer).origin === allowed;
  } catch {
    return false;
  }
}

async function requireLocalAdmin(
  req: Request,
  res: Response,
  contextFactory: ContextFactory
): Promise<NonNullable<LocalAdminContext["adminAccount"]> | null> {
  try {
    const ctx = await contextFactory({ req, res });
    const account = ctx.adminAccount;
    const user = ctx.user;
    // `adminAccount` is populated solely for a current local-admin JWT by the
    // core context.  Re-check all invariants here so OAuth/global `user.role`
    // can never become an authorization fallback for this sidecar.
    if (
      !account ||
      account.status !== "active" ||
      !user ||
      user.id !== account.id ||
      user.loginMethod !== "password" ||
      parseLocalAdminId(user.openId) !== account.id
    ) {
      responseError(
        res,
        401,
        "LOCAL_ADMIN_REQUIRED",
        "需要有效的本地后台登录会话"
      );
      return null;
    }
    return account;
  } catch {
    responseError(
      res,
      401,
      "LOCAL_ADMIN_REQUIRED",
      "需要有效的本地后台登录会话"
    );
    return null;
  }
}

function isSuperAdmin(
  account: NonNullable<LocalAdminContext["adminAccount"]>
): boolean {
  return account.adminRole === "super_admin";
}

function parseAccessInput(body: unknown): ZhijieAccessInput | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const value = body as Record<string, unknown>;
  const adminUserId = Number(value.adminUserId);
  const sourceMemberId = Number(value.sourceMemberId);
  const expectedRevision = Number(value.expectedRevision);
  const role = value.role;
  const status = value.status;
  const teamIds = value.teamIds;
  const grants = value.grants;
  const reason = typeof value.reason === "string" ? value.reason.trim() : "";
  if (
    !Number.isSafeInteger(adminUserId) ||
    adminUserId <= 0 ||
    !Number.isSafeInteger(sourceMemberId) ||
    sourceMemberId <= 0
  )
    return null;
  if (
    !Number.isSafeInteger(expectedRevision) ||
    expectedRevision < 0 ||
    !isZhijieRole(role)
  )
    return null;
  if (status !== "active" && status !== "disabled") return null;
  if (
    !Array.isArray(teamIds) ||
    !teamIds.every(id => Number.isSafeInteger(id) && Number(id) > 0)
  )
    return null;
  if (
    !grants ||
    typeof grants !== "object" ||
    Array.isArray(grants) ||
    !reason ||
    reason.length > 255
  )
    return null;
  return {
    adminUserId,
    sourceMemberId,
    role,
    teamIds: teamIds.map(Number),
    grants: grants as ZhijieGrants,
    status,
    expectedRevision,
    reason,
  };
}

interface ResolvedAccess {
  access: ZhijieStaffAccess | null;
  snapshot: ZhijieSourceSnapshot;
  valid: boolean;
  scopeLabel: string;
}

async function resolveAccess(
  store: ZhijieAccessStore,
  source: ZhijieSourceAdapter,
  adminUserId: number
): Promise<ResolvedAccess> {
  const [access, snapshot] = await Promise.all([
    store.getAccessForAdmin(adminUserId),
    source.loadSnapshot(),
  ]);
  if (!access)
    return { access: null, snapshot, valid: false, scopeLabel: "未配置" };
  const sourceMember =
    snapshot.members.find(
      member => member.memberId === access.sourceMemberId
    ) ?? null;
  const validation = validateAccess(access, sourceMember, snapshot.teams);
  const scope = validation.ok ? scopeOwner(access, snapshot.teams) : null;
  return {
    access,
    snapshot,
    valid: Boolean(scope),
    scopeLabel: scope?.label ?? "无有效数据范围",
  };
}

function contextFromResolved(
  account: NonNullable<LocalAdminContext["adminAccount"]>,
  resolved: ResolvedAccess
): ZhijieContext {
  const sourceMember = resolved.access
    ? (resolved.snapshot.members.find(
        member => member.memberId === resolved.access?.sourceMemberId
      ) ?? null)
    : null;
  const readable = resolved.valid
    ? readableModules(resolved.access, sourceMember)
    : [];
  const authorized = resolved.valid && readable.length > 0;
  return {
    companyName: resolved.snapshot.enterprise.companyName,
    enterpriseId: ZHIJIE_ENTERPRISE_ID,
    canConfigure: isSuperAdmin(account),
    authorized,
    connected: false,
    status: !resolved.access
      ? "unconfigured"
      : authorized
        ? "ready"
        : "unauthorized",
    message: !resolved.access
      ? "尚未配置智捷业务授权；超级管理员不会自动获得业务权限。"
      : authorized
        ? "功能已建立，智捷业务数据尚未接入。"
        : "来源成员、范围或模块授权无效，已拒绝访问。",
    access: resolved.access,
    teams: isSuperAdmin(account)
      ? resolved.snapshot.teams
      : resolved.snapshot.teams.filter(team =>
          resolved.access?.role === "employee"
            ? team.id === sourceMember?.teamId
            : resolved.access?.teamIds.includes(team.id)
        ),
    scopeLabel: resolved.scopeLabel,
    readableModules: readable,
  };
}

/**
 * Registers only the `/api/zhijie` namespace.  Parent application integration
 * can call this next to its existing middleware; the standalone sidecar uses
 * the same core createContext/sessionVersion validation.
 */
export function registerZhijieRoutes(
  app: Express,
  options: ZhijieRouteOptions = {}
) {
  const source = options.source ?? new MysqlZhijieSourceAdapter();
  const store = options.store ?? new MysqlZhijieAccessStore();
  const contextFactory: ContextFactory =
    options.createContext ?? (createContext as unknown as ContextFactory);

  app.use(ZHIJIE_API_PREFIX, (_req, res, next) => {
    setNoStore(res);
    next();
  });

  app.get(`${ZHIJIE_API_PREFIX}/context`, async (req, res) => {
    const account = await requireLocalAdmin(req, res, contextFactory);
    if (!account) return;
    try {
      const resolved = await resolveAccess(store, source, account.id);
      return res.json(contextFromResolved(account, resolved));
    } catch {
      // Source metadata is an authorization dependency, not optional display
      // data.  Do not emit a partially authorized context when it is absent.
      const payload: ZhijieContext = {
        companyName: "",
        enterpriseId: ZHIJIE_ENTERPRISE_ID,
        canConfigure: isSuperAdmin(account),
        authorized: false,
        connected: false,
        status: "source_unavailable",
        message: "来源组织暂不可用，已拒绝业务访问。",
        access: null,
        teams: [],
        scopeLabel: "无有效数据范围",
        readableModules: [],
      };
      return res.status(503).json(payload);
    }
  });

  app.get(`${ZHIJIE_API_PREFIX}/setup`, async (req, res) => {
    const account = await requireLocalAdmin(req, res, contextFactory);
    if (!account) return;
    if (!isSuperAdmin(account))
      return responseError(
        res,
        403,
        "CONFIGURATION_FORBIDDEN",
        "仅超级管理员可查看授权配置"
      );
    try {
      const [schemaReady, adminAccounts, staff, sourceResult] =
        await Promise.all([
          store.isSchemaReady(),
          store.listAdminAccounts(),
          store.listStaff(),
          source
            .loadSnapshot()
            .then(snapshot => ({ snapshot }))
            .catch(() => ({ snapshot: null })),
        ]);
      const snapshot = sourceResult.snapshot;
      const payload: ZhijieSetup = {
        schemaReady,
        sourceReady: Boolean(snapshot),
        message: snapshot
          ? "来源组织只读校验已就绪；业务数据桥接仍未启用。"
          : "来源组织暂不可用；不能创建或更新授权。",
        adminAccounts,
        members: snapshot?.members ?? [],
        teams: snapshot?.teams ?? [],
        staff,
      };
      return res.json(payload);
    } catch {
      return responseError(res, 503, "SETUP_UNAVAILABLE", "授权配置暂不可用");
    }
  });

  app.put(`${ZHIJIE_API_PREFIX}/access`, async (req, res) => {
    if (!hasAllowedMutationOrigin(req))
      return responseError(res, 403, "ORIGIN_FORBIDDEN", "请求来源不被允许");
    const account = await requireLocalAdmin(req, res, contextFactory);
    if (!account) return;
    if (!isSuperAdmin(account))
      return responseError(
        res,
        403,
        "CONFIGURATION_FORBIDDEN",
        "仅超级管理员可配置授权"
      );
    const input = parseAccessInput(req.body);
    if (!input)
      return responseError(res, 400, "INVALID_ACCESS_INPUT", "授权参数无效");
    // Deliberately no bootstrap exception: a first super-admin has no implicit
    // business access and must arrange a separate active account to configure.
    if (input.adminUserId === account.id)
      return responseError(
        res,
        403,
        "SELF_GRANT_FORBIDDEN",
        "当前阶段禁止配置自己的智捷业务授权"
      );
    try {
      const [target, snapshot] = await Promise.all([
        store.getAdminAccount(input.adminUserId),
        source.loadSnapshot(),
      ]);
      if (!target || target.status !== "active")
        return responseError(
          res,
          409,
          "TARGET_NOT_ACTIVE",
          "目标后台账号不存在或未启用"
        );
      const sourceMember =
        snapshot.members.find(
          member => member.memberId === input.sourceMemberId
        ) ?? null;
      const candidate = { ...input, sourceUserId: sourceMember?.userId ?? 0 };
      const validation = validateAccess(
        candidate,
        sourceMember,
        snapshot.teams
      );
      if (!validation.ok)
        return responseError(
          res,
          409,
          "ACCESS_VALIDATION_FAILED",
          "目标来源成员、团队范围或 ERP 权限不满足授权条件"
        );
      const result = await store.grant(input, account.id, sourceMember!.userId);
      if (result === "conflict")
        return responseError(
          res,
          409,
          "ACCESS_REVISION_CONFLICT",
          "授权已被其他操作更新或来源成员已绑定"
        );
      return res
        .status(result === "created" ? 201 : 200)
        .json({
          ok: true,
          action: result,
          revision: input.expectedRevision + 1,
        });
    } catch {
      return responseError(
        res,
        503,
        "ACCESS_UNAVAILABLE",
        "授权服务或来源组织暂不可用"
      );
    }
  });

  app.all(`${ZHIJIE_API_PREFIX}/access`, (_req, res) =>
    responseError(res, 405, "METHOD_NOT_ALLOWED", "仅支持 PUT 授权配置")
  );

  app.get(`${ZHIJIE_API_PREFIX}/records/:module`, async (req, res) => {
    const account = await requireLocalAdmin(req, res, contextFactory);
    if (!account) return;
    const moduleId = req.params.module;
    if (!isZhijieModule(moduleId))
      return responseError(res, 404, "MODULE_NOT_FOUND", "业务模块不存在");
    try {
      const resolved = await resolveAccess(store, source, account.id);
      const sourceMember = resolved.access
        ? (resolved.snapshot.members.find(
            member => member.memberId === resolved.access?.sourceMemberId
          ) ?? null)
        : null;
      if (
        !resolved.valid ||
        !canAccessModule(resolved.access, sourceMember, moduleId, "read")
      ) {
        return responseError(
          res,
          403,
          "BUSINESS_ACCESS_FORBIDDEN",
          "未获得该业务模块查看权限"
        );
      }
      // There is intentionally no business source query here.  `total: null`
      // distinguishes disconnected from a real empty result set.
      return res.json({
        moduleId,
        connected: false,
        items: [],
        total: null,
        message: "功能已建立，智捷业务数据尚未接入。",
      });
    } catch {
      return responseError(
        res,
        503,
        "SOURCE_UNAVAILABLE",
        "来源组织暂不可用，已拒绝业务访问"
      );
    }
  });

  app.all(`${ZHIJIE_API_PREFIX}/records/:module`, (_req, res) =>
    responseError(
      res,
      405,
      "BUSINESS_WRITE_DISABLED",
      "业务数据尚未接入，写操作未启用"
    )
  );

  app.get(`${ZHIJIE_API_PREFIX}/audit`, async (req, res) => {
    const account = await requireLocalAdmin(req, res, contextFactory);
    if (!account) return;
    // Initial release intentionally restricts audit scope to local super admins
    // rather than treating a business grant as an audit privilege.
    if (!isSuperAdmin(account))
      return responseError(
        res,
        403,
        "AUDIT_FORBIDDEN",
        "当前阶段仅超级管理员可查看授权审计"
      );
    const requested = Number(req.query.limit ?? 50);
    const limit = Number.isFinite(requested)
      ? Math.max(1, Math.min(100, Math.floor(requested)))
      : 50;
    try {
      return res.json({ items: await store.listAudits(limit) });
    } catch {
      return responseError(res, 503, "AUDIT_UNAVAILABLE", "授权审计暂不可用");
    }
  });

  return app;
}
