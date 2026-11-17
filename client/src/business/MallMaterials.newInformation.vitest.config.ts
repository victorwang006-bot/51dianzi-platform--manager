import { defineConfig } from "vitest/config";
import base from "../../../vitest.config";
export default defineConfig({
  ...base,
  esbuild: { jsx: "automatic" },
  test: { ...base.test, include: ["client/src/business/MallMaterials.newInformation.test.ts"] },
});
