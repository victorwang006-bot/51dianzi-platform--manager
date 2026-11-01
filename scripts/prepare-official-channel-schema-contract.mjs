#!/usr/bin/env node
import fs from "node:fs";
import vm from "node:vm";
import crypto from "node:crypto";

const source = fs.readFileSync(
  new URL("./apply-official-channel-schema.mjs", import.meta.url),
  "utf8"
);
const start = source.indexOf("const tableDefinitions =");
const end = source.indexOf("async function verifyTable(");
if (start < 0 || end <= start) throw new Error("schema extraction boundary");
const data = vm.runInNewContext(
  source.slice(start, end) +
    ";({tableDefinitions,expectedColumns,expectedIndexes})",
  {},
  { timeout: 1000 }
);
if (data.tableDefinitions.length !== 7)
  throw new Error("exact official schema table count required");
for (const [name, ddl] of data.tableDefinitions) {
  if (
    !/^official_channel_[a-z_]+$/.test(name) ||
    !new RegExp("^\\s*CREATE TABLE IF NOT EXISTS " + name + "\\s*\\(").test(ddl)
  )
    throw new Error("unsafe schema target");
  if (
    /[;]/.test(ddl) ||
    /^\s*(?:ALTER|DROP|TRUNCATE|UPDATE|DELETE|INSERT)\b/im.test(ddl)
  )
    throw new Error("schema may only create its one new table");
}
const body = {
  contractSourceSha256: crypto
    .createHash("sha256")
    .update(source)
    .digest("hex"),
  ...data,
};
const directory = new URL("../deploy/official-channel/", import.meta.url);
fs.mkdirSync(directory, { recursive: true });
fs.writeFileSync(
  new URL("schema-contract.json", directory),
  JSON.stringify(body, null, 2) + "\n"
);
console.log(
  "已导出7张新增官方表固定DDL、字段与索引；原隔离迁移器安全边界不变。"
);
