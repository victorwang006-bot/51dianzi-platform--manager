import { COOKIE_NAME } from "@shared/const";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { getSessionCookieOptions } from "./_core/cookies";
import { invokeLLM } from "./_core/llm";
import { notifyOwner } from "./_core/notification";
import { systemRouter } from "./_core/systemRouter";
import { protectedProcedure, publicProcedure, router } from "./_core/trpc";
import * as db from "./db";
import * as financeDb from "./financeHelpers";

// 管理员权限中间件：要求 role 为 admin
const adminProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (ctx.user.role !== "admin") {
    throw new TRPCError({ code: "FORBIDDEN", message: "需要管理员权限" });
  }
  return next({ ctx });
});

// 审计辅助：将管理操作写入审计日志
async function audit(
  ctx: { user: { id: number; name: string | null; role: string } },
  action: string,
  module: string,
  targetType?: string,
  targetId?: string,
  beforeValue?: unknown,
  afterValue?: unknown,
  note?: string,
) {
  try {
    await db.addAuditLog({
      operatorId: ctx.user.id,
      operatorName: ctx.user.name ?? "未知",
      operatorRole: ctx.user.role,
      action,
      module,
      targetType,
      targetId,
      beforeValue,
      afterValue,
      note,
    });
  } catch (e) {
    console.error("[Audit] Failed to write audit log:", e);
  }
}

// 告警辅助：创建告警并通知平台负责人
async function raiseAlert(params: {
  alertType: string;
  severity: "info" | "warning" | "critical";
  title: string;
  content?: string;
  relatedType?: string;
  relatedId?: string;
}) {
  try {
    await db.createAlert(params);
    // 关键告警自动通知平台运营负责人
    if (params.severity === "critical" || params.severity === "warning") {
      await notifyOwner({
        title: `【51电子网告警】${params.title}`,
        content: params.content ?? params.title,
      });
    }
  } catch (e) {
    console.error("[Alert] Failed to raise alert:", e);
  }
}

