/** Test-only bundled worker. Never imported by application or release entry points. */
import { afterAll } from "vitest";
import { buildSync } from "esbuild";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { closeOfficialTechnicalReaderWorkers } from "./officialTechnicalReader";

if (process.env.NODE_ENV !== "test") throw new Error("TEST_WORKER_FIXTURE_ONLY");
const previous = process.env.OFFICIAL_TECHNICAL_READER_WORKER_PATH;
const directory = mkdtempSync(join(tmpdir(), "official-technical-test-worker-"));
const worker = join(directory, "reader.worker.mjs");
buildSync({
  entryPoints: [join(dirname(fileURLToPath(import.meta.url)), "officialTechnicalReaderWorker.ts")],
  outfile: worker,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  logLevel: "silent",
});
process.env.OFFICIAL_TECHNICAL_READER_WORKER_PATH = worker;
afterAll(() => {
  closeOfficialTechnicalReaderWorkers();
  if (previous === undefined) delete process.env.OFFICIAL_TECHNICAL_READER_WORKER_PATH;
  else process.env.OFFICIAL_TECHNICAL_READER_WORKER_PATH = previous;
  rmSync(directory, { recursive: true, force: true });
});
