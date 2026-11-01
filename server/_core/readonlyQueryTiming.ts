import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";

const observedQueries = new Set([
  "auth.me", "business.navigation", "message.unreadCount",
  "moduleNotification.summary", "material.categories",
]);
const safeErrorCodes = new Set([
  "BAD_REQUEST", "UNAUTHORIZED", "FORBIDDEN", "NOT_FOUND", "CONFLICT",
  "PRECONDITION_FAILED", "TOO_MANY_REQUESTS", "TIMEOUT", "SERVICE_UNAVAILABLE",
  "INTERNAL_SERVER_ERROR", "METHOD_NOT_SUPPORTED", "PARSE_ERROR",
]);
const requestCorrelations = new WeakMap<object, string>();

/** Local random correlation only: never derives from cookies, identities or input. */
export function readonlyQueryCorrelation(request: object): string {
  if (!request || (typeof request !== "object" && typeof request !== "function")) return randomUUID();
  const existing = requestCorrelations.get(request);
  if (existing) return existing;
  const id = randomUUID();
  requestCorrelations.set(request, id);
  return id;
}

function errorCode(value: unknown): string {
  const code = value && typeof value === "object" && "code" in value ? value.code : undefined;
  return typeof code === "string" && safeErrorCodes.has(code) ? code : "INTERNAL_SERVER_ERROR";
}

export async function traceReadonlyQuery<T>(options: {
  path: string; type: string; request: object; run: () => Promise<T>;
}): Promise<T> {
  if (options.type !== "query" || !observedQueries.has(options.path)) return options.run();
  const startedAt = performance.now();
  const correlationId = readonlyQueryCorrelation(options.request);
  let resultCode = "SUCCESS";
  try {
    const result = await options.run();
    if (result && typeof result === "object" && "ok" in result && result.ok === false) {
      resultCode = errorCode("error" in result ? result.error : undefined);
    }
    return result;
  } catch (error) {
    resultCode = errorCode(error);
    throw error;
  } finally {
    try {
      console.info("[admin] readonly query timing", {
        correlationId, procedure: options.path, resultCode,
        durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
      });
    } catch {
      // Logging must not change query results, authentication or authorization.
    }
  }
}