const pageInput = z.object({
  page: z.number().min(1).default(1),
  pageSize: z.number().min(1).max(100).default(20),
});

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),

  // ─── 仪表盘 ─────────────────────────────────────────────────────────────
  dashboard: router({
    stats: adminProcedure.query(async () => {
      return db.getDashboardStats();
    }),
    recentOrders: adminProcedure.query(async () => {
      return db.getRecentOrders(8);
    }),
    recentAlerts: adminProcedure.query(async () => {
      const result = await db.getAlerts({ status: "open", page: 1, pageSize: 5 });
      return result.data;
    }),
  }),

  // ─── 商户管理 ────────────────────────────────────────────────────────────
  merchant: router({
    list: adminProcedure
      .input(pageInput.extend({ status: z.string().optional(), search: z.string().optional() }))
      .query(async ({ input }) => {
        return db.getMerchants(input);
      }),
    detail: adminProcedure.input(z.object({ id: z.number() })).query(async ({ input }) => {
      return db.getMerchantById(input.id);
    }),
    review: adminProcedure
      .input(z.object({
        id: z.number(),
        action: z.enum(["approve", "reject", "supplement", "suspend", "terminate", "reactivate"]),
        note: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const statusMap: Record<string, string> = {
          approve: "approved",
          reject: "terminated",
          supplement: "supplement",
          suspend: "suspended",
          terminate: "terminated",
          reactivate: "approved",
        };
        const before = await db.getMerchantById(input.id);
        await db.updateMerchantStatus(input.id, statusMap[input.action], input.note, ctx.user.id);
        await audit(ctx, `商户${input.action === "approve" ? "审核通过" : input.action === "reject" ? "审核拒绝" : input.action === "supplement" ? "要求补件" : input.action === "suspend" ? "暂停" : input.action === "terminate" ? "清退" : "恢复"}`, "商户管理", "merchant", String(input.id), { status: before?.status }, { status: statusMap[input.action] }, input.note);
        return { success: true };
      }),
  }),

  // ─── 商品管理 ────────────────────────────────────────────────────────────
  product: router({
    list: adminProcedure
      .input(pageInput.extend({ status: z.string().optional(), search: z.string().optional(), merchantId: z.number().optional() }))
      .query(async ({ input }) => {
        return db.getProducts(input);
      }),
    review: adminProcedure
      .input(z.object({
        id: z.number(),
        action: z.enum(["approve", "reject", "activate", "deactivate", "ban"]),
        note: z.string().optional(),
        banReason: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const statusMap: Record<string, string> = {
          approve: "active",
          reject: "draft",
          activate: "active",
          deactivate: "inactive",
          ban: "banned",
        };
        await db.updateProductStatus(input.id, statusMap[input.action], input.note, input.banReason, ctx.user.id);
        await audit(ctx, `商品${input.action === "approve" ? "审核通过" : input.action === "reject" ? "审核拒绝" : input.action === "activate" ? "上架" : input.action === "deactivate" ? "下架" : "禁售"}`, "商品管理", "product", String(input.id), undefined, { status: statusMap[input.action] }, input.note ?? input.banReason);
        return { success: true };
      }),
    categories: adminProcedure.query(async () => {
      return db.getCategories();
    }),
    listByMerchant: adminProcedure
      .input(z.object({ status: z.string().optional(), search: z.string().optional() }))
      .query(async ({ input }) => {
        return db.getProductsGroupedByMerchant(input);
      }),
  }),

  // ─── 订单中心 ────────────────────────────────────────────────────────────
  order: router({
    list: adminProcedure
      .input(pageInput.extend({ status: z.string().optional(), search: z.string().optional(), merchantId: z.number().optional() }))
      .query(async ({ input }) => {
        return db.getOrders(input);
      }),
    detail: adminProcedure.input(z.object({ id: z.number() })).query(async ({ input }) => {
      const order = await db.getOrderById(input.id);
      const logs = await db.getOrderStatusLogs(input.id);
      return { order, logs };
    }),
    updateStatus: adminProcedure
      .input(z.object({
        id: z.number(),
        toStatus: z.enum(["cancelled", "abnormal", "processing", "completed"]),
        note: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        await db.updateOrderStatus(input.id, input.toStatus, ctx.user.id, ctx.user.name ?? "管理员", input.note);
        await audit(ctx, `订单状态变更为${input.toStatus}`, "订单中心", "order", String(input.id), undefined, { status: input.toStatus }, input.note);
        return { success: true };
      }),
  }),

  // ─── 退款管理 ────────────────────────────────────────────────────────────
  refund: router({
    list: adminProcedure
      .input(pageInput.extend({ status: z.string().optional(), search: z.string().optional() }))
      .query(async ({ input }) => {
        return db.getRefunds(input);
      }),
    review: adminProcedure
      .input(z.object({
        id: z.number(),
        action: z.enum(["approve", "reject", "execute", "complete", "fail"]),
        note: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const statusMap: Record<string, string> = {
          approve: "approved",
          reject: "rejected",
          execute: "executing",
          complete: "completed",
          fail: "failed",
        };
        await db.updateRefundStatus(input.id, statusMap[input.action], input.note, ctx.user.id);
        await audit(ctx, `退款${input.action === "approve" ? "审核通过" : input.action === "reject" ? "审核拒绝" : input.action === "execute" ? "执行中" : input.action === "complete" ? "完成" : "失败"}`, "售后退款", "refund", String(input.id), undefined, { status: statusMap[input.action] }, input.note);
        // 退款失败自动告警
        if (input.action === "fail") {
          await raiseAlert({
            alertType: "refund_abnormal",
            severity: "critical",
            title: `退款执行失败（退款单 #${input.id}）`,
            content: `退款单 #${input.id} 执行失败，请财务人员立即核查。备注：${input.note ?? "无"}`,
            relatedType: "refund",
            relatedId: String(input.id),
          });
        }
        return { success: true };
      }),
  }),

  // ─── 财务账本 ────────────────────────────────────────────────────────────
  finance: router({
    summary: adminProcedure.query(async () => {
      return financeDb.getFinanceSummary();
    }),
    flows: adminProcedure
      .input(pageInput.extend({ flowType: z.string().optional(), status: z.string().optional(), search: z.string().optional() }))
      .query(async ({ input }) => {
        return db.getPaymentFlows(input);
      }),
    settlements: adminProcedure
      .input(pageInput.extend({ merchantId: z.number().optional(), status: z.string().optional() }))
      .query(async ({ input }) => {
        return financeDb.getSettlementBillsWithMerchant(input);
      }),
    generateSettlement: adminProcedure
      .input(z.object({ merchantId: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const bill = await financeDb.generateSettlementBill(input.merchantId, ctx.user.id);
        await audit(ctx, "生成结算单", "财务账本", "settlement", String(bill.id), undefined, { billNo: bill.settlementNo, netAmount: bill.netAmount });
        return bill;
      }),
    updateSettlement: adminProcedure
      .input(z.object({ id: z.number(), action: z.enum(["confirm", "pay", "paid", "fail"]), failReason: z.string().optional() }))
      .mutation(async ({ ctx, input }) => {
        const bill = await financeDb.updateSettlementStatus(input.id, input.action, input.failReason);
        await audit(ctx, `结算单${input.action === "confirm" ? "确认" : input.action === "pay" ? "发起打款" : input.action === "paid" ? "打款成功" : "打款失败"}`, "财务账本", "settlement", String(input.id));
        // 结算失败自动告警
        if (input.action === "fail") {
          await raiseAlert({
            alertType: "settlement_failed",
            severity: "critical",
            title: `结算单 ${bill?.billNo ?? `#${input.id}`} 打款失败`,
            content: `结算单 ${bill?.billNo ?? `#${input.id}`} 打款失败，请财务人员立即核查商户结算账户信息。${input.failReason ? `失败原因：${input.failReason}` : ""}`,
            relatedType: "settlement",
            relatedId: String(input.id),
          });
        }
        return { success: true };
      }),
  }),

  // ─── 审计中心 ────────────────────────────────────────────────────────────
  auditLog: router({
    list: adminProcedure
      .input(pageInput.extend({ module: z.string().optional(), search: z.string().optional() }))
      .query(async ({ input }) => {
        return db.getAuditLogs(input);
      }),
  }),

  // ─── 告警中心 ────────────────────────────────────────────────────────────
  alert: router({
    list: adminProcedure
      .input(pageInput.extend({ status: z.string().optional(), severity: z.string().optional(), alertType: z.string().optional() }))
      .query(async ({ input }) => {
        return db.getAlerts(input);
      }),
    updateStatus: adminProcedure
      .input(z.object({ id: z.number(), status: z.enum(["acknowledged", "resolved", "ignored"]) }))
      .mutation(async ({ ctx, input }) => {
        await db.updateAlertStatus(input.id, input.status, ctx.user.id);
        await audit(ctx, `告警状态变更为${input.status === "acknowledged" ? "已确认" : input.status === "resolved" ? "已解决" : "已忽略"}`, "告警中心", "alert", String(input.id));
        return { success: true };
      }),
    // 一键巡检：扫描卡单超时与资质到期，自动生成告警并通知负责人
    scan: adminProcedure.mutation(async ({ ctx }) => {
      const created: string[] = [];
      // 1. 卡单超时：已支付超过72小时未发货
      const stuckOrders = await db.getStuckOrders(72);
      for (const o of stuckOrders) {
        const exists = await db.hasOpenAlert("stuck_order", "order", String(o.id));
        if (!exists) {
          await raiseAlert({
            alertType: "stuck_order",
            severity: "warning",
            title: `订单 ${o.orderNo} 支付后超过72小时未发货`,
            content: `订单已支付但商户超过72小时未发货，请运营人员跟进催促或协助取消。买家：${o.buyerName ?? "未知"}，金额：¥${o.totalAmount}。`,
            relatedType: "order",
            relatedId: String(o.id),
          });
          created.push(`卡单：${o.orderNo}`);
        }
      }
      // 2. 资质到期：营业执照60天内到期
      const expiringMerchants = await db.getExpiringMerchants(60);
      for (const m of expiringMerchants) {
        const exists = await db.hasOpenAlert("license_expiry", "merchant", String(m.id));
        if (!exists) {
          const days = m.licenseExpiry ? Math.max(0, Math.ceil((new Date(m.licenseExpiry).getTime() - Date.now()) / 86400000)) : 0;
          await raiseAlert({
            alertType: "license_expiry",
            severity: days <= 30 ? "critical" : "warning",
            title: `商户「${m.companyName}」营业执照${days}天后到期`,
            content: `该商户营业执照将于${days}天后到期，请通知商户及时更新资质材料，逾期将自动暂停其经营权限。`,
            relatedType: "merchant",
            relatedId: String(m.id),
          });
          created.push(`资质到期：${m.companyName}`);
        }
      }
      await audit(ctx, "执行告警巡检", "告警中心", "system", "scan", undefined, { created });
      return { success: true, createdCount: created.length, created };
    }),
  }),

  // ─── 智能风控（LLM）─────────────────────────────────────────────────────
  risk: router({
    list: adminProcedure
      .input(pageInput.extend({ targetType: z.string().optional(), riskLevel: z.string().optional(), status: z.string().optional() }))
      .query(async ({ input }) => {
        return db.getRiskAnalyses(input);
      }),
    analyzeOrder: adminProcedure
      .input(z.object({ orderId: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const order = await db.getOrderById(input.orderId);
        if (!order) throw new TRPCError({ code: "NOT_FOUND", message: "订单不存在" });
        const logs = await db.getOrderStatusLogs(input.orderId);

        const prompt = `你是电子元器件交易平台的风控分析专家。请分析以下订单数据，识别潜在风险，并给出风险等级和处置建议。

订单信息：
- 订单号：${order.orderNo}
- 买家：${order.buyerName ?? "未知"}
- 商品：${order.productName ?? "未知"}
- 数量：${order.qty}
- 单价：¥${order.unitPrice}
- 总金额：¥${order.totalAmount}
- 当前状态：${order.status}
- 异常标签：${order.abnormalTag ?? "无"}
- 创建时间：${order.createdAt}
- 支付时间：${order.paidAt ?? "未支付"}

状态变更记录：
${logs.map(l => `- ${l.createdAt}: ${l.fromStatus ?? "初始"} → ${l.toStatus}${l.note ? `（${l.note}）` : ""}`).join("\n") || "无"}

请以JSON格式输出分析结果。`;

        const response = await invokeLLM({
          messages: [
            { role: "system", content: "你是专业的电商平台风控分析师，输出严格遵循指定的JSON格式。" },
            { role: "user", content: prompt },
          ],
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "risk_analysis",
              strict: true,
              schema: {
                type: "object",
                properties: {
                  riskLevel: { type: "string", enum: ["low", "medium", "high", "critical"], description: "风险等级" },
                  riskSummary: { type: "string", description: "风险摘要，100-200字" },
                  suggestions: { type: "string", description: "处置建议，分条列出" },
                },
                required: ["riskLevel", "riskSummary", "suggestions"],
                additionalProperties: false,
              },
            },
          },
        });

        const content = response.choices[0]?.message?.content;
        const contentStr = typeof content === "string" ? content : JSON.stringify(content);
        const analysis = JSON.parse(contentStr ?? "{}");

        await db.saveRiskAnalysis({
          targetType: "order",
          targetId: String(input.orderId),
          riskLevel: analysis.riskLevel ?? "low",
          riskSummary: analysis.riskSummary ?? "",
          suggestions: analysis.suggestions ?? "",
          rawData: { orderNo: order.orderNo, totalAmount: order.totalAmount },
        });

        await audit(ctx, "发起订单智能风控分析", "智能风控", "order", String(input.orderId));

        // 高风险自动告警
        if (analysis.riskLevel === "high" || analysis.riskLevel === "critical") {
          await raiseAlert({
            alertType: "risk_merchant",
            severity: "critical",
            title: `订单 ${order.orderNo} 被识别为${analysis.riskLevel === "critical" ? "极高" : "高"}风险`,
            content: analysis.riskSummary,
            relatedType: "order",
            relatedId: String(input.orderId),
          });
        }

        return { success: true, analysis };
      }),
    analyzeMerchant: adminProcedure
      .input(z.object({ merchantId: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const merchant = await db.getMerchantById(input.merchantId);
        if (!merchant) throw new TRPCError({ code: "NOT_FOUND", message: "商户不存在" });
        const orderResult = await db.getOrders({ merchantId: input.merchantId, page: 1, pageSize: 50 });

        const prompt = `你是电子元器件交易平台的风控分析专家。请分析以下商户的经营行为，识别可疑模式（如刷单、价格异常、高退款率等），给出风险等级和处置建议。

商户信息：
- 商户编号：${merchant.merchantNo}
- 公司名称：${merchant.companyName}
- 状态：${merchant.status}
- 协议状态：${merchant.agreementStatus}
- 营业执照到期：${merchant.licenseExpiry ?? "未知"}
- 佣金费率：${merchant.commissionRate}
- 入驻时间：${merchant.createdAt}

近期订单（最多50条）：
${orderResult.data.map(o => `- ${o.orderNo}: ¥${o.totalAmount}, 状态${o.status}, 买家${o.buyerName ?? "未知"}`).join("\n") || "无订单"}

请以JSON格式输出分析结果。`;

        const response = await invokeLLM({
          messages: [
            { role: "system", content: "你是专业的电商平台风控分析师，输出严格遵循指定的JSON格式。" },
            { role: "user", content: prompt },
          ],
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "risk_analysis",
              strict: true,
              schema: {
                type: "object",
                properties: {
                  riskLevel: { type: "string", enum: ["low", "medium", "high", "critical"], description: "风险等级" },
                  riskSummary: { type: "string", description: "风险摘要，100-200字" },
                  suggestions: { type: "string", description: "处置建议，分条列出" },
                },
                required: ["riskLevel", "riskSummary", "suggestions"],
                additionalProperties: false,
              },
            },
          },
        });

        const content = response.choices[0]?.message?.content;
        const contentStr = typeof content === "string" ? content : JSON.stringify(content);
        const analysis = JSON.parse(contentStr ?? "{}");

        await db.saveRiskAnalysis({
          targetType: "merchant",
          targetId: String(input.merchantId),
          riskLevel: analysis.riskLevel ?? "low",
          riskSummary: analysis.riskSummary ?? "",
          suggestions: analysis.suggestions ?? "",
          rawData: { merchantNo: merchant.merchantNo, companyName: merchant.companyName },
        });

        await audit(ctx, "发起商户智能风控分析", "智能风控", "merchant", String(input.merchantId));

        if (analysis.riskLevel === "high" || analysis.riskLevel === "critical") {
          await raiseAlert({
            alertType: "risk_merchant",
            severity: "critical",
            title: `商户 ${merchant.companyName} 被识别为${analysis.riskLevel === "critical" ? "极高" : "高"}风险`,
            content: analysis.riskSummary,
            relatedType: "merchant",
            relatedId: String(input.merchantId),
          });
        }

        return { success: true, analysis };
      }),
    updateStatus: adminProcedure
      .input(z.object({ id: z.number(), status: z.enum(["reviewed", "actioned", "dismissed"]) }))
      .mutation(async ({ ctx, input }) => {
        await db.updateRiskAnalysisStatus(input.id, input.status, ctx.user.id);
        await audit(ctx, `风控分析标记为${input.status === "reviewed" ? "已复核" : input.status === "actioned" ? "已处置" : "已驳回"}`, "智能风控", "risk_analysis", String(input.id));
        return { success: true };
      }),
  }),

  // ─── 管理员管理 ──────────────────────────────────────────────────────────
  admin: router({
    list: adminProcedure.input(pageInput).query(async ({ input }) => {
      return db.getAdminUsers(input);
    }),
  }),
});

export type AppRouter = typeof appRouter;
