import { afterEach, describe, expect, it, vi } from "vitest";
import { withBusinessAuthorizationFence } from "./businessAuthorizationFence";
import { adminNewInformationFenceDiagnostics, runAdminNewInformationDiagnostic, withAdminNewInformationDiagnosticSink } from "./services/adminNewInformationDiagnostics";
const mock = vi.hoisted(() => ({ connect: vi.fn() }));
vi.mock("mysql2/promise", () => ({ default: { createConnection: mock.connect } }));
const CANARY = "FENCE_PII_CANARY_SQL_PASSWORD";
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });
function connection(errors: { release?: unknown; end?: unknown } = {}) {
  const order: string[] = [];
  const query = vi.fn(async (options: any, params: any[]) => {
    if (options.sql.includes("GET_LOCK")) { order.push(`lock:${params[0]}`); return [[{ acquired: 1 }]]; }
    order.push(`release:${params[0]}`); if (errors.release) throw errors.release; return [[{ released: 1 }]];
  });
  const end = vi.fn(async () => { order.push("end"); if (errors.end) throw errors.end; });
  mock.connect.mockResolvedValue({ query, end }); vi.stubEnv("DATABASE_URL", "mysql://synthetic/mock");
  return { order, query, end };
}
function run(operation: () => Promise<unknown>, records: any[]) {
  return withAdminNewInformationDiagnosticSink(r => records.push(r), () => runAdminNewInformationDiagnostic("inspect", "sales", () => withBusinessAuthorizationFence({ adminUserId: 7, merchantId: 11 }, operation, adminNewInformationFenceDiagnostics)));
}
describe("source fence diagnostic hooks do not change original lock/cleanup precedence", () => {
  it("operation error wins over unlock/end errors; reverse release/end/lease semantics retained", async () => {
    const operationError = Object.assign(Error(CANARY), { code: "ER_LOCK_DEADLOCK", errno: 1213, sqlState: "40001" });
    const releaseError = Object.assign(Error(CANARY), { code: "ECONNRESET" });
    const closeError = Object.assign(Error(CANARY), { code: "EPIPE" });
    const f = connection({ release: releaseError, end: closeError }); const records: any[] = [];
    await expect(run(async () => { f.order.push("operation"); throw operationError; }, records)).rejects.toBe(operationError);
    expect(f.order).toEqual(["lock:business-auth:admin:7", "lock:business-auth:scope:7:11", "operation", "release:business-auth:scope:7:11", "release:business-auth:admin:7", "end"]);
    expect(records.filter(r => r.phase === "cleanupUnlock" && r.outcome === "error")).toHaveLength(2);
    expect(records.some(r => r.phase === "cleanupEnd" && r.outcome === "error")).toBe(true);
    expect(records.some(r => r.phase === "operation" && r.error?.mysqlCode === "ER_LOCK_DEADLOCK")).toBe(true);
    expect(JSON.stringify(records)).not.toContain(CANARY); expect(JSON.stringify(records)).not.toContain("business-auth:admin:7");
  });
  it("successful operation keeps the first cleanup error and still closes the connection", async () => {
    const first = Object.assign(Error(CANARY), { code: "ECONNRESET" }); const second = Error(CANARY);
    const f = connection({ release: first, end: second }); const records: any[] = [];
    await expect(run(async () => 42, records)).rejects.toBe(first); expect(f.end).toHaveBeenCalledTimes(1);
  });
  it("lease is released after every failure; later operations still work without a second pool", async () => {
    for (let i = 0; i < 12; i++) {
      connection(); await expect(withBusinessAuthorizationFence({ adminUserId: 7 }, async () => { throw Error(CANARY); })).rejects.toThrow(CANARY);
    }
    connection(); expect(await withBusinessAuthorizationFence({ adminUserId: 7 }, async () => 42)).toBe(42);
  });
  it("closed fixed fence errors never rely on arbitrary message parsing", async () => {
    delete process.env.DATABASE_URL; const records: any[] = [];
    await expect(run(async () => 42, records)).rejects.toThrow("BUSINESS_AUTHORIZATION_FENCE_DATABASE_UNAVAILABLE");
    expect(records.some(r => r.error?.fenceClass === "DATABASE_UNAVAILABLE")).toBe(true); expect(mock.connect).not.toHaveBeenCalled();
  });
});
