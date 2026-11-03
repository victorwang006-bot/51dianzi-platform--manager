import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import mysql, { type Pool, type RowDataPacket } from "mysql2/promise";
import { drizzle } from "drizzle-orm/mysql2";
import { getAdminRolePermissions } from "../../shared/adminPermissions";

const { isolatedDb } = vi.hoisted(() => ({
  isolatedDb: { current: undefined as unknown },
}));
// This is the ONLY mock: the production service receives a real MySQL Drizzle DB.
// No SQL, transactions, officialChannelAccess, live roles or CAS checks are mocked.
vi.mock("../db", () => ({ getDb: async () => isolatedDb.current }));

import {
  getOfficialTeamsOverview,
  setOfficialTeamMember,
  type SetOfficialTeamMemberInput,
} from "./officialTeams";
import { OFFICIAL_INVENTORY_PERMISSIONS } from "./officialChannelAccess";

const OPTED_IN = process.env.V13_NATIVE_PERMISSION_SQL === "1";
const LOCAL_URL =
  "mysql://root@127.0.0.1:33306/test_v13_native_permission_save";
const DATABASE = "test_v13_native_permission_save";
const TABLES = [
  "admin_users",
  "admin_user_permissions",
  "admin_user_permission_audits",
  "official_channel_teams",
  "official_channel_team_members",
  "official_channel_audits",
] as const;
const actor = { adminUserId: 91001, sessionVersion: 5 };
const secondActor = { adminUserId: 91003, sessionVersion: 9 };
const targetId = 92002;
const SUPER_TARGET_ID = 91002;
const OLD_PERMISSIONS = ["materials.read", "orders.read", "profile.manage"];
const sorted = (values: readonly string[]) => [...values].sort();
const allOfficial = sorted(OFFICIAL_INVENTORY_PERMISSIONS);

/**
 * LOCAL SYNTHETIC DDL ONLY. No migration, dump, seed import or production data.
 * Native account dependencies: id/userId/username/usernameCanonical/displayName,
 * adminRole/status/sessionVersion. Remaining native columns mirror schema defaults.
 * Permissions use native unique(adminUserId, permission); membership uses generated
 * leaderTeamId and both native unique constraints. Audits use native JSON fields,
 * actor/target IDs and the actual unique requestId index. All tables are InnoDB.
 */
