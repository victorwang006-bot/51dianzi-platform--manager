#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createUnitTestEnvironment } from "./test-isolation.mjs";

const result = spawnSync(
  "pnpm",
  ["exec", "vitest", "run", "--config", "vitest.unit.config.ts"],
  {
    cwd: process.cwd(),
    env: createUnitTestEnvironment(),
    stdio: "inherit",
  }
);

if (result.error) {
  throw result.error;
}
process.exitCode = result.status ?? 1;
