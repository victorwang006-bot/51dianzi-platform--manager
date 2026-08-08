import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(path), "utf8");
const schema = read("drizzle/schema.ts");
const migration = read("drizzle/0019_medical_vengeance.sql");
const installer = read("scripts/apply-chat-message-idempotency.mjs");
const router = read("server/routers.ts");
const db = read("server/db.ts");

describe("后台消息 clientMessageId 幂等契约", () => {
  it("旧调用可不传，新outbox调用使用UUID", () => {
    expect(router).toContain("clientMessageId: z.string().uuid().max(64).optional().nullable()");
    expect(router).toContain("return db.createPortalMessage(input)");
  });

  it("消息表使用可空唯一键，存量消息无需回填", () => {
    expect(schema).toContain('clientMessageId: varchar("clientMessageId", { length: 64 })');
    expect(schema).toContain('uniqueIndex("messages_client_message_unique")');
    expect(migration).toContain("ALTER TABLE `messages` ADD `clientMessageId` varchar(64)");
    expect(migration).toContain("UNIQUE(`clientMessageId`)");
    expect(migration).not.toMatch(/\bUPDATE\s+`?messages`?/i);
    expect(migration).not.toMatch(/\bDELETE\s+FROM\b/i);
  });

  it("事务内先查重，唯一键并发冲突后读取胜出消息", () => {
    expect(db).toContain("const existingBeforeTransaction = await findExisting()");
    expect(db).toContain("return await db.transaction(async tx =>");
    expect(db).toContain("clientMessageId: input.clientMessageId ?? null");
    expect(db).toContain('mysqlError.code === "ER_DUP_ENTRY"');
    expect(db).toContain("const existingAfterConflict = await findExisting()");
    expect(db).toContain("deduplicated: true");
    expect(db).toContain("消息幂等键与原留言内容不一致");
    expect(db).toContain("消息幂等键与原留言用户不一致");
  });

  it("生产安装器取得命名锁、拒绝重复并复核索引，不改写历史消息", () => {
    expect(installer).toContain("GET_LOCK");
    expect(installer).toContain("存在重复 clientMessageId");
    expect(installer).toContain("messages_client_message_unique");
    expect(installer).toContain("messages_thread_created_idx");
    expect(installer).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(installer).not.toMatch(/\bUPDATE\s+messages\b/i);
    expect(installer).not.toMatch(/\bDROP\s+(TABLE|COLUMN)\b/i);
  });
});
