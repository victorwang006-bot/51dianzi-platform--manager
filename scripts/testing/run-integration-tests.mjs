#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createIntegrationTestEnvironment } from "./test-isolation.mjs";

let environment;
try {
  environment = createIntegrationTestEnvironment();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
  process.exit();
}

const result = spawnSync(
  "pnpm",
  ["exec", "vitest", "run", "--config", "vitest.integration.config.ts"],
  {
    cwd: process.cwd(),
    env: environment,
    stdio: "inherit",
  }
);

if (result.error) {
  throw result.error;
}
process.exitCode = result.status ?? 1;
