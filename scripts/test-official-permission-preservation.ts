#!/usr/bin/env tsx
import assert from "node:assert/strict";
import { randomInt } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import mysql from "mysql2/promise";
import { drizzle } from "drizzle-orm/mysql2";
import { and, eq, inArray, notInArray } from "drizzle-orm";
import { adminUserPermissions } from "../drizzle/schema";

const url = process.env.DATABASE_URL;
assert(url, "Explicit fixture URL required");
const target = new URL(url);
assert(
  target.hostname === "127.0.0.1" &&
    target.port === "33316" &&
    target.pathname === "/official_channel_fixture",
  "Fixture target refused"
);
const source = readFileSync(
  new URL("../server/db.ts", import.meta.url),
  "utf8"
);
const functionSource = source.match(
  /async function replaceAdminUserPermissions\([\s\S]*?\n}\n/
)?.[0];
assert(
  functionSource,
  "Actual private permission replacement function not found"
);
const compiled = ts.transpileModule(functionSource, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.CommonJS,
  },
}).outputText;
const replace = runInNewContext(compiled + "\nreplaceAdminUserPermissions", {
  and,
  eq,
  inArray,
  notInArray,
  adminUserPermissions,
}) as (tx: unknown, id: number, permissions: string[]) => Promise<string[]>;
const pool = mysql.createPool(url);
const db = drizzle(pool);
const adminUserId = 700000000 + randomInt(1000000);
const official = [
  "officialInventory.read",
  "officialInventory.write",
  "officialInventory.publish",
  "officialInventory.note",
];
const rows = async () =>
  (
    await db
      .select({ permission: adminUserPermissions.permission })
      .from(adminUserPermissions)
      .where(eq(adminUserPermissions.adminUserId, adminUserId))
  )
    .map(row => row.permission)
    .sort();
try {
  assert.deepEqual(
    await rows(),
    [],
    "Refuse to overwrite pre-existing fixture permissions"
  );
  await db
    .insert(adminUserPermissions)
    .values(
      [...official, "profile.manage"].map(permission => ({
        adminUserId,
        permission,
      }))
    );
  const first = await db.transaction(tx =>
    replace(tx, adminUserId, ["messages.read"])
  );
  assert.deepEqual(await rows(), [...official, "messages.read"].sort());
  assert.deepEqual([...first].sort(), [...official, "messages.read"].sort());
  await db.transaction(tx => replace(tx, adminUserId, []));
  assert.deepEqual(
    await rows(),
    [...official].sort(),
    "Empty stale/super-role payload must retain independently configured official grants"
  );
  await db
    .delete(adminUserPermissions)
    .where(
      and(
        eq(adminUserPermissions.adminUserId, adminUserId),
        eq(adminUserPermissions.permission, "officialInventory.publish")
      )
    );
  await db.transaction(tx =>
    replace(tx, adminUserId, ["messages.read", "officialInventory.publish"])
  );
  assert.deepEqual(
    await rows(),
    [
      ...official.filter(
        permission => permission !== "officialInventory.publish"
      ),
      "messages.read",
    ].sort(),
    "General permission path cannot grant official permissions"
  );
  const report = {
    passed: true,
    database: "official_channel_fixture",
    productionQueries: 0,
    actualServerFunctionExecutedWithRealDrizzle: true,
    preservedIndependentOfficialPermissions: true,
    staleEmptyPayloadSafe: true,
    genericPathCannotGrantOfficialPermissions: true,
    auditReturnMatchesActualRows: true,
  };
  writeFileSync(
    new URL(
      "../../backend-team-v1/permission-preservation-db.json",
      import.meta.url
    ),
    JSON.stringify(report, null, 2) + "\n"
  );
  console.log(JSON.stringify(report));
} finally {
  await db
    .delete(adminUserPermissions)
    .where(eq(adminUserPermissions.adminUserId, adminUserId));
  await pool.end();
}
