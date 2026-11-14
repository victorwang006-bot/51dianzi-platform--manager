import { beforeEach, describe, expect, it, vi } from "vitest";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import type { SQLWrapper } from "drizzle-orm";
import type { AdminUser } from "../drizzle/schema";
const native = vi.hoisted(() => ({
  updateAdminUser: vi.fn(),
  binding: vi.fn(),
  scopes: vi.fn(),
  forward: vi.fn(),
}));
vi.mock("./businessRouter", () => ({
  readBusinessPersonalPerformance: native.forward,
}));
vi.mock("./db", () => ({
  getDb: vi.fn(async () => null),
  updateAdminUser: native.updateAdminUser,
  getActiveBusinessStaffBinding: native.binding,
  listActiveBusinessMerchantScopes: native.scopes,
}));
import {
  createPersonalCenterService,
  getPersonalPerformance,
  normalizePersonalPhone,
  type PersonalCenterDependencies,
} from "./personalCenterService";
const dialect = new MySqlDialect();
const session = {
  id: 998821,
  userId: 998899,
  username: "fictional_personal",
  displayName: "虚构本人",
  adminRole: "finance",
  status: "active",
  passwordHash: "hash:old-fictional-password",
  sessionVersion: 8,
  phone: null,
  email: null,
} as unknown as AdminUser;
type Ticket = {
  id: number;
  target: string;
  codeHash: string;
  attempts: number;
  used: boolean;
  valid: number;
};
class Memory {
  account = { ...session };
  archived = false;
  tickets: Ticket[] = [];
  calls: { sql: string; params: unknown[] }[] = [];
  others: { id: number; phone: string | null }[] = [];
  recent = false;
  casFail = false;
  private queue = Promise.resolve();
  async transaction<T>(run: (db: Memory) => Promise<T>) {
    const old = this.queue;
    let release!: () => void;
    this.queue = new Promise<void>(resolve => {
      release = resolve;
    });
    await old;
    const account = { ...this.account },
      tickets = this.tickets.map(ticket => ({ ...ticket }));
    try {
      return await run(this);
    } catch (error) {
      this.account = account;
      this.tickets = tickets;
      throw error;
    } finally {
      release();
    }
  }
  async execute(query: SQLWrapper): Promise<unknown> {
    const { sql: text, params } = dialect.sqlToQuery(query.getSQL());
    const q = text.replace(/\s+/g, " ").trim();
    this.calls.push({ sql: q, params });
    if (q.startsWith("SELECT a.*")) return [[{ ...this.account }], []];
    if (q.includes("FROM admin_staff_archives"))
      return [this.archived ? [{ id: 998889 }] : [], []];
    if (q.startsWith("SELECT id, attempts"))
      return [
        [
          ...this.tickets
            .filter(t => t.target === "personal-auth:v1")
            .slice(-1),
        ],
        [],
      ];
    if (q.startsWith("INSERT INTO password_reset_codes")) {
      const isAuth = params[1] === "personal-auth:v1";
      const ticket = {
        id: this.tickets.length + 1,
        target: String(params[1]),
        codeHash: String(params[2]),
        attempts: 0,
        used: true,
        valid: 1,
      };
      this.tickets.push(ticket);
      return [{ insertId: ticket.id, affectedRows: 1, isAuth }, []];
    }
    if (q.includes("SET attempts = attempts + 1")) {
      const ticket = this.tickets.find(t => t.id === Number(params[0]));
      if (ticket) ticket.attempts += 1;
      return [{ affectedRows: ticket ? 1 : 0 }, []];
    }
    if (q.startsWith("SELECT COUNT(*)"))
      return [
        [
          {
            total: this.tickets.filter(t =>
              t.target.startsWith("personal-phone")
            ).length,
          },
        ],
        [],
      ];
    if (
      q.startsWith("SELECT id FROM password_reset_codes") &&
      q.includes("INTERVAL 60 SECOND")
    )
      return [this.recent ? [{ id: 1 }] : [], []];
    if (q.startsWith("SELECT id FROM password_reset_codes"))
      return [
        [...this.tickets.filter(t => t.target === params[1] && t.used)],
        [],
      ];
    if (q.startsWith("SELECT id FROM admin_users"))
      return [
        q.includes("TRIM(phone)")
          ? this.others.filter(t => params.includes(t.phone))
          : [],
        [],
      ];
    if (q.startsWith("SELECT id, phone FROM admin_users"))
      return [
        [{ id: this.account.id, phone: this.account.phone }, ...this.others],
        [],
      ];
    if (q.startsWith("SELECT target FROM password_reset_codes"))
      return [
        [
          ...this.tickets
            .filter(t => t.target.startsWith("personal-phone"))
            .slice(-1),
        ],
        [],
      ];
    if (q.startsWith("SELECT id, codeHash"))
      return [
        this.tickets
          .filter(t => t.target === params[1] && !t.used)
          .slice(-1)
          .map(t => ({ ...t })),
        [],
      ];
    if (q.startsWith("UPDATE admin_users")) {
      if (this.casFail) return [{ affectedRows: 0 }, []];
      if (q.includes("SET passwordHash"))
        this.account.passwordHash = String(params[0]);
      if (q.includes("SET phone")) this.account.phone = String(params[0]);
      this.account.sessionVersion += 1;
      return [{ affectedRows: 1 }, []];
    }
    if (q.startsWith("UPDATE password_reset_codes SET target")) {
      const matching = this.tickets.filter(
        t => t.target === params[2] && t.used
      );
      matching.forEach(t => {
        t.target = String(params[0]);
      });
      return [{ affectedRows: matching.length }, []];
    }
    if (q.includes("SET usedAt = NULL")) {
      const ticket = this.tickets.find(t => t.target === params[1]);
      if (ticket) ticket.used = false;
      return [{ affectedRows: ticket ? 1 : 0 }, []];
    }
    if (q.includes("SET usedAt = CURRENT_TIMESTAMP, target")) {
      const ticket = this.tickets.find(t => t.id === Number(params[1]));
      if (ticket) {
        ticket.used = true;
        ticket.target = String(params[0]);
      }
      return [{ affectedRows: ticket ? 1 : 0 }, []];
    }
    if (q.includes("UPDATE password_reset_codes SET usedAt")) {
      this.tickets
        .filter(t => t.target.startsWith("personal-phone:v1:"))
        .forEach(t => {
          t.used = true;
        });
      return [{ affectedRows: 1 }, []];
    }
    throw new Error(`Unhandled fictional SQL: ${q}`);
  }
}
let memory: Memory;
let deps: PersonalCenterDependencies;
let svc: ReturnType<typeof createPersonalCenterService>;
let delivered: { phone: string; code: string };
beforeEach(() => {
  vi.clearAllMocks();
  memory = new Memory();
  deps = {
    database: async () => memory,
    hash: vi.fn(async plain => `hash:${plain}`),
    verify: vi.fn(async (plain, hash) => hash === `hash:${plain}`),
    smsConfigured: () => true,
    send: vi.fn(async (phone, code) => {
      delivered = { phone, code };
      return { ok: true };
    }),
  };
  svc = createPersonalCenterService(deps);
  native.binding.mockResolvedValue({ frontUserId: 997221, bindingVersion: 4 });
  native.scopes.mockResolvedValue([]);
});
describe("personalCenter credential-only service (fictional DB and SMS)", () => {
  it("normalizes mainland phone without accepting arbitrary international targets", () => {
    expect(normalizePersonalPhone(" +8613900000001 ")).toBe("13900000001");
    expect(normalizePersonalPhone("008613900000001")).toBe("13900000001");
    expect(() => normalizePersonalPhone("+14155550000")).toThrow();
  });
  it("returns only本人profile fields and preserves finance role rather than coercing to merchant_mgr", async () => {
    const profile = await svc.profile(session);
    expect(profile).toEqual({
      username: session.username,
      displayName: session.displayName,
      email: "",
      phone: "",
      adminRole: "finance",
      phoneBinding: "legacy_unverified",
    });
    expect(profile).not.toHaveProperty("passwordHash");
    expect(profile).not.toHaveProperty("id");
  });
  it("rejects stale/disabled/archived session before writing", async () => {
    memory.account.sessionVersion++;
    await expect(
      svc.changePassword(session, {
        oldPassword: "old-fictional-password",
        newPassword: "new-fictional-password",
      })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    memory.account = { ...session, status: "disabled" };
    await expect(svc.profile(session)).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    memory.account = { ...session };
    memory.archived = true;
    await expect(svc.profile(session)).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    expect(memory.calls.some(c => c.sql.startsWith("UPDATE admin_users"))).toBe(
      false
    );
  });
  it("commits wrong-password attempt increments then blocks five failures across service instances", async () => {
    for (let i = 0; i < 5; i++)
      await expect(
        createPersonalCenterService(deps).changePassword(session, {
          oldPassword: "wrong",
          newPassword: "new-fictional-password",
        })
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(memory.tickets[0].attempts).toBe(5);
    await expect(
      svc.changePassword(session, {
        oldPassword: "old-fictional-password",
        newPassword: "new-fictional-password",
      })
    ).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
    expect(memory.account.passwordHash).toBe(session.passwordHash);
  });
  it("changes only credential fields with hash+version CAS and revokes old sessions", async () => {
    const result = await svc.changePassword(session, {
      oldPassword: "old-fictional-password",
      newPassword: "new-fictional-password",
    });
    expect(result).toEqual({ success: true, requiresRelogin: true });
    expect(memory.account.sessionVersion).toBe(9);
    const update = memory.calls.find(c =>
      c.sql.startsWith("UPDATE admin_users")
    )!;
    expect(update.sql).toContain("AND passwordHash = ? AND sessionVersion = ?");
    expect(update.sql).toContain("sessionVersion = sessionVersion + 1");
    expect(update.sql).not.toContain("adminRole =");
    expect(update.sql).not.toContain("permissions");
    await expect(
      svc.changePassword(session, {
        oldPassword: "old-fictional-password",
        newPassword: "another-fictional-password",
      })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
  it("rejects same password and a CAS loser without success", async () => {
    await expect(
      svc.changePassword(session, {
        oldPassword: "old-fictional-password",
        newPassword: "old-fictional-password",
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    memory.casFail = true;
    await expect(
      svc.changePassword(session, {
        oldPassword: "old-fictional-password",
        newPassword: "new-fictional-password",
      })
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
  it("never claims SMS success when unconfigured, rejected or provider throws", async () => {
    deps.smsConfigured = () => false;
    await expect(
      svc.requestPhoneCode(session, {
        oldPassword: "old-fictional-password",
        phone: "13900000001",
      })
    ).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
    expect(deps.send).not.toHaveBeenCalled();
    deps.smsConfigured = () => true;
    deps.send = vi.fn(async () => ({ ok: false }));
    await expect(
      svc.requestPhoneCode(session, {
        oldPassword: "old-fictional-password",
        phone: "13900000001",
      })
    ).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
    expect(
      memory.tickets
        .filter(t => t.target.startsWith("personal-phone"))
        .every(t => t.used)
    ).toBe(true);
    deps.send = vi.fn(async () => {
      throw new Error("fictional provider secret");
    });
    await expect(
      svc.requestPhoneCode(session, {
        oldPassword: "old-fictional-password",
        phone: "13900000001",
      })
    ).rejects.not.toThrow("fictional provider secret");
  });
  it("checks phone conflict and DB send cooldown before invoking SMS", async () => {
    memory.others = [{ id: 998825, phone: "+8613900000001" }];
    await expect(
      svc.requestPhoneCode(session, {
        oldPassword: "old-fictional-password",
        phone: "13900000001",
      })
    ).rejects.toMatchObject({ code: "CONFLICT" });
    memory.others = [];
    memory.recent = true;
    await expect(
      svc.requestPhoneCode(session, {
        oldPassword: "old-fictional-password",
        phone: "13900000001",
      })
    ).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
    expect(deps.send).not.toHaveBeenCalled();
  });
  it("purpose-binds the code, consumes once, checks original phone hash, then gives a verified receipt", async () => {
    const issued = await svc.requestPhoneCode(session, {
      oldPassword: "old-fictional-password",
      phone: "+8613900000001",
    });
    const ticket = memory.tickets.find(t =>
      t.target.startsWith("personal-phone:v1:")
    )!;
    expect(ticket.codeHash).toBe(`hash:${issued.ticketId}:${delivered.code}`);
    expect(ticket.codeHash).not.toBe(`hash:${delivered.code}`);
    expect(ticket.used).toBe(false);
    const result = await svc.bindPhone(session, {
      oldPassword: "old-fictional-password",
      phone: "13900000001",
      ticketId: issued.ticketId,
      code: delivered.code,
    });
    expect(result).toEqual({
      success: true,
      phone: "13900000001",
      requiresRelogin: true,
    });
    expect(ticket.used).toBe(true);
    expect(memory.account.sessionVersion).toBe(9);
    expect((await svc.profile(memory.account)).phoneBinding).toBe(
      "verified_by_current_ticket"
    );
    await expect(
      svc.bindPhone(session, {
        oldPassword: "old-fictional-password",
        phone: "13900000001",
        ticketId: issued.ticketId,
        code: delivered.code,
      })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    const update = memory.calls.find(c =>
      c.sql.includes("UPDATE admin_users SET phone")
    )!;
    expect(update.sql).toContain("phone <=> ?");
    expect(update.params).toContain(session.sessionVersion);
  });
  it("allows only one concurrent old-password update and one concurrent phone-ticket consume", async () => {
    const passwords = await Promise.allSettled([
      svc.changePassword(session, {
        oldPassword: "old-fictional-password",
        newPassword: "first-fictional-password",
      }),
      svc.changePassword(session, {
        oldPassword: "old-fictional-password",
        newPassword: "second-fictional-password",
      }),
    ]);
    expect(
      passwords.filter(result => result.status === "fulfilled")
    ).toHaveLength(1);
    expect(memory.account.sessionVersion).toBe(9);
    memory = new Memory();
    const issued = await svc.requestPhoneCode(session, {
      oldPassword: "old-fictional-password",
      phone: "13900000001",
    });
    const input = {
      oldPassword: "old-fictional-password",
      phone: "13900000001",
      ticketId: issued.ticketId,
      code: delivered.code,
    };
    const binds = await Promise.allSettled([
      svc.bindPhone(session, input),
      svc.bindPhone(session, input),
    ]);
    expect(binds.filter(result => result.status === "fulfilled")).toHaveLength(
      1
    );
    expect(memory.account.sessionVersion).toBe(9);
  });
  it("rejects expired and wrong-ticket codes, and daily send cap cannot be reset by consumed tickets", async () => {
    const issued = await svc.requestPhoneCode(session, {
      oldPassword: "old-fictional-password",
      phone: "13900000001",
    });
    const ticket = memory.tickets.find(t =>
      t.target.startsWith("personal-phone:v1:")
    )!;
    ticket.valid = 0;
    await expect(
      svc.bindPhone(session, {
        oldPassword: "old-fictional-password",
        phone: "13900000001",
        ticketId: issued.ticketId,
        code: delivered.code,
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    ticket.valid = 1;
    await expect(
      svc.bindPhone(session, {
        oldPassword: "old-fictional-password",
        phone: "13900000001",
        ticketId: "123e4567-e89b-42d3-a456-426614174000",
        code: delivered.code,
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    for (let i = 0; i < 9; i++)
      memory.tickets.push({
        id: 100 + i,
        target: `personal-phone-verified:v1:fictional:${i}`,
        codeHash: "fictional",
        attempts: 0,
        used: true,
        valid: 0,
      });
    (deps.send as ReturnType<typeof vi.fn>).mockClear();
    await expect(
      svc.requestPhoneCode(session, {
        oldPassword: "old-fictional-password",
        phone: "13900000002",
      })
    ).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
    expect(deps.send).not.toHaveBeenCalled();
  });
  it("persists incorrect code attempts and blocks at five without updating phone", async () => {
    const issued = await svc.requestPhoneCode(session, {
      oldPassword: "old-fictional-password",
      phone: "13900000001",
    });
    for (let i = 0; i < 4; i++)
      await expect(
        svc.bindPhone(session, {
          oldPassword: "old-fictional-password",
          phone: "13900000001",
          ticketId: issued.ticketId,
          code: "bad-code",
        })
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      svc.bindPhone(session, {
        oldPassword: "old-fictional-password",
        phone: "13900000001",
        ticketId: issued.ticketId,
        code: "bad-code",
      })
    ).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
    await expect(
      svc.bindPhone(session, {
        oldPassword: "old-fictional-password",
        phone: "13900000001",
        ticketId: issued.ticketId,
        code: delivered.code,
      })
    ).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
    expect(memory.account.phone).toBeNull();
  });
  it("rejects ticket after original binding changes and rechecks newly occupied phone at consume", async () => {
    const issued = await svc.requestPhoneCode(session, {
      oldPassword: "old-fictional-password",
      phone: "13900000001",
    });
    memory.account.phone = "13900000002";
    await expect(
      svc.bindPhone(session, {
        oldPassword: "old-fictional-password",
        phone: "13900000001",
        ticketId: issued.ticketId,
        code: delivered.code,
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    memory.account.phone = null;
    memory.others = [{ id: 998826, phone: "008613900000001" }];
    await expect(
      svc.bindPhone(session, {
        oldPassword: "old-fictional-password",
        phone: "13900000001",
        ticketId: issued.ticketId,
        code: delivered.code,
      })
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(memory.account.phone).toBeNull();
  });
  it("allows legacy same-phone SMS proof, rejects bad code without claiming verified, then consumes exactly once", async () => {
    memory.account.phone = "+8613900000001";
    expect((await svc.profile(session)).phoneBinding).toBe("legacy_unverified");
    const issued = await svc.requestPhoneCode(session, {
      oldPassword: "old-fictional-password",
      phone: "13900000001",
    });
    expect(deps.send).toHaveBeenCalledTimes(1);
    const input = {
      oldPassword: "old-fictional-password",
      phone: "13900000001",
      ticketId: issued.ticketId,
      code: "wrong",
    };
    await expect(svc.bindPhone(session, input)).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    expect(memory.account.phone).toBe("+8613900000001");
    expect(memory.account.sessionVersion).toBe(session.sessionVersion);
    expect((await svc.profile(session)).phoneBinding).toBe("legacy_unverified");
    await expect(
      svc.bindPhone(session, { ...input, code: delivered.code })
    ).resolves.toMatchObject({ requiresRelogin: true });
    const freshSession = { ...memory.account };
    expect((await svc.profile(freshSession)).phoneBinding).toBe(
      "verified_by_current_ticket"
    );
    await expect(
      svc.bindPhone(freshSession, { ...input, code: delivered.code })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      svc.requestPhoneCode(freshSession, {
        oldPassword: "old-fictional-password",
        phone: "008613900000001",
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(deps.send).toHaveBeenCalledTimes(1);
  });
  it("does not turn legacy, unused, wrong-phone or stale-version receipts into verified after password change", async () => {
    memory.account.phone = "13900000001";
    memory.tickets = [
      {
        id: 1,
        target: "personal-phone-verified:v1:13900000001:7",
        used: true,
        codeHash: "fictional",
        attempts: 0,
        valid: 0,
      },
      {
        id: 2,
        target: "personal-phone-verified:v1:13900000002:8",
        used: true,
        codeHash: "fictional",
        attempts: 0,
        valid: 0,
      },
      {
        id: 3,
        target: "personal-phone-verified:v1:13900000001:8",
        used: false,
        codeHash: "fictional",
        attempts: 0,
        valid: 0,
      },
    ];
    const before = memory.tickets.map(t => ({ ...t }));
    await svc.changePassword(session, {
      oldPassword: "old-fictional-password",
      newPassword: "new-fictional-password",
    });
    expect(memory.tickets.slice(0, 3)).toEqual(before);
    expect((await svc.profile(memory.account)).phoneBinding).toBe(
      "legacy_unverified"
    );
  });
  it("migrates only the legitimate current phone receipt atomically across password session revocation", async () => {
    const issued = await svc.requestPhoneCode(session, {
      oldPassword: "old-fictional-password",
      phone: "13900000001",
    });
    await svc.bindPhone(session, {
      oldPassword: "old-fictional-password",
      phone: "13900000001",
      ticketId: issued.ticketId,
      code: delivered.code,
    });
    const freshSession = { ...memory.account };
    const receipt = memory.tickets.find(
      t => t.target === "personal-phone-verified:v1:13900000001:9"
    )!;
    await svc.changePassword(freshSession, {
      oldPassword: "old-fictional-password",
      newPassword: "new-fictional-password",
    });
    expect(receipt.target).toBe("personal-phone-verified:v1:13900000001:10");
    expect(receipt.used).toBe(true);
    expect((await svc.profile(memory.account)).phoneBinding).toBe(
      "verified_by_current_ticket"
    );
    const migration = memory.calls.find(c =>
      c.sql.startsWith("UPDATE password_reset_codes SET target")
    )!;
    expect(migration.sql).toContain("usedAt IS NOT NULL");
    expect(migration.params).toEqual([
      "personal-phone-verified:v1:13900000001:10",
      session.id,
      "personal-phone-verified:v1:13900000001:9",
    ]);
  });
  it("CAS loser never migrates an existing receipt or grants phone verification", async () => {
    memory.account.phone = "13900000001";
    memory.tickets = [
      {
        id: 1,
        target: "personal-phone-verified:v1:13900000001:8",
        used: true,
        codeHash: "fictional",
        attempts: 0,
        valid: 0,
      },
    ];
    memory.casFail = true;
    await expect(
      svc.changePassword(session, {
        oldPassword: "old-fictional-password",
        newPassword: "new-fictional-password",
      })
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(memory.tickets[0].target).toBe(
      "personal-phone-verified:v1:13900000001:8"
    );
    expect(
      memory.calls.some(c =>
        c.sql.startsWith("UPDATE password_reset_codes SET target")
      )
    ).toBe(false);
  });
  it("no binding/permitted scope produces unavailable, not fake zero performance", async () => {
    native.binding.mockResolvedValue(null);
    const ctx = { user: { role: "admin" }, adminAccount: session } as any;
    const value = await getPersonalPerformance(ctx, { month: "2026-11" });
    expect(value.status).toBe("unavailable");
    expect(value).not.toHaveProperty("orderCount");
    expect(native.forward).not.toHaveBeenCalled();
  });
});
