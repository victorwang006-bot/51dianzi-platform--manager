export type BusinessNavigationPayload = {
  workbenchCapabilities: readonly string[];
};

export type BusinessNavigationDisplayState =
  | { status: "loading"; workbenchCapabilities: readonly string[] }
  | { status: "error"; workbenchCapabilities: readonly string[] }
  | { status: "empty"; workbenchCapabilities: readonly string[] }
  | { status: "ready"; workbenchCapabilities: readonly string[] };

type BusinessNavigationQuerySnapshot = {
  enabled: boolean;
  isPending: boolean;
  isSuccess: boolean;
  isError: boolean;
  data: BusinessNavigationPayload | undefined;
};

type TrpcErrorData = {
  code?: string;
  httpStatus?: number;
};

type TrpcLikeError = {
  data?: TrpcErrorData;
  name?: string;
  message?: string;
};

const EMPTY_CAPABILITIES: readonly string[] = [];

/**
 * Keeps cached business-navigation data scoped to one authenticated admin.
 * There is deliberately no shared "unknown admin" key: a signed-out state
 * must never inherit a prior account's capabilities.
 */
export function getBusinessNavigationQueryKey(
  accountId: string | number | null | undefined,
) {
  return ["business", "navigation", accountId ?? "signed-out"] as const;
}

/**
 * Only a successful response for the current account is allowed to expose a
 * business workbench link. In particular, React Query may retain previous
 * data on an error, so error is checked before data on purpose.
 */
export function getBusinessNavigationDisplayState(
  snapshot: BusinessNavigationQuerySnapshot,
): BusinessNavigationDisplayState {
  if (!snapshot.enabled || snapshot.isPending) {
    return { status: "loading", workbenchCapabilities: EMPTY_CAPABILITIES };
  }

  if (snapshot.isError || !snapshot.isSuccess) {
    return { status: "error", workbenchCapabilities: EMPTY_CAPABILITIES };
  }

  const capabilities = snapshot.data?.workbenchCapabilities;
  if (!Array.isArray(capabilities)) {
    return { status: "error", workbenchCapabilities: EMPTY_CAPABILITIES };
  }

  if (capabilities.length === 0) {
    return { status: "empty", workbenchCapabilities: EMPTY_CAPABILITIES };
  }

  return { status: "ready", workbenchCapabilities: capabilities };
}

const NON_RETRYABLE_NAVIGATION_CODES = new Set([
  "UNAUTHORIZED",
  "FORBIDDEN",
  "BAD_REQUEST",
  "NOT_FOUND",
  "METHOD_NOT_SUPPORTED",
  "PRECONDITION_FAILED",
  "CONFLICT",
  "UNPROCESSABLE_CONTENT",
  "TOO_MANY_REQUESTS",
]);

function trpcErrorData(error: unknown): TrpcErrorData | undefined {
  if (typeof error !== "object" || error === null || !("data" in error)) {
    return undefined;
  }

  const data = (error as TrpcLikeError).data;
  return typeof data === "object" && data !== null ? data : undefined;
}

function isNetworkOrTimeoutError(error: unknown): boolean {
  if (error instanceof TypeError) return true;
  if (typeof error !== "object" || error === null) return false;

  const { name, message } = error as TrpcLikeError;
  return name === "AbortError" || /(?:network|fetch|timeout|timed out)/i.test(message ?? "");
}

/**
 * React Query calls this after a failed attempt. A failureCount below two
 * therefore permits at most two retries after the initial request. Explicit
 * authentication, authorization, and business-domain refusals are terminal.
 */
export function shouldRetryBusinessNavigation(
  failureCount: number,
  error: unknown,
): boolean {
  if (failureCount >= 2) return false;

  const data = trpcErrorData(error);
  if (data?.code && NON_RETRYABLE_NAVIGATION_CODES.has(data.code)) {
    return false;
  }

  return (
    data?.code === "SERVICE_UNAVAILABLE" ||
    data?.code === "TIMEOUT" ||
    data?.httpStatus === 503 ||
    data?.httpStatus === 504 ||
    isNetworkOrTimeoutError(error)
  );
}
