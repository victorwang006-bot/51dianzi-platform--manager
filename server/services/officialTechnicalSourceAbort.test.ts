import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import ts from "typescript";
import { createOfficialTechnicalPreparationHook } from "./officialTechnicalPreparation";
import { createOfficialTechnicalPreparedStore } from "./officialTechnicalPreparedStore";

const identity = { publicId: "OM_00000000-0000-4000-8000-000000000001", revision: 2, partNumber: "SYNTHETIC-PART", brand: "ST", pkg: "LQFP48" };
const names = ["createMaterial", "updateMaterial", "appendMaterialImage"] as const;
// Compile only the exact three current source functions. Inject inert native bindings; importing
// the real db module would risk environment/bootstrap IO and would not prove these wrappers.
const source = readFileSync(new URL("../db.ts", import.meta.url), "utf8");
const ast = ts.createSourceFile("db.ts", source, ts.ScriptTarget.Latest, true);
const selected = ast.statements.filter(node => ts.isFunctionDeclaration(node) && names.includes(node.name?.text as any));
if (selected.length !== 3) throw Error("Expected exactly three source wrappers");
const compiled = ts.transpileModule(selected.map(node => node.getText(ast)).join("\n"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;

async function fixture(run: (f: any) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), "manager-source-abort-"));
  const hook = createOfficialTechnicalPreparationHook(join(directory, "store.json"));
  const before = vi.spyOn(hook, "beforeSourceMutation"); const abort = vi.spyOn(hook, "abortSourceMutation");
  const committedError = Error("synthetic native transaction rejection");
  const f: any = { hook, before, abort, committedError, failWrite: false, rejectTransaction: false, materialWrites: 0 };
  const materialTable = { id: "id", materialNo: "materialNo" }; const sequenceTable = { nextValue: "nextValue", sequenceKey: "sequenceKey" };
  function query(result: any = undefined) {
    const q: any = { from: () => q, where: () => q, limit: () => q, for: () => q, onDuplicateKeyUpdate: () => q,
      then: (resolve: any, reject: any) => Promise.resolve(result).then(resolve, reject) };
    return q;
  }
  const existing = { id: 1, partNumber: identity.partNumber, materialNo: "M000001", images: [], coverImageUrl: null };
  const tx = {
    select: (columns: any) => query(columns?.nextValue ? [{ nextValue: 1 }] : [existing]),
    insert: (table: any) => ({ values: (_data: any) => {
      if (table === materialTable) { f.materialWrites++; if (f.failWrite) return Promise.reject(committedError); }
      return query();
    } }),
    update: (table: any) => ({ set: (_data: any) => {
      if (table === materialTable) { f.materialWrites++; if (f.failWrite) return { where: () => Promise.reject(committedError) }; }
      return query();
    } }),
  };
  const db = { transaction: async (runTx: any) => { const result = await runTx(tx); if (f.rejectTransaction) throw committedError; return result; } };
  const finish = vi.fn(async () => true);
  const exports: any = {};
  new Function("exports", "getDb", "officialTechnicalPreparation", "finishOfficialTechnicalSourceCommit", "materials", "materialNumberSequences", "PLATFORM_MATERIAL_SEQUENCE_KEY", "eq", "formatMaterialNo", "auditLogs", "decodeJsonValue", compiled)(exports, async () => db, hook, finish, materialTable, sequenceTable, "PLATFORM", (...args: any[]) => args, () => "M000001", {}, (value: any, fallback: any) => value ?? fallback);
  f.finish = finish; f.call = (name: typeof names[number]) => name === "createMaterial" ? exports[name]({ partNumber: identity.partNumber, brand: "ST" }) : name === "updateMaterial" ? exports[name](1, { description: "synthetic source change" }) : exports[name](1, { url: "https://example.com/synthetic.png", asCover: true });
  try { await run(f); } finally { before.mockRestore(); abort.mockRestore(); await rm(directory, { recursive: true, force: true }); }
}

describe("exact native create/update/append source abort lifecycle (isolated no DB)", () => {
  it.each(names)("%s: successful prewrite+transaction commit runs postcommit only and preserves native return", async name => fixture(async f => {
    expect(await f.call(name)).toBeTruthy(); expect(f.before).toHaveBeenCalledTimes(1); expect(f.finish).toHaveBeenCalledTimes(1); expect(f.abort).not.toHaveBeenCalled();
    // finish is deliberately stubbed, so its committed writer is still pending and lookup is fail-closed.
    expect((await createOfficialTechnicalPreparedStore(f.hook.store.path).lookup([identity]))[0].state).toBe("unavailable");
  }));
  it.each(names)("%s: begin failure prevents the source DB write and rethrows the ORIGINAL begin error", async name => fixture(async f => {
    const error = Error("synthetic prewrite failure"); f.before.mockRejectedValueOnce(error);
    await expect(f.call(name)).rejects.toBe(error); expect(f.materialWrites).toBe(0); expect(f.finish).not.toHaveBeenCalled();
  }));
  it.each(names)("%s: source write rejection releases pending, remains null and rethrows ORIGINAL transaction error", async name => fixture(async f => {
    f.failWrite = true; await expect(f.call(name)).rejects.toBe(f.committedError);
    expect(f.abort).toHaveBeenCalledTimes(1); expect(f.finish).not.toHaveBeenCalled();
    const doc = JSON.parse(await readFile(f.hook.store.path, "utf8")); expect(Object.values(doc.sources)).toEqual([expect.objectContaining({ version: null, pendingWriterTickets: [] })]);
    expect((await createOfficialTechnicalPreparedStore(f.hook.store.path).lookup([identity]))[0].state).toBe("unavailable");
  }));
  it.each(names)("%s: native transaction-level rejection also releases pending", async name => fixture(async f => {
    f.rejectTransaction = true; await expect(f.call(name)).rejects.toBe(f.committedError);
    expect(f.abort).toHaveBeenCalledTimes(1); expect(f.finish).not.toHaveBeenCalled();
    const doc = JSON.parse(await readFile(f.hook.store.path, "utf8")); expect((Object.values(doc.sources)[0] as any).pendingWriterTickets).toEqual([]);
  }));
  it.each(names)("%s: cleanup failure retains pending/fail-closed and never replaces ORIGINAL DB error", async name => fixture(async f => {
    f.failWrite = true; f.abort.mockRejectedValueOnce(Error("synthetic cleanup failure")); const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await expect(f.call(name)).rejects.toBe(f.committedError); expect(f.finish).not.toHaveBeenCalled();
      const doc = JSON.parse(await readFile(f.hook.store.path, "utf8")); expect((Object.values(doc.sources)[0] as any).pendingWriterTickets).toHaveLength(1);
      expect((await createOfficialTechnicalPreparedStore(f.hook.store.path).lookup([identity]))[0].state).toBe("unavailable");
      expect(warning).toHaveBeenCalledWith("[officialTechnical] source transaction rejected; pending cleanup unavailable; explicit repair required");
    } finally { warning.mockRestore(); }
  }));
});
