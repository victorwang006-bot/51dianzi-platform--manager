import { defineConfig } from "vitest/config";
import base from "../vitest.config";

export default defineConfig({
  ...base,
  test: {
    ...base.test,
    include: ["client/src/business/platform/client/src/components/customers/CustomerCreateDraftStore.restore.test.tsx"],
  },
});
