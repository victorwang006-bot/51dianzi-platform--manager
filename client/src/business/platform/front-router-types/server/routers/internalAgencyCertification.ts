import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { publicProcedure, router } from "../_core/trpc";
import { requireInternalCompanyMediaPortalKey } from "./internalCompanyMedia";
import {
  agencyCertificationDocument,
  listAgencyCertifications,
  mutateAgencyCertification,
  type AgencyOperator,
} from "../services/agencyCertification";
function operator(
  headers: Record<string, unknown> | undefined
): AgencyOperator {
  function read(key: string) {
    const raw = headers?.[key];
    const value = Array.isArray(raw) ? raw[0] : raw;
    if (typeof value !== "string") return "";
    return (
      value.startsWith("b64.")
        ? Buffer.from(value.slice(4), "base64url").toString("utf8")
        : value
    ).trim();
  }
  const id = Number(read("x-internal-operator-id")),
    name = read("x-internal-operator-name"),
    role = read("x-internal-operator-role");
  if (!Number.isSafeInteger(id) || id < 1 || !name || !role)
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "后台操作人上下文缺失",
    });
  return {
    id,
    name: name.slice(0, 128),
    role: role.slice(0, 64),
    ipAddress: read("x-internal-operator-ip").slice(0, 64) || null,
    userAgent: read("x-internal-operator-user-agent").slice(0, 512) || null,
  };
}
const binding = z.object({
  creditCode: z.string().trim().min(1).max(64),
  expectedOwnerUserId: z.number().int().positive(),
});
const file = z.object({
  fileName: z.string().trim().min(1).max(160),
  mimeType: z.enum([
    "image/jpeg",
    "image/png",
    "image/webp",
    "application/pdf",
  ]),
  base64: z.string().min(1).max(13981016),
});
const mutation = binding.extend({
  requestId: z.string().trim().min(8).max(64),
});
export const internalAgencyCertificationRouter = router({
  health: publicProcedure.query(({ ctx }) => {
    requireInternalCompanyMediaPortalKey(ctx.req?.headers);
    return { ready: true };
  }),
  list: publicProcedure.input(binding).query(({ ctx, input }) => {
    requireInternalCompanyMediaPortalKey(ctx.req?.headers);
    return listAgencyCertifications(input);
  }),
  upsert: publicProcedure
    .input(
      mutation.extend({
        id: z.number().int().positive().optional(),
        expectedRevision: z.number().int().positive().optional(),
        brands: z.array(z.string().trim().min(1).max(80)).min(1).max(30),
        file: file.optional(),
      })
    )
    .mutation(({ ctx, input }) => {
      requireInternalCompanyMediaPortalKey(ctx.req?.headers);
      return mutateAgencyCertification({
        ...input,
        operator: operator(ctx.req?.headers),
        action: "save",
      });
    }),
  cancel: publicProcedure
    .input(
      mutation.extend({
        id: z.number().int().positive(),
        expectedRevision: z.number().int().positive(),
      })
    )
    .mutation(({ ctx, input }) => {
      requireInternalCompanyMediaPortalKey(ctx.req?.headers);
      return mutateAgencyCertification({
        ...input,
        operator: operator(ctx.req?.headers),
        action: "cancel",
      });
    }),
  document: publicProcedure
    .input(binding.extend({ id: z.number().int().positive() }))
    .query(({ ctx, input }) => {
      requireInternalCompanyMediaPortalKey(ctx.req?.headers);
      return agencyCertificationDocument({
        ...input,
        operator: operator(ctx.req?.headers),
      });
    }),
});
