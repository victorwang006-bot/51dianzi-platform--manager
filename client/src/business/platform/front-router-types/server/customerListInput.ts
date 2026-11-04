import { z } from "zod";
import { customerListSchema } from "../../shared/crmCustomers";

// Server-only extension: keep the original public frontend schema/static tree unchanged.
// Old callers omit this field and retain the existing unfiltered list semantics.
export const customerListInputSchema = customerListSchema.extend({
  starredOnly: z.boolean().default(false),
});
