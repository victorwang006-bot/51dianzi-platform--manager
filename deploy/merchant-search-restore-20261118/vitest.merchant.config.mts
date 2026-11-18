import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  root: process.env.MERCHANT_SOURCE_REPO || "/home/ubuntu/diagnosis/frontrepo",
  test: {
    environment: "node",
    include: ["client/src/pages/MerchantSearchRestore.test.ts"],
    maxWorkers: 1,
    minWorkers: 1,
    testTimeout: 10_000,
  },
});
