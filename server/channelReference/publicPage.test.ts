import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ options: [] as any[], status: 200, text: "User-agent: *\nAllow: /", hang: false, error: false, destroyed: 0, dns: vi.fn(), permit: vi.fn() }));
vi.mock("node:dns/promises", () => ({ lookup: state.dns }));
vi.mock("./requestPacing", () => ({ waitReferenceRequestPermit: state.permit }));
vi.mock("node:https", async () => {
  const { EventEmitter } = await import("node:events");
  return { request: (options: any, callback: (response: any) => void) => {
    state.options.push(options);
    const client = new EventEmitter() as any;
    client.destroy = () => { state.destroyed++; };
    client.end = () => { queueMicrotask(() => {
      if (state.error) { client.emit("error", new Error("TLS certificate rejected")); return; }
      if (state.hang) return;
      const response = new EventEmitter() as any; response.statusCode = state.status;
      callback(response);
      if (state.status === 200) { response.emit("data", Buffer.from(state.text)); response.emit("end"); }
    }); };
    return client;
  } };
});

beforeEach(() => {
  vi.resetModules(); state.options.length = 0; state.status = 200; state.text = "User-agent: *\nAllow: /";
  state.hang = false; state.error = false; state.destroyed = 0;
  state.dns.mockReset().mockResolvedValue([{ address: "8.8.8.8", family: 4 }]); state.permit.mockReset().mockResolvedValue(undefined);
});
afterEach(() => { vi.useRealTimers(); });

describe("robots pinned HTTPS transport: no real network", () => {
  it("uses checked IPv4 as connection destination and original hostname for SNI, Host and TLS", async () => {
    const { assertReferenceRobots } = await import("./publicPage");
    await assertReferenceRobots("ickey", "https://search.ickey.cn/?keyword=P-1");
    expect(state.dns).toHaveBeenCalledTimes(1);
    expect(state.options).toHaveLength(1);
    expect(state.options[0]).toMatchObject({ protocol: "https:", hostname: "8.8.8.8", port: 443, servername: "search.ickey.cn", rejectUnauthorized: true, agent: false, method: "GET", path: "/robots.txt", headers: { Host: "search.ickey.cn" } });
    expect(state.options[0].lookup).toBeUndefined();
    expect(state.permit).toHaveBeenCalledTimes(1);
    expect(state.destroyed).toBe(1);
  });
  it.each(["10.0.0.1", "127.0.0.1", "169.254.169.254", "::1"])("never opens a connection to %s", async ip => {
    const { readPinnedReferenceRobots } = await import("./publicPage");
    await expect(readPinnedReferenceRobots("search.ickey.cn", ip)).rejects.toThrow("Unsupported robots destination");
    expect(state.options).toHaveLength(0);
  });
  it("rejects unknown host before connection", async () => {
    const { readPinnedReferenceRobots } = await import("./publicPage");
    await expect(readPinnedReferenceRobots("evil.example", "8.8.8.8")).rejects.toThrow(); expect(state.options).toHaveLength(0);
  });
  it("does not follow redirects or accept restricted responses", async () => {
    const { assertReferenceRobots } = await import("./publicPage"); state.status = 302;
    await expect(assertReferenceRobots("lcsc", "https://so.szlcsc.com/global.html?k=P")).rejects.toThrow("Robots unavailable"); expect(state.options).toHaveLength(1);
  });
  it.each([404, 410])("permits missing robots %i while closing its response", async status => {
    const { assertReferenceRobots } = await import("./publicPage"); state.status = status;
    await expect(assertReferenceRobots("ickey", "https://search.ickey.cn/?keyword=P")).resolves.toBeUndefined(); expect(state.destroyed).toBe(1);
  });
  it("retains byte bound and destroys oversized transport", async () => {
    const { readPinnedReferenceRobots } = await import("./publicPage"); state.text = "x".repeat(64_001);
    await expect(readPinnedReferenceRobots("search.ickey.cn", "8.8.8.8")).rejects.toThrow("Robots too large"); expect(state.destroyed).toBe(1);
  });
  it("propagates certificate rejection without weakening TLS", async () => {
    const { readPinnedReferenceRobots } = await import("./publicPage"); state.error = true;
    await expect(readPinnedReferenceRobots("search.ickey.cn", "8.8.8.8")).rejects.toThrow("TLS certificate rejected"); expect(state.options[0].rejectUnauthorized).toBe(true);
  });
  it("retains hard eight-second timeout", async () => {
    vi.useFakeTimers(); state.hang = true;
    const { readPinnedReferenceRobots } = await import("./publicPage");
    const pending = expect(readPinnedReferenceRobots("search.ickey.cn", "8.8.8.8")).rejects.toThrow("Robots timeout");
    await vi.advanceTimersByTimeAsync(8_000); await pending; expect(state.destroyed).toBe(1);
  });
  it("respects disallow and shared permit before pinned connection", async () => {
    const { assertReferenceRobots } = await import("./publicPage"); state.text = "User-agent: *\nDisallow: /";
    await expect(assertReferenceRobots("ickey", "https://search.ickey.cn/?keyword=P")).rejects.toThrow("Robots disallow"); expect(state.permit).toHaveBeenCalledTimes(1);
  });
});