const LOCAL_DDL = [
  `CREATE TABLE IF NOT EXISTS admin_users (
    id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    userId INT NOT NULL,
    username VARCHAR(64) NOT NULL UNIQUE,
    usernameCanonical VARCHAR(64) NOT NULL,
    displayName VARCHAR(128), email VARCHAR(320), phone VARCHAR(20),
    passwordHash VARCHAR(128),
    adminRole ENUM('super_admin','operation','merchant_mgr','customer_svc','risk_control','finance','auditor') NOT NULL DEFAULT 'operation',
    status ENUM('active','disabled','locked') NOT NULL DEFAULT 'active',
    sessionVersion INT NOT NULL DEFAULT 1,
    mfaEnabled BOOLEAN DEFAULT FALSE,
    lastLoginAt TIMESTAMP NULL, lastLoginIpAddress VARCHAR(64),
    lastLoginIpHash VARCHAR(64), lastLoginLocation VARCHAR(128),
    lastLoginDevice VARCHAR(160), lastLoginDeviceHash VARCHAR(64),
    lastLoginMethod VARCHAR(32), securityRiskLevel VARCHAR(16),
    securityRiskReason VARCHAR(255), securityRiskAt TIMESTAMP NULL,
    createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY admin_users_username_canonical_unique (usernameCanonical)
  ) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS admin_user_permissions (
    id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    adminUserId INT NOT NULL, permission VARCHAR(64) NOT NULL,
    createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY admin_user_permissions_admin_permission_unique (adminUserId, permission),
    KEY admin_user_permissions_admin_user_idx (adminUserId)
  ) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS admin_user_permission_audits (
    id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    adminUserId INT NOT NULL, operatorAdminUserId INT,
    operatorName VARCHAR(128), beforePermissions JSON, afterPermissions JSON,
    ipAddress VARCHAR(64), userAgent VARCHAR(255),
    createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY admin_user_permission_audits_admin_user_idx (adminUserId),
    KEY admin_user_permission_audits_created_at_idx (createdAt)
  ) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS official_channel_teams (
    id INT NOT NULL AUTO_INCREMENT PRIMARY KEY, name VARCHAR(128) NOT NULL,
    status ENUM('active','archived') NOT NULL DEFAULT 'active',
    revision INT UNSIGNED NOT NULL DEFAULT 1, createdByAdminUserId INT NOT NULL,
    createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY official_channel_teams_status_updated_idx (status, updatedAt)
  ) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS official_channel_team_members (
    id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    adminUserId INT NOT NULL, teamId INT NOT NULL,
    role ENUM('member','leader') NOT NULL DEFAULT 'member',
    leaderTeamId INT GENERATED ALWAYS AS (CASE WHEN role = 'leader' THEN teamId ELSE NULL END) STORED,
    revision INT UNSIGNED NOT NULL DEFAULT 1, updatedByAdminUserId INT NOT NULL,
    createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY official_channel_team_members_admin_user_unique (adminUserId),
    UNIQUE KEY official_channel_team_members_leader_team_unique (leaderTeamId),
    KEY official_channel_team_members_team_idx (teamId)
  ) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS official_channel_audits (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY, action VARCHAR(64) NOT NULL,
    targetId VARCHAR(64) NOT NULL, actorAdminUserId INT NOT NULL,
    requestId VARCHAR(64) NOT NULL, payloadHash VARCHAR(64) NOT NULL,
    beforeData JSON, afterData JSON,
    createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY official_channel_audits_request_unique (requestId),
    KEY official_channel_audits_target_created_idx (targetId, createdAt),
    KEY official_channel_audits_actor_created_idx (actorAdminUserId, createdAt)
  ) ENGINE=InnoDB`,
];

function checkedLocalOptions() {
  if (!OPTED_IN) throw new Error("LOCAL_SQL_OPT_IN_REQUIRED");
  if (process.env.DATABASE_URL !== undefined) {
    throw new Error("UNSET_DATABASE_URL_BEFORE_NATIVE_SQL_TEST");
  }
  // No configurable URL and no application env/db import: fail closed before I/O.
  const url = new URL(LOCAL_URL);
  if (
    url.protocol !== "mysql:" ||
    url.hostname !== "127.0.0.1" ||
    url.port !== "33306" ||
    url.username !== "root" ||
    url.password !== "" ||
    url.pathname !== `/${DATABASE}` ||
    !DATABASE.startsWith("test_v13_native_permission_") ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new Error("UNSAFE_NATIVE_SQL_ENDPOINT");
  }
  return {
    host: "127.0.0.1",
    port: 33306,
    user: "root",
    password: "",
    connectTimeout: 5000,
    multipleStatements: false,
  } as const;
}

let pool: Pool | undefined;
const actualQueries: string[] = [];
let concurrencyConnections: number[] = [];

async function rows<T extends RowDataPacket = RowDataPacket>(
  query: string,
  params: unknown[] = []
): Promise<T[]> {
  if (!pool) throw new Error("ISOLATED_POOL_NOT_READY");
  return (await pool.query<T[]>(query, params))[0];
}

function saveInput(
  overrides: Partial<SetOfficialTeamMemberInput> = {}
): SetOfficialTeamMemberInput {
  return {
    adminUserId: targetId,
    teamId: null,
    role: null,
    expectedRevision: 0,
    expectedAccountVersion: 12,
    officialPermissions: ["officialInventory.read"],
    requestId: "v13_native_save_001",
    ...overrides,
  };
}

async function storedPermissions(id = targetId) {
  return (
    await rows(
      "SELECT permission FROM admin_user_permissions WHERE adminUserId = ? ORDER BY permission",
      [id]
    )
  ).map(row => String(row.permission));
}

