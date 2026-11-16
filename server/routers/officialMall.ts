import type { TrpcContext } from "../_core/context";
import { adminProcedure, publicProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import {
  assertOfficialRecordAction,
  loadOfficialAccess,
  officialActorFromContext,
  officialTeamPredicate,
} from "../services/officialChannelAccess";
import {
  createOfficialMallService,
  officialMallBulkSchema,
  officialMallCreateSchema,
  officialMallImportSchema,
  officialMallPreviewSchema,
  officialMallPublicIdSchema,
  officialMallPublicListSchema,
  officialMallRequestStatusSchema,
  officialMallSuggestSchema,
  officialMallUpdateSchema,
  type OfficialMallDependencies,
} from "../services/officialMall";
import {
  officialMallListSchema,
  officialMallRowMutationSchema,
} from "../../shared/officialMall";

/** Injectable native ABI for bounded runtime compilation and SQL-free caller tests. */
export function createOfficialMallRouters(
  deps: OfficialMallDependencies & {
    adminProcedure: typeof adminProcedure;
    publicProcedure: typeof publicProcedure;
    router: typeof router;
    officialActorFromContext: (
      ctx: TrpcContext
    ) => ReturnType<typeof officialActorFromContext>;
  }
) {
  const service = createOfficialMallService(deps);
  const actor = deps.officialActorFromContext;
  function noStore(ctx: TrpcContext) {
    ctx.res?.setHeader("Cache-Control", "no-store, max-age=0");
    ctx.res?.setHeader("Pragma", "no-cache");
  }
  return {
    officialMall: deps.router({
      status: deps.adminProcedure.query(({ ctx }) =>
        service.status(actor(ctx))
      ),
      list: deps.adminProcedure
        .input(officialMallListSchema)
        .query(({ ctx, input }) => service.list(actor(ctx), input)),
      create: deps.adminProcedure
        .input(officialMallCreateSchema)
        .mutation(({ ctx, input }) => service.create(actor(ctx), input)),
      update: deps.adminProcedure
        .input(officialMallUpdateSchema)
        .mutation(({ ctx, input }) => service.update(actor(ctx), input)),
      publish: deps.adminProcedure
        .input(officialMallRowMutationSchema)
        .mutation(({ ctx, input }) => service.publish(actor(ctx), input)),
      offshelf: deps.adminProcedure
        .input(officialMallRowMutationSchema)
        .mutation(({ ctx, input }) => service.offshelf(actor(ctx), input)),
      bulkAction: deps.adminProcedure
        .input(officialMallBulkSchema)
        .mutation(({ ctx, input }) => service.bulkAction(actor(ctx), input)),
      requestStatus: deps.adminProcedure
        .input(officialMallRequestStatusSchema)
        .query(({ ctx, input }) => service.requestStatus(actor(ctx), input)),
      suggest: deps.adminProcedure
        .input(officialMallSuggestSchema)
        .query(({ ctx, input }) => service.suggest(actor(ctx), input)),
      importPreview: deps.adminProcedure
        .input(officialMallPreviewSchema)
        .query(({ ctx, input }) => service.importPreview(actor(ctx), input)),
      importRows: deps.adminProcedure
        .input(officialMallImportSchema)
        .mutation(({ ctx, input }) => service.importRows(actor(ctx), input)),
    }),
    officialMallPublic: deps.router({
      list: deps.publicProcedure
        .input(officialMallPublicListSchema)
        .query(({ ctx, input }) => { noStore(ctx); return service.publicList(input); }),
      detail: deps.publicProcedure
        .input(officialMallPublicIdSchema)
        .query(({ ctx, input }) => { noStore(ctx); return service.publicDetail(input); }),
    }),
  };
}

const native = createOfficialMallRouters({
  adminProcedure,
  publicProcedure,
  router,
  getDb,
  loadOfficialAccess,
  assertOfficialRecordAction,
  officialActorFromContext,
  officialTeamPredicate,
});
export const officialMallRouter = native.officialMall;
export const officialMallPublicRouter = native.officialMallPublic;
