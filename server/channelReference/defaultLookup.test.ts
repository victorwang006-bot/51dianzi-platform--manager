import { describe, expect, it, vi } from "vitest";
import { spawn } from "node:child_process";
import { lstat, mkdir, open, rename, writeFile } from "node:fs/promises";
vi.mock("node:child_process", async original => ({ ...await original<typeof import("node:child_process")>(), spawn: vi.fn(() => { throw new Error("External child forbidden"); }) }));
vi.mock("node:fs/promises", async original => {
  const fs = await original<typeof import("node:fs/promises")>();
  return { ...fs, open: vi.fn(fs.open), mkdir: vi.fn(fs.mkdir), rename: vi.fn(fs.rename), writeFile: vi.fn(fs.writeFile), lstat: vi.fn((path: string, ...args: unknown[]) => {
    // Force only the fixed config to be absent, independent of test-runner ENV
    // or a parent's provisioning. Do not mutate any process environment values.
    if (path === "/var/lib/51dianzi") return Promise.reject(Object.assign(new Error("Absent test config"), { code: "ENOENT" }));
    return (fs.lstat as Function)(path, ...args);
  }) };
});

describe("actual lookupChannelReferences safe defaults", () => {
  it("imports without FS/children/network/env effects; ordinary/default and disabled true never fetch or write", async () => {
    const envBefore = { ...process.env };
    const fetch = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("External HTTP forbidden"));
    try {
      const { lookupChannelReferences } = await import("./service");
      expect(open).not.toHaveBeenCalled(); expect(lstat).not.toHaveBeenCalled();
      expect(mkdir).not.toHaveBeenCalled(); expect(writeFile).not.toHaveBeenCalled(); expect(rename).not.toHaveBeenCalled();
      expect(spawn).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled(); expect(process.env).toEqual(envBefore);
      const material = { materialId: 1, partNumber: "STE145N65M5", brand: "ST", actorUserId: 777, customerId: 888 };
      const first = await lookupChannelReferences([material]);
      expect(first.items[0]).not.toHaveProperty("actorUserId"); expect(first.items[0]).not.toHaveProperty("customerId");
      await lookupChannelReferences([material], { refresh: false });
      const refresh = await lookupChannelReferences([material], { refresh: true });
      expect(refresh.items).toEqual(first.items);
      expect(refresh.refreshDiagnostics?.every(d => ["disabled", "idle"].includes(d.state))).toBe(true);
      const missing = await lookupChannelReferences([{ materialId: 2, partNumber: "DEFINITELY-NOT-A-PRODUCT-123", brand: "ST" }]);
      expect(missing.items[0].references.lcsc.status).toBe("not_found");
      expect(spawn).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
      expect(mkdir).not.toHaveBeenCalled(); expect(writeFile).not.toHaveBeenCalled(); expect(rename).not.toHaveBeenCalled();
      expect(process.env).toEqual(envBefore);
    } finally { fetch.mockRestore(); }
  });
});
