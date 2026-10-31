import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, quotaProcedure, router } from "../_core/trpc";
import {
  addToCart,
  getCartByUser,
  getCartCount,
  getInventoriesByIds,
} from "../db";
import { hasSellingPrice } from "../../../shared/cartUtils";
import { queryBomReferencePrice } from "../services/bomReferencePrice";
import {
  postInquiryToChat,
  submitAdminInquiry,
  type BomInquiryCardItem,
} from "../services/customerService";
import { BOM_MATCH_MAX_ROWS, matchBomRows } from "../services/bomProcurement";
import {
  BOM_INQUIRY_EXCEL_MIME,
  BOM_INQUIRY_MAX_ITEMS,
  buildBomInquiryExcel,
} from "../services/bomInquiryExcel";
import { storagePut } from "../storage";

/**
 * BOM 配单工作台后端。
 *
 * 业务链路：上传 BOM → 批量匹配现货（match）→ 有现货行一键加购（addToCart）
 * → 无现货行补第6批价格库参考价（referencePrice）→ 转询价单发后台并镜像到聊一聊（submitInquiry）。
 *
 * 服务端不保存用户上传的原始 Excel，只接收结构化行数据；
 * 询价时才生成一份标准化询价 Excel 落对象存储，供后台与用户下载。
 */

const positiveQuantity = z.number().int().positive().max(1e9);

const bomRowSchema = z.object({
  excelRow: z.number().int().min(2).max(1e6),
  partNumber: z
    .string()
    .max(128)
    .refine((value) => value.trim().length > 0, "料号不能为空"),
  quantity: positiveQuantity,
  brand: z.string().max(64).optional(),
  pkg: z.string().max(64).optional(),
  reference: z.string().max(255).optional(),
  note: z.string().max(200).optional(),
});

const inquiryItemSchema = bomRowSchema.extend({
  referencePrice: z.string().max(64).optional(),
  /** 兼容已打开的旧页面；服务端不再调用AI补价。 */
  aiPrice: z.string().max(64).optional(),
});

const referencePriceInput = z.object({
  partNumber: z
    .string()
    .max(128)
    .refine((value) => value.trim().length > 0),
});

/** 询价提交节流：同一用户 30 秒一次 */
const INQUIRY_THROTTLE_MS = 30_000;
const lastInquiryAt = new Map<number, number>();

/** 后台消息为 Markdown 表格，需转义竖线与换行，避免破坏表格结构 */
function tableCell(value: unknown): string {
  const text = String(value ?? "—")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\|/g, "｜")
    .trim();
  return text || "—";
}

/** 拼装发往后台的 BOM 询价 Markdown 内容 */
export function buildBomInquiryContent(
  items: Array<z.infer<typeof inquiryItemSchema>>,
  attachment?: { fileName: string; fileUrl: string },
): string {
  const lines = [
    `【BOM询价】共 ${items.length} 项`,
    "",
    "| 序号 | Excel行 | 料号 | 品牌 | 封装 | 数量 | 价格库参考 | 位号 | 备注 |",
    "| --- | ---: | --- | --- | --- | ---: | --- | --- | --- |",
    ...items.map(
      (item, index) =>
        `| ${index + 1} | ${item.excelRow} | ${tableCell(item.partNumber)} | ${tableCell(item.brand)} | ${tableCell(item.pkg)} | ${item.quantity} | ${tableCell(item.referencePrice ?? item.aiPrice)} | ${tableCell(item.reference)} | ${tableCell(item.note)} |`,
    ),
    "",
    ...(attachment
      ? [`询价Excel：[${tableCell(attachment.fileName)}](${attachment.fileUrl})`, ""]
      : []),
    "说明：价格库参考仅用于采购寻源，不构成交易价格；最终价格以供应商报价为准。",
  ];
  return lines.join("\n");
}

