import { clearAllSessionCookies, getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";
import { localAuthRouter } from "./routers/localAuth";
import { wechatAuthRouter } from "./routers/wechatAuth";
import { wechatServiceNotificationsRouter } from "./routers/wechatServiceNotifications";
import { wechatMiniProgramNotificationsRouter } from "./routers/wechatMiniProgramNotifications";
import { companyRouter } from "./routers/company";
import { companyReviewRouter } from "./routers/companyReview";
import { coffeeVoucherRouter } from "./routers/coffeeVoucher";
import { inventoryRouter } from "./routers/inventory";
import { searchRouter } from "./routers/search";
import { guestQueryRouter } from "./routers/guestQuery";
import { cartRouter } from "./routers/cart";
import { addressRouter } from "./routers/address";
import { pickupPointRouter } from "./routers/pickupPoint";
import { invoiceTitleRouter } from "./routers/invoiceTitle";
import { orderRouter } from "./routers/order";
import { paymentRouter } from "./routers/payment";
import { inboundRouter } from "./routers/inbound";
import { outboundRouter } from "./routers/outbound";
import { customerRouter } from "./routers/customer";
import { customerDemandRouter } from "./routers/customerDemand";
import { crmSalesOrderRouter } from "./routers/crmSalesOrder";
import { purchaseOrderRouter } from "./routers/purchaseOrder";
import { stockBoardRouter } from "./routers/stockBoard";
import { importInventoryRouter } from "./routers/importInventory";
import { chatRouter } from "./routers/chat";
import { forumRouter } from "./routers/forum";
import { publicReviewRouter } from "./routers/publicReview";
import { demandRouter } from "./routers/demand";
import { marketRouter } from "./routers/market";
import { recommendationRouter } from "./routers/recommendation";
import { materialRouter } from "./routers/material";
import { inquiryRouter } from "./routers/inquiry";
import { enterpriseRouter } from "./routers/enterprise";
import { internalCrmRouter } from "./routers/internalCrm";
import { internalOrderRouter } from "./routers/internalOrder";
import { internalUserRouter } from "./routers/internalUser";
import { internalEnterpriseRouter } from "./routers/internalEnterprise";
import { internalBusinessRouter } from "./routers/internalBusiness";
import { internalCompanyMediaRouter } from "./routers/internalCompanyMedia";
import { internalAgencyCertificationRouter } from "./routers/internalAgencyCertification";
import { internalSpotVerificationRouter } from "./routers/internalSpotVerification";
import { bomRouter } from "./routers/bom";
import { siteAnalyticsRouter } from "./routers/siteAnalytics";
import { toPublicAuthUser } from "./publicAuthUser";
import { reconcileCrmAccessForUser } from "./services/crmAccessSync";
import { channelInventoryRouter } from "./routers/channelInventoryRuntime";

export const appRouter = router({
    // if you need to use socket.io, read and register route in server/_core/index.ts, all api should start with '/api/' so that the gateway can route correctly
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(async opts => {
      if (!opts.ctx.user) return null;
      const user = await reconcileCrmAccessForUser(opts.ctx.user);
      return toPublicAuthUser(user);
    }),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      clearAllSessionCookies(ctx.req, ctx.res);
      ctx.res.clearCookie("login_scope", {
        ...cookieOptions,
        httpOnly: false,
        maxAge: -1,
      });
      return {
        success: true,
      } as const;
    }),
  }),

  localAuth: localAuthRouter,
  wechatAuth: wechatAuthRouter,
  wechatMiniProgramNotifications: wechatMiniProgramNotificationsRouter,
  wechatServiceNotifications: wechatServiceNotificationsRouter,
  company: companyRouter,
  companyReview: companyReviewRouter,
  coffeeVoucher: coffeeVoucherRouter,
  channelInventory: channelInventoryRouter,
  inventory: inventoryRouter,
  search: searchRouter,
  guestQuery: guestQueryRouter,
  cart: cartRouter,
  address: addressRouter,
  pickupPoint: pickupPointRouter,
  invoiceTitle: invoiceTitleRouter,
  order: orderRouter,
  payment: paymentRouter,
  inbound: inboundRouter,
  outbound: outboundRouter,
  customer: customerRouter,
  customerDemand: customerDemandRouter,
  crmSalesOrder: crmSalesOrderRouter,
  purchaseOrder: purchaseOrderRouter,
  stockBoard: stockBoardRouter,
  importInventory: importInventoryRouter,
  chat: chatRouter,
  forum: forumRouter,
  publicReview: publicReviewRouter,
  demand: demandRouter,
  market: marketRouter,
  recommendation: recommendationRouter,
  material: materialRouter,
  inquiry: inquiryRouter,
  enterprise: enterpriseRouter,
  internalCrm: internalCrmRouter,
  internalOrder: internalOrderRouter,
  internalUser: internalUserRouter,
  internalEnterprise: internalEnterpriseRouter,
  internalBusiness: internalBusinessRouter,
  internalCompanyMedia: internalCompanyMediaRouter,
  internalSpotVerification: internalSpotVerificationRouter,
  internalAgencyCertification: internalAgencyCertificationRouter,
  bom: bomRouter,
  siteAnalytics: siteAnalyticsRouter,
});

export type AppRouter = typeof appRouter;
