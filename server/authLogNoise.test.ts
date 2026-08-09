import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  resetAuthLogRateLimitForTests,
  warnAuthRateLimited,
} from "./_core/authLog";
import { sdk } from "./_core/sdk";

describe("admin auth log noise control", () => {
  beforeEach(() => {
    resetAuthLogRateLimitForTests();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("treats a missing session as anonymous without warning", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await expect(sdk.verifySession(null)).resolves.toBeNull();

    expect(warn).not.toHaveBeenCalled();
  });

  it("rate limits repeated malformed-session warnings", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await sdk.verifySession("not-a-jwt");
    await sdk.verifySession("not-a-jwt");
    await sdk.verifySession("not-a-jwt");

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      "[Auth] Session verification failed",
      expect.objectContaining({ reason: expect.any(String) })
    );
  });

  it("reports suppressed warning totals after the rate-limit window", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    warnAuthRateLimited(
      "invalid",
      "invalid session",
      {},
      { now: 0, windowMs: 1_000 }
    );
    warnAuthRateLimited(
      "invalid",
      "invalid session",
      {},
      { now: 100, windowMs: 1_000 }
    );
    warnAuthRateLimited(
      "invalid",
      "invalid session",
      {},
      { now: 200, windowMs: 1_000 }
    );
    warnAuthRateLimited(
      "invalid",
      "invalid session",
      {},
      { now: 1_000, windowMs: 1_000 }
    );

    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenLastCalledWith("invalid session", { suppressed: 2 });
  });
});
