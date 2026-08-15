const DEFAULT_AUTH_LOG_WINDOW_MS = 60_000;
const MAX_AUTH_LOG_KEYS = 100;

type AuthLogState = {
  lastLoggedAt: number;
  suppressed: number;
};

const authLogStates = new Map<string, AuthLogState>();

function pruneOldStates(now: number, windowMs: number) {
  if (authLogStates.size < MAX_AUTH_LOG_KEYS) return;

  authLogStates.forEach((state, key) => {
    if (now - state.lastLoggedAt >= windowMs * 2) {
      authLogStates.delete(key);
    }
  });
}

export function getAuthErrorReason(error: unknown): string {
  if (error && typeof error === "object") {
    const code =
      "code" in error ? (error as { code?: unknown }).code : undefined;
    if (typeof code === "string" && code.length > 0) return code;

    const name =
      "name" in error ? (error as { name?: unknown }).name : undefined;
    if (typeof name === "string" && name.length > 0) return name;
  }

  return "unknown";
}

export function warnAuthRateLimited(
  key: string,
  message: string,
  details: Record<string, unknown> = {},
  options: { now?: number; windowMs?: number } = {}
) {
  const now = options.now ?? Date.now();
  const windowMs = options.windowMs ?? DEFAULT_AUTH_LOG_WINDOW_MS;
  const state = authLogStates.get(key);

  if (state && now - state.lastLoggedAt < windowMs) {
    state.suppressed += 1;
    return;
  }

  const suppressed = state?.suppressed ?? 0;
  const metadata = suppressed > 0 ? { ...details, suppressed } : details;
  console.warn(message, metadata);
  authLogStates.set(key, { lastLoggedAt: now, suppressed: 0 });
  pruneOldStates(now, windowMs);
}

export function resetAuthLogRateLimitForTests() {
  authLogStates.clear();
}