async function version(id = targetId) {
  return Number(
    (await rows("SELECT sessionVersion FROM admin_users WHERE id = ?", [id]))[0]
      .sessionVersion
  );
}

async function putPermission(permission: string, id = targetId) {
  await pool!.execute(
    "INSERT INTO admin_user_permissions (adminUserId, permission) VALUES (?, ?)",
    [id, permission]
  );
}

/** Exact persistent state, including pre-existing audit JSON and timestamps. */
async function snapshot() {
  return {
    accounts: await rows("SELECT * FROM admin_users ORDER BY id"),
    permissions: await rows("SELECT * FROM admin_user_permissions ORDER BY id"),
    members: await rows(
      "SELECT * FROM official_channel_team_members ORDER BY id"
    ),
    permissionAudits: await rows(
      "SELECT * FROM admin_user_permission_audits ORDER BY id"
    ),
    officialAudits: await rows(
      "SELECT * FROM official_channel_audits ORDER BY id"
    ),
  };
}

async function addMember() {
  await pool!.execute(
    "INSERT INTO official_channel_teams (id, name, createdByAdminUserId) VALUES (99003, 'synthetic-official-team', ?)",
    [actor.adminUserId]
  );
  await pool!.execute(
    "INSERT INTO official_channel_team_members (adminUserId, teamId, role, revision, updatedByAdminUserId) VALUES (?, 99003, 'member', 4, ?)",
    [targetId, actor.adminUserId]
  );
}

