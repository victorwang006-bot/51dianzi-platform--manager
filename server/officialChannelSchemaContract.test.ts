import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(process.cwd(), "scripts/apply-official-channel-schema.mjs"),
  "utf8"
);
const schema = readFileSync(
  resolve(process.cwd(), "drizzle/officialChannelSchema.ts"),
  "utf8"
);

const tables = [
  "official_channel_teams",
  "official_channel_team_members",
  "official_channel_sources",
  "official_channel_stocks",
  "official_channel_stock_notes",
  "official_channel_publications",
  "official_channel_audits",
];

describe("官方渠道 schema 迁移合同（静态隔离）", () => {
  it("迁移器仅接受显式的本地 migration_*_test 数据库，且不读取运行时环境文件", () => {
    expect(migration).toContain("process.env.DATABASE_URL?.trim()");
    expect(migration).toContain("migration_[a-z0-9_]+_test");
    expect(migration).not.toMatch(/readFile|dotenv|from-runtime-env/);
    expect(migration).toContain("GET_LOCK(?, 30)");
    expect(migration).toContain("RELEASE_LOCK(?)");
  });

  it("Drizzle 模式与受控迁移器均覆盖契约的七张独立官方表", () => {
    for (const table of tables) {
      expect(schema).toContain(`"${table}"`);
      expect(migration).toContain(`CREATE TABLE IF NOT EXISTS ${table}`);
      expect(migration).toContain(`expectedColumns[table]`);
    }
    expect(schema).toContain("officialChannelTeams");
    expect(schema).toContain("officialChannelTeamMembers");
    expect(schema).toContain("officialChannelSources");
    expect(schema).toContain("officialChannelStocks");
    expect(schema).toContain("officialChannelStockNotes");
    expect(schema).toContain("officialChannelPublications");
    expect(schema).toContain("officialChannelAudits");
  });

  it("MySQL 8 leader 生成列唯一索引和所有幂等关键索引均已声明并复核", () => {
    expect(migration).toContain("leaderTeamId INT GENERATED ALWAYS AS");
    expect(migration).toContain(
      "UNIQUE KEY official_channel_team_members_leader_team_unique (leaderTeamId)"
    );
    expect(migration).toContain(
      "official_channel_team_members_admin_user_unique"
    );
    expect(migration).toContain(
      "official_channel_stocks_create_request_unique"
    );
    expect(migration).toContain("official_channel_stock_notes_request_unique");
    expect(migration).toContain("official_channel_publications_stock_unique");
    expect(migration).toContain("official_channel_audits_request_unique");
    expect(migration).toContain("必须为生成列");
    expect(schema).toContain("generatedAlwaysAs(");
    expect(schema).toContain("leaderTeamUnique");
  });

  it("迁移器不 ALTER/DROP 任何旧业务、商户 ERP 或 admin_users 表", () => {
    expect(migration).not.toMatch(/\b(?:ALTER|DROP|TRUNCATE)\s+TABLE\b/i);
    expect(migration).not.toMatch(
      /CREATE TABLE IF NOT EXISTS (?:enterprise_|inventories|admin_users)/i
    );
    expect(migration).not.toMatch(
      /\bUPDATE\s+(?:admin_users|enterprise_|inventories)/i
    );
  });
});