export const bomRouter = router({
  /**
   * 批量精确匹配现货；大输入使用 POST mutation，服务端不保存原始 Excel。
   *
   * 计入账号每日查询配额（quotaProcedure）：本接口会返回批量行情，
   * 不约束则可绕过搜索页配额大量取数。
   * 一次配单计 1 次而非按行计数：按行会让一张 300 行的 BOM
   * 直接吃掉6成配额，正常采购员无法使用。
   */
  match: quotaProcedure
    .input(z.object({ rows: z.array(bomRowSchema).min(1).max(BOM_MATCH_MAX_ROWS) }))
    .mutation(({ ctx, input }) => matchBomRows(input.rows, ctx.user.id)),

  /** 无现货行查询已审核的第6批价格库；与现货/BOM查询共享账户每日配额。 */
  referencePrice: quotaProcedure
    .input(referencePriceInput)
    .mutation(({ input }) => queryBomReferencePrice(input.partNumber)),

  /**
   * 兼容部署前已打开的旧BOM页面。该别名同样只查询第6批，不再调用AI。
   * 新页面不使用此过程，后续可在旧静态资源缓存自然失效后移除。
   */
  aiPrice: quotaProcedure
    .input(referencePriceInput)
    .mutation(({ input }) => queryBomReferencePrice(input.partNumber)),

  /** 一键加购：按 inventoryId 合并重复 BOM 行，并在写入前重新校验全部交易条件。 */
  addToCart: protectedProcedure
    .input(
      z.object({
        items: z
          .array(
            z.object({
              inventoryId: z.number().int().positive(),
              qty: positiveQuantity,
            }),
          )
          .min(1)
          .max(BOM_MATCH_MAX_ROWS),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const merged = new Map<number, number>();
      for (const item of input.items) {
        const nextQty = (merged.get(item.inventoryId) ?? 0) + item.qty;
        if (!Number.isSafeInteger(nextQty) || nextQty > 1e9) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "合并后的采购数量过大" });
        }
        merged.set(item.inventoryId, nextQty);
      }

      const inventoryList = await getInventoriesByIds(Array.from(merged.keys()));
      const inventoryMap = new Map(inventoryList.map((inventory) => [inventory.id, inventory]));
      const existingCart = await getCartByUser(ctx.user.id);
      const existingQty = new Map(existingCart.map((item) => [item.inventoryId, item.qty]));

      const skipped: Array<{ inventoryId: number; reason: string }> = [];
      let added = 0;
      let addedQty = 0;

      for (const [inventoryId, qty] of Array.from(merged.entries())) {
        const inventory = inventoryMap.get(inventoryId);
        if (!inventory || inventory.status !== "published") {
          skipped.push({ inventoryId, reason: "商品不存在或已下架" });
          continue;
        }
        if (inventory.userId === ctx.user.id) {
          skipped.push({ inventoryId, reason: "不能购买自己发布的库存" });
          continue;
        }
        if (!hasSellingPrice(inventory.priceEx, inventory.ladderPrices)) {
          skipped.push({ inventoryId, reason: "该商品价格面议，不能自动加入购物车" });
          continue;
        }
        if (inventory.taxIncluded === false) {
          skipped.push({ inventoryId, reason: "该商品为未税价，请通过聊一聊确认后采购" });
          continue;
        }
        const moq = Number(inventory.moq || 1);
        if (qty < moq) {
          skipped.push({ inventoryId, reason: `需求数量低于最小起订量 ${moq}` });
          continue;
        }
        const finalQty = Number(existingQty.get(inventoryId) ?? 0) + qty;
        if (finalQty > Number(inventory.qtyOnSale ?? 0)) {
          skipped.push({ inventoryId, reason: "加入后数量超过当前可售库存" });
          continue;
        }
        // 交由 addToCart 做原子上限校验，拦住并发加购造成的超卖
        const accepted = await addToCart(
          ctx.user.id,
          inventoryId,
          qty,
          Number(inventory.qtyOnSale ?? 0),
        );
        if (!accepted) {
          skipped.push({ inventoryId, reason: "并发加购后数量超过当前可售库存" });
          continue;
        }
        added += 1;
        addedQty += qty;
      }

      return {
        added,
        addedQty,
        skipped,
        cartCount: await getCartCount(ctx.user.id),
      };
    }),

  /** 将无合格现货行按表格发送到后台消息模块，并镜像为聊一聊 BOM 询价卡片。 */
  submitInquiry: protectedProcedure
    .input(z.object({ items: z.array(inquiryItemSchema).min(1).max(BOM_INQUIRY_MAX_ITEMS) }))
    .mutation(async ({ ctx, input }) => {
      const now = Date.now();
      const last = lastInquiryAt.get(ctx.user.id) ?? 0;
      if (now - last < INQUIRY_THROTTLE_MS) {
        throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "提交太频繁，请30秒后再试" });
      }

      // 二次匹配防错发：提交瞬间若已有可用现货，应引导回购物车而不是发询价
      const latestMatches = await matchBomRows(
        input.items.map((item) => ({
          excelRow: item.excelRow,
          partNumber: item.partNumber,
          quantity: item.quantity,
          brand: item.brand,
          pkg: item.pkg,
          reference: item.reference,
          note: item.note,
        })),
        ctx.user.id,
      );
      const newlyAvailable = latestMatches.filter((row) => row.status === "matched");
      if (newlyAvailable.length > 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `${newlyAvailable.length} 项已出现可用现货，请重新配单后加入购物车`,
        });
      }

      // 先按无附件内容预检长度，避免生成并上传 Excel 后才发现超限而白付存储代价
      const previewContent = buildBomInquiryContent(input.items);
      if (previewContent.length > 4400) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "询价表格内容超过上限，请减少备注或分批发送",
        });
      }

      const unmatchedReason = new Map(latestMatches.map((row) => [row.excelRow, row.reason]));
      const { fileName, buffer } = buildBomInquiryExcel(
        input.items.map((item) => ({
          ...item,
          unmatchedReason: unmatchedReason.get(item.excelRow) || "暂无匹配现货",
        })),
      );

      let attachment: { fileName: string; fileUrl: string };
      try {
        const stored = await storagePut(
          `bom-inquiries/${ctx.user.id}/${fileName}`,
          buffer,
          BOM_INQUIRY_EXCEL_MIME,
        );
        const siteBase = (process.env.PUBLIC_SITE_URL || "https://51dianzi.com").replace(
          /\/+$/,
          "",
        );
        attachment = {
          fileName,
          fileUrl: new URL(stored.url, `${siteBase}/`).toString(),
        };
      } catch (error) {
        console.error("[bom] 询价 Excel 上传失败:", error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "询价 Excel 生成或上传失败，请稍后重试",
        });
      }

      const content = buildBomInquiryContent(input.items, attachment);
      if (content.length > 5000) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "询价表格内容超过上限，请减少备注或分批发送",
        });
      }

      const subject = `BOM询价 - ${input.items.length}项 - ${input.items[0].partNumber.trim()}`.slice(
        0,
        256,
      );
      const result = await submitAdminInquiry({
        subject,
        content,
        threadType: "inquiry",
        user: ctx.user,
      });
      if (!result) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "BOM询价提交失败，请稍后重试或联系客服",
        });
      }

      lastInquiryAt.set(ctx.user.id, now);
      if (lastInquiryAt.size > 5000) lastInquiryAt.clear();

      const conversationId = await postInquiryToChat({
        card: {
          kind: "bom",
          totalItems: input.items.length,
          items: input.items as BomInquiryCardItem[],
          threadNo: result.threadNo,
          fileName: attachment.fileName,
          fileUrl: attachment.fileUrl,
        },
        user: { id: ctx.user.id },
      });

      return {
        ok: true as const,
        threadNo: result.threadNo,
        conversationId,
        fileName: attachment.fileName,
        fileUrl: attachment.fileUrl,
      };
    }),
});
