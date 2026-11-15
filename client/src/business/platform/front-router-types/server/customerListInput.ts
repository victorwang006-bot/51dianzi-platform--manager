import { z } from "zod";
import { customerListSchema } from "../../shared/crmCustomers";

// Server-only star extension; safeExtend retains the shared updated-date range refinement.
// Old callers omit this field and retain the existing unfiltered list semantics.
export const customerListInputSchema = customerListSchema.safeExtend({
  starredOnly: z.boolean().default(false),
});
