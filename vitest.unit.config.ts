import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const templateRoot = path.dirname(fileURLToPath(import.meta.url));
const testingRoot = path.resolve(templateRoot, "scripts", "testing");

export default defineConfig({
  root: templateRoot,
  resolve: {
    alias: [
      {
        find: "dotenv/config",
        replacement: path.join(testingRoot, "dotenv-blocker.mjs"),
      },
      {
        find: "dotenv",
        replacement: path.join(testingRoot, "dotenv-blocker.mjs"),
      },
      { find: "@", replacement: path.resolve(templateRoot, "client", "src") },
      { find: "@shared", replacement: path.resolve(templateRoot, "shared") },
      {
        find: "@assets",
        replacement: path.resolve(templateRoot, "attached_assets"),
      },
    ],
  },
  test: {
    environment: "node",
    fileParallelism: false,
    include: [
      "client/src/components/admin/adminWorkbenchNavigationModel.test.ts",
      "server/merchantLicenseAccess.test.ts",
      "scripts/testing/**/*.test.ts",
    ],
    setupFiles: [
      path.join(testingRoot, "unit.preload.mjs"),
      path.join(testingRoot, "unit.setup.mjs"),
    ],
  },
});
