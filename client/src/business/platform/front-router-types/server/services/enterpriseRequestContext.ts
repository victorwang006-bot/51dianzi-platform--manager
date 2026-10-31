import { AsyncLocalStorage } from "node:async_hooks";
import { TRPCError } from "@trpc/server";

/** Per-request routing hints. They are never authorization and never impersonate a user. */
export type EnterpriseRequestContext = Readonly<{
  enterpriseId: number | null;
  applicationId: string | null;
  newApplication: boolean;
  actorUserId: number | null;
}>;

const storage = new AsyncLocalStorage<EnterpriseRequestContext>();

export function getEnterpriseRequestContext(): EnterpriseRequestContext | undefined {
  return storage.getStore();
}

export function getRequestedEnterpriseId(): number | null {
  return storage.getStore()?.enterpriseId ?? null;
}

/** Prevent a separately supplied actor from inheriting a browser/internal caller's selected tenant. */
export function getEnterpriseRequestContextForActor(actorUserId: number): EnterpriseRequestContext | undefined {
  const context = storage.getStore();
  return context?.actorUserId === actorUserId ? context : undefined;
}

/** Existing-business procedures may not use a new-application context as a tenant shortcut. */
export function getEnterpriseBusinessRequestContext(actorUserId: number) {
  const context = getEnterpriseRequestContextForActor(actorUserId);
  if (context && (context.newApplication || context.applicationId)) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "新企业申请不能访问现有企业经营数据" });
  }
  return context;
}

export function enterpriseSelectionRequiredError() {
  return new TRPCError({ code: "PRECONDITION_FAILED", message: "您管理多家企业，请先选择企业" });
}

export function runWithEnterpriseRequestContext<T>(scope: EnterpriseRequestContext, action: () => T): T {
  return storage.run(Object.freeze({ ...scope }), action);
}

/** Browser header parsing; internal BFF delegation deliberately bypasses this parser. */
export function parseEnterpriseRequestHeaders(headers: Record<string, unknown>): Omit<EnterpriseRequestContext, "actorUserId"> {
  const raw = headers["x-51dianzi-enterprise-id"];
  const application = headers["x-51dianzi-application-id"];
  const newApplication = headers["x-51dianzi-new-enterprise"] === "1";
  let enterpriseId: number | null = null;
  let applicationId: string | null = null;
  if (raw !== undefined && raw !== "") {
    if (typeof raw !== "string" || !/^[1-9]\d*$/.test(raw) || !Number.isSafeInteger(Number(raw))) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "企业上下文无效，请重新选择企业" });
    }
    enterpriseId = Number(raw);
  }
  if (application !== undefined && application !== "") {
    if (typeof application !== "string" || !/^[A-Za-z0-9_-]{16,64}$/.test(application)) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "企业申请上下文无效" });
    }
    applicationId = application;
  }
  if ((newApplication || applicationId) && enterpriseId !== null) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "新企业申请不能携带另一企业的经营上下文" });
  }
  return { enterpriseId, applicationId, newApplication };
}
