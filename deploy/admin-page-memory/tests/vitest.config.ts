import path from "node:path";
import { defineConfig } from "vitest/config";

const managerRoot = path.resolve(import.meta.dirname, "../../..");

export default defineConfig({
  root: managerRoot,
  resolve: {
    alias: {
      "@client": path.resolve(managerRoot, "client/src"),
    },
  },
  test: {
    environment: "jsdom",
    fileParallelism: false,
    include: ["client/src/lib/adminPageMemory.test.ts"],
  },
});
