import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const templateRoot = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: templateRoot,
  resolve: {
    alias: {
      "@": path.resolve(templateRoot, "client", "src"),
      "@shared": path.resolve(templateRoot, "shared"),
      "@assets": path.resolve(templateRoot, "attached_assets"),
    },
  },
  test: {
    environment: "node",
    fileParallelism: false,
    include: [
      "server/**/*.integration.test.ts",
      "client/src/**/*.integration.test.ts",
    ],
    setupFiles: ["scripts/testing/integration-guard.setup.ts"],
    passWithNoTests: false,
  },
});