// Default test discovery never connects, opens sockets, creates schema or runs DDL.
describe.skipIf(!OPTED_IN)(
  "permission-save-concurrency-sql / native isolated MySQL 8",
  () => {
    beforeAll(async () => {
      const options = checkedLocalOptions();
      const bootstrap = await mysql.createConnection(options);
      try {
        const stream = bootstrap.connection.stream as {
          remoteAddress?: string;
          remotePort?: number;
        };
        expect(stream.remoteAddress).toBe("127.0.0.1");
        expect(stream.remotePort).toBe(33306);
        const [server] = await bootstrap.query<RowDataPacket[]>(
          "SELECT VERSION() AS version, DATABASE() AS db"
        );
        expect(String(server[0].version)).toMatch(/^8\.0\.36(?:$|[-+])/);
        expect(server[0].db).toBeNull();
        await bootstrap.query(
          `CREATE DATABASE IF NOT EXISTS \`${DATABASE}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
        );
        console.info(
          `[native-sql] socket=127.0.0.1:33306 server=${server[0].version} schema=${DATABASE}; synthetic-only; DATABASE_URL unset`
        );
      } finally {
        await bootstrap.end();
      }
      pool = mysql.createPool({
        ...options,
        database: DATABASE,
        connectionLimit: 6,
      });
      const [identity] = await rows(
        "SELECT DATABASE() AS db, @@transaction_isolation AS isolationLevel"
      );
      expect(identity.db).toBe(DATABASE);
      const existing = await rows(
        "SELECT TABLE_NAME AS tableName FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?",
        [DATABASE]
      );
      for (const table of existing) {
        if (!TABLES.includes(table.tableName as (typeof TABLES)[number])) {
          throw new Error(
            `UNEXPECTED_TABLE_IN_SYNTHETIC_SCHEMA:${String(table.tableName)}`
          );
        }
      }
      for (const ddl of LOCAL_DDL) await pool.query(ddl);
      const engines = await rows(
        "SELECT TABLE_NAME AS tableName, ENGINE AS engine FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?",
        [DATABASE]
      );
      expect(engines).toHaveLength(TABLES.length);
      expect(engines.every(table => table.engine === "InnoDB")).toBe(true);
      isolatedDb.current = drizzle(pool, {
        logger: {
          logQuery(query) {
            actualQueries.push(query);
          },
        },
      });
      console.info(
        `[native-sql] DDL=6 local synthetic InnoDB tables; isolation=${identity.isolationLevel}; real mysql2/promise + drizzle(pool); ONLY getDb mocked`
      );
      console.info(
        "[native-sql] fields: admin_users.id/adminRole/status/sessionVersion; admin_user_permissions.adminUserId/permission; official member revision; native permission audit before/after JSON; official audit requestId/payloadHash/beforeData/afterData"
      );
    }, 15000);

    beforeEach(async () => {
      await pool!.query(
        "DROP TRIGGER IF EXISTS v13_native_fail_official_audit"
      );
      await pool!.query(
        "DROP TRIGGER IF EXISTS v13_native_fail_permission_audit"
      );
      for (const table of [...TABLES].reverse()) {
        await pool!.query(`DELETE FROM \`${table}\``);
      }
      const accounts = [
        [
          actor.adminUserId,
          191001,
          "synthetic-v13-super",
          "合成超管",
          "super_admin",
          "active",
          5,
        ],
        [
          secondActor.adminUserId,
          191003,
          "synthetic-v13-super-b",
          "合成超管B",
          "super_admin",
          "active",
          9,
        ],
        [
          SUPER_TARGET_ID,
          191002,
          "synthetic-v13-super-target",
          "合成超管目标",
          "super_admin",
          "active",
          7,
        ],
        [
          targetId,
          192002,
          "synthetic-v13-staff",
          "合成员工",
          "operation",
          "active",
          12,
        ],
      ];
      for (const [
        id,
        userId,
        username,
        displayName,
        role,
        status,
        sessionVersion,
      ] of accounts) {
        await pool!.execute(
          "INSERT INTO admin_users (id, userId, username, usernameCanonical, displayName, adminRole, status, sessionVersion) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
          [
            id,
            userId,
            username,
            username,
            displayName,
            role,
            status,
            sessionVersion,
          ]
        );
      }
      for (const permission of OLD_PERMISSIONS) await putPermission(permission);
    });

    afterAll(async () => {
      if (!pool) return;
      try {
        await pool.query(
          "DROP TRIGGER IF EXISTS v13_native_fail_official_audit"
        );
        await pool.query(
          "DROP TRIGGER IF EXISTS v13_native_fail_permission_audit"
        );
        console.info(
          `[native-sql] executed production Drizzle queries=${actualQueries.length}; FOR UPDATE=${actualQueries.filter(query => /for update/i.test(query)).length}; concurrent SQL connection IDs=${concurrencyConnections.join(",")}`
        );
      } finally {
        isolatedDb.current = undefined;
        await pool.end();
        pool = undefined;
      }
    });

    it("SQL overview reads an ungrouped active account's stored official.read and native accountVersion without fabricating members", async () => {
      await putPermission("officialInventory.read");
      const before = await snapshot();
      const overview = await getOfficialTeamsOverview(actor);
      expect(
        overview.targets.find(target => target.adminUserId === targetId)
      ).toEqual({
        adminUserId: targetId,
        displayName: "合成员工",
        officialPermissions: ["officialInventory.read"],
        accountVersion: 12,
      });
      expect(overview.members).toEqual([]);
      expect(overview.currentAccess.isSuperAdmin).toBe(true);
      expect(await snapshot()).toEqual(before);
    });

    it("SQL grant -> fresh overview round-trip preserves old platform grants, writes both audits, and inserts no official membership", async () => {
      const input = saveInput();
      const saved = await setOfficialTeamMember(actor, input);
      expect(saved).toEqual({
        member: null,
        officialPermissions: ["officialInventory.read"],
        accountVersion: 13,
        revision: 0,
        requestId: input.requestId,
        idempotent: false,
      });
      expect(await version()).toBe(13);
      expect(await storedPermissions()).toEqual(
        sorted([...OLD_PERMISSIONS, "officialInventory.read"])
      );
      expect(await rows("SELECT * FROM official_channel_team_members")).toEqual(
        []
      );
      const overview = await getOfficialTeamsOverview(actor);
      expect(
        overview.targets.find(target => target.adminUserId === targetId)
      ).toMatchObject({
        officialPermissions: saved.officialPermissions,
        accountVersion: saved.accountVersion,
      });
      expect(overview.members).toEqual([]);
      const state = await snapshot();
      expect(state.permissionAudits).toHaveLength(1);
      expect(state.permissionAudits[0]).toMatchObject({
        adminUserId: targetId,
        operatorAdminUserId: actor.adminUserId,
        operatorName: "合成超管",
        beforePermissions: OLD_PERMISSIONS,
      });
      expect(sorted(state.permissionAudits[0].afterPermissions)).toEqual(
        await storedPermissions()
      );
      expect(state.officialAudits).toHaveLength(1);
      expect(state.officialAudits[0].beforeData.accountVersion).toBe(12);
      expect(state.officialAudits[0].afterData).toMatchObject({
        result: saved,
        memberChanged: false,
        permissionChanged: true,
      });
    });

    it("SQL no-explicit-grants legacy account materializes role defaults rather than losing platform access", async () => {
      await pool!.execute(
        "DELETE FROM admin_user_permissions WHERE adminUserId = ?",
        [targetId]
      );
      await setOfficialTeamMember(actor, saveInput());
      expect(await storedPermissions()).toEqual(
        sorted([
          ...getAdminRolePermissions("operation"),
          "officialInventory.read",
        ])
      );
      expect(await rows("SELECT * FROM official_channel_team_members")).toEqual(
        []
      );
    });

    it.each([
      "officialInventory.write",
      "officialInventory.publish",
      "officialInventory.note",
    ] as const)(
      "SQL %s persists its read dependency and returns the same effective overview set",
      async permission => {
        const saved = await setOfficialTeamMember(
          actor,
          saveInput({ officialPermissions: [permission] })
        );
        expect(saved.officialPermissions).toEqual(
          sorted([permission, "officialInventory.read"])
        );
        expect(await storedPermissions()).toEqual(
          sorted([...OLD_PERMISSIONS, permission, "officialInventory.read"])
        );
        const overview = await getOfficialTeamsOverview(actor);
        expect(
          overview.targets.find(target => target.adminUserId === targetId)
            ?.officialPermissions
        ).toEqual(saved.officialPermissions);
      }
    );

    it("SQL two overlapping same-version saves have exactly one winner and one account conflict, without lost updates", async () => {
      // Hold the actor row with a REAL third transaction until both independent save
      // transactions have acquired separate MySQL connections; no fake SQL barrier.
      const blocker = await pool!.getConnection();
      const acquired = new Set<number>();
      let releaseAcquired!: () => void;
      const bothAcquired = new Promise<void>(resolve => {
        releaseAcquired = resolve;
      });
      const onAcquire = (connection: { threadId: number }) => {
        acquired.add(connection.threadId);
        if (acquired.size >= 2) releaseAcquired();
      };
      await blocker.beginTransaction();
      await blocker.execute(
        "SELECT id FROM admin_users WHERE id = ? FOR UPDATE",
        [actor.adminUserId]
      );
      pool!.on("acquire", onAcquire);
      const inputs = [
        saveInput({
          requestId: "v13_native_race_read",
          officialPermissions: ["officialInventory.read"],
        }),
        saveInput({
          requestId: "v13_native_race_note",
          officialPermissions: ["officialInventory.note"],
        }),
      ];
      const pending = inputs.map(input => setOfficialTeamMember(actor, input));
      // Attach rejection handlers immediately, before releasing the database lock.
      const outcomes = Promise.allSettled(pending);
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          bothAcquired,
          new Promise<never>((_, reject) => {
            timer = setTimeout(
              () => reject(new Error("TWO_REAL_SQL_CONNECTIONS_NOT_ACQUIRED")),
              5000
            );
          }),
        ]);
      } finally {
        if (timer) clearTimeout(timer);
        pool!.removeListener("acquire", onAcquire);
        await blocker.commit();
        blocker.release();
      }
      const results = await outcomes;
      concurrencyConnections = [...acquired];
      expect(acquired.size).toBeGreaterThanOrEqual(2);
      const winners = results.filter(result => result.status === "fulfilled");
      const conflicts = results.filter(result => result.status === "rejected");
      expect(winners).toHaveLength(1);
      expect(conflicts).toHaveLength(1);
      if (conflicts[0].status === "rejected") {
        expect(conflicts[0].reason.message).toBe(
          "OFFICIAL_TEAM_ACCOUNT_VERSION_CONFLICT"
        );
      }
      if (winners[0].status !== "fulfilled") throw new Error("MISSING_WINNER");
      const winner = winners[0].value;
      expect(await version()).toBe(13);
      expect(await storedPermissions()).toEqual(
        sorted([...OLD_PERMISSIONS, ...winner.officialPermissions])
      );
      const state = await snapshot();
      expect(state.permissionAudits).toHaveLength(1);
      expect(state.officialAudits).toHaveLength(1);
      expect(state.officialAudits[0].requestId).toBe(winner.requestId);
      expect(state.officialAudits[0].afterData.result).toEqual(winner);
      expect(state.members).toEqual([]);
      const overview = await getOfficialTeamsOverview(actor);
      expect(
        overview.targets.find(target => target.adminUserId === targetId)
      ).toMatchObject({
        accountVersion: 13,
        officialPermissions: winner.officialPermissions,
      });
    }, 10000);

    it("SQL same requestId/payload replays the stable audited receipt despite stale expected version and never writes again", async () => {
      const input = saveInput();
      const first = await setOfficialTeamMember(actor, input);
      const before = await snapshot();
      expect(await version()).toBe(13);
      for (let replay = 0; replay < 3; replay++) {
        expect(await setOfficialTeamMember(actor, input)).toEqual({
          ...first,
          idempotent: true,
        });
      }
      expect(await snapshot()).toEqual(before);
    });

    it("SQL reusing requestId with changed payload or expectedAccountVersion is rejected without another audit", async () => {
      const input = saveInput();
      await setOfficialTeamMember(actor, input);
      const before = await snapshot();
      await expect(
        setOfficialTeamMember(actor, { ...input, expectedAccountVersion: 13 })
      ).rejects.toThrow("OFFICIAL_TEAM_REQUEST_ID_REUSED");
      await expect(
        setOfficialTeamMember(actor, { ...input, officialPermissions: [] })
      ).rejects.toThrow("OFFICIAL_TEAM_REQUEST_ID_REUSED");
      expect(await snapshot()).toEqual(before);
    });

    it.each([false, true])(
      "SQL a NEW grant request missing account version is rejected (empty revoke=%s) without writes",
      async revoke => {
        const { expectedAccountVersion: _unused, ...input } = saveInput({
          officialPermissions: revoke ? [] : ["officialInventory.read"],
        });
        const before = await snapshot();
        await expect(setOfficialTeamMember(actor, input)).rejects.toThrow(
          "OFFICIAL_TEAM_ACCOUNT_VERSION_REQUIRED"
        );
        expect(await snapshot()).toEqual(before);
      }
    );

    it("SQL new request with an old account version is rejected without changing grants, version or either audit", async () => {
      await setOfficialTeamMember(actor, saveInput());
      const before = await snapshot();
      await expect(
        setOfficialTeamMember(
          actor,
          saveInput({
            requestId: "v13_native_stale_002",
            officialPermissions: [],
          })
        )
      ).rejects.toThrow("OFFICIAL_TEAM_ACCOUNT_VERSION_CONFLICT");
      expect(await snapshot()).toEqual(before);
    });

    it("SQL [] revocation bumps sessionVersion once, preserves old grants and both original audit records", async () => {
      await setOfficialTeamMember(
        actor,
        saveInput({ officialPermissions: ["officialInventory.note"] })
      );
      const original = await snapshot();
      const revoked = await setOfficialTeamMember(
        actor,
        saveInput({
          expectedAccountVersion: 13,
          officialPermissions: [],
          requestId: "v13_native_revoke_002",
        })
      );
      expect(revoked).toMatchObject({
        member: null,
        revision: 0,
        officialPermissions: [],
        accountVersion: 14,
        idempotent: false,
      });
      expect(await version()).toBe(14);
      expect(await storedPermissions()).toEqual(sorted(OLD_PERMISSIONS));
      const state = await snapshot();
      expect(state.permissionAudits).toHaveLength(2);
      expect(state.officialAudits).toHaveLength(2);
      expect(state.permissionAudits[0]).toEqual(original.permissionAudits[0]);
      expect(state.officialAudits[0]).toEqual(original.officialAudits[0]);
      expect(sorted(state.permissionAudits[1].beforePermissions)).toEqual(
        sorted([
          ...OLD_PERMISSIONS,
          "officialInventory.note",
          "officialInventory.read",
        ])
      );
      expect(sorted(state.permissionAudits[1].afterPermissions)).toEqual(
        sorted(OLD_PERMISSIONS)
      );
      expect(state.members).toEqual([]);
      const overview = await getOfficialTeamsOverview(actor);
      expect(
        overview.targets.find(target => target.adminUserId === targetId)
      ).toMatchObject({ accountVersion: 14, officialPermissions: [] });
    });

    it("SQL no-op grant leaves account/grants/native audit untouched and writes just the new request audit", async () => {
      await putPermission("officialInventory.read");
      const before = await snapshot();
      const saved = await setOfficialTeamMember(actor, saveInput());
      expect(saved.accountVersion).toBe(12);
      const after = await snapshot();
      expect(after.accounts).toEqual(before.accounts);
      expect(after.permissions).toEqual(before.permissions);
      expect(after.permissionAudits).toEqual(before.permissionAudits);
      expect(after.officialAudits).toHaveLength(1);
      expect(after.officialAudits[0].afterData.permissionChanged).toBe(false);
    });

    it("SQL existing official membership is not fabricated or rewritten by permission-only save", async () => {
      await addMember();
      const memberBefore = await rows(
        "SELECT * FROM official_channel_team_members"
      );
      const saved = await setOfficialTeamMember(
        actor,
        saveInput({ teamId: 99003, role: "member", expectedRevision: 4 })
      );
      expect(saved).toMatchObject({
        accountVersion: 13,
        revision: 4,
        member: {
          adminUserId: targetId,
          teamId: 99003,
          role: "member",
          revision: 4,
        },
      });
      expect(await rows("SELECT * FROM official_channel_team_members")).toEqual(
        memberBefore
      );
      const overview = await getOfficialTeamsOverview(actor);
      expect(overview.members).toHaveLength(1);
      expect(overview.members[0].officialPermissions).toEqual(
        saved.officialPermissions
      );
    });

    it("SQL existing member revision CAS remains independent of native accountVersion", async () => {
      await addMember();
      const before = await snapshot();
      await expect(
        setOfficialTeamMember(
          actor,
          saveInput({ teamId: 99003, role: "member", expectedRevision: 3 })
        )
      ).rejects.toThrow("OFFICIAL_TEAM_MEMBER_REVISION_CONFLICT");
      expect(await snapshot()).toEqual(before);
    });

    it.each(["disabled", "locked"])(
      "SQL inactive target (%s) cannot be edited and is excluded from overview.targets",
      async status => {
        await pool!.execute("UPDATE admin_users SET status = ? WHERE id = ?", [
          status,
          targetId,
        ]);
        const before = await snapshot();
        await expect(setOfficialTeamMember(actor, saveInput())).rejects.toThrow(
          "OFFICIAL_TEAM_TARGET_ADMIN_INACTIVE"
        );
        expect(
          (await getOfficialTeamsOverview(actor)).targets.some(
            target => target.adminUserId === targetId
          )
        ).toBe(false);
        expect(await snapshot()).toEqual(before);
      }
    );

    it("SQL super-admin target displays four fixed permissions but refuses permission editing", async () => {
      const overview = await getOfficialTeamsOverview(actor);
      expect(
        overview.targets.find(target => target.adminUserId === SUPER_TARGET_ID)
      ).toMatchObject({ accountVersion: 7, officialPermissions: allOfficial });
      const before = await snapshot();
      await expect(
        setOfficialTeamMember(
          actor,
          saveInput({
            adminUserId: SUPER_TARGET_ID,
            expectedAccountVersion: 7,
            officialPermissions: [],
          })
        )
      ).rejects.toThrow("OFFICIAL_TEAM_SUPER_ADMIN_PERMISSIONS_IMMUTABLE");
      expect(await snapshot()).toEqual(before);
    });

    it.each([
      {
        label: "non-super live role, even with forged stored manage grant",
        role: "operation",
        status: "active",
        version: 5,
      },
      {
        label: "disabled live super-admin",
        role: "super_admin",
        status: "disabled",
        version: 5,
      },
      {
        label: "stale live sessionVersion",
        role: "super_admin",
        status: "active",
        version: 6,
      },
    ])("SQL $label cannot read targets or save grants", async change => {
      await pool!.execute(
        "UPDATE admin_users SET adminRole = ?, status = ?, sessionVersion = ? WHERE id = ?",
        [change.role, change.status, change.version, actor.adminUserId]
      );
      await putPermission("officialTeams.manage", actor.adminUserId);
      const before = await snapshot();
      await expect(getOfficialTeamsOverview(actor)).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      await expect(
        setOfficialTeamMember(actor, saveInput())
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(await snapshot()).toEqual(before);
    });

    it("SQL actor live validation precedes successful audit replay after actor is revoked", async () => {
      const input = saveInput();
      await setOfficialTeamMember(actor, input);
      await pool!.execute(
        "UPDATE admin_users SET sessionVersion = sessionVersion + 1 WHERE id = ?",
        [actor.adminUserId]
      );
      const before = await snapshot();
      await expect(setOfficialTeamMember(actor, input)).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      expect(await snapshot()).toEqual(before);
    });

    it.each([
      {
        table: "admin_user_permission_audits",
        trigger: "v13_native_fail_permission_audit",
      },
      {
        table: "official_channel_audits",
        trigger: "v13_native_fail_official_audit",
      },
    ])(
      "SQL trigger failure at $table atomically rolls back permissions, version and BOTH audits, preserving prior history",
      async ({ table, trigger }) => {
        await setOfficialTeamMember(actor, saveInput());
        const before = await snapshot();
        // Trigger exists ONLY inside the fixed synthetic database; no production DDL.
        await pool!.query(
          `CREATE TRIGGER \`${trigger}\` BEFORE INSERT ON \`${table}\` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'V13_SYNTHETIC_AUDIT_FAILURE'`
        );
        let failure: unknown;
        try {
          await setOfficialTeamMember(
            actor,
            saveInput({
              expectedAccountVersion: 13,
              officialPermissions: ["officialInventory.note"],
              requestId: "v13_native_atomic_fail_002",
            })
          );
        } catch (error) {
          failure = error;
        } finally {
          await pool!.query(`DROP TRIGGER IF EXISTS \`${trigger}\``);
        }
        expect(failure).toBeDefined();
        const chainedMessages: string[] = [];
        let cursor = failure;
        while (cursor && typeof cursor === "object") {
          const error = cursor as { message?: string; cause?: unknown };
          chainedMessages.push(error.message ?? "");
          cursor = error.cause;
        }
        expect(chainedMessages.join("\n")).toContain(
          "V13_SYNTHETIC_AUDIT_FAILURE"
        );
        expect(await snapshot()).toEqual(before);
        // A clean retry with the same request is legal: the failed transaction left no
        // poisoned idempotency row, partial native grant or extra invalidation behind.
        const recovered = await setOfficialTeamMember(
          actor,
          saveInput({
            expectedAccountVersion: 13,
            officialPermissions: ["officialInventory.note"],
            requestId: "v13_native_atomic_fail_002",
          })
        );
        expect(recovered).toMatchObject({
          accountVersion: 14,
          idempotent: false,
          officialPermissions: [
            "officialInventory.note",
            "officialInventory.read",
          ],
        });
        const after = await snapshot();
        expect(after.permissionAudits).toHaveLength(2);
        expect(after.officialAudits).toHaveLength(2);
        expect(after.permissionAudits[0]).toEqual(before.permissionAudits[0]);
        expect(after.officialAudits[0]).toEqual(before.officialAudits[0]);
      }
    );
  }
);
