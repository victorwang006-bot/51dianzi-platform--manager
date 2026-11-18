import { defineConfig } from "vitest/config";
export default defineConfig({
  test: { environment: "node", include: ["deploy/official-material-import-20261118/*.test.ts"], fileParallelism: false },
});
