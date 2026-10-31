import { z } from "zod";
import {
  INVENTORY_UPLOAD_LEAD_TIME_MAX_LENGTH,
  INVENTORY_UPLOAD_NOTE_MAX_LENGTH,
  INVENTORY_UPLOAD_WAREHOUSE_MAX_LENGTH,
} from "./inventoryUploadLimits";
import {
  COMPETITOR_DISPLAY_VALIDATION_MESSAGE,
  containsCompetitorDisplayName,
} from "./competitorDisplayPolicy";
import { detectForbiddenContent } from "./contentModeration";

/** The single authoritative inventory row validation used by the legacy route and asynchronous staging. */
export const importRowSchema = z.object({
  sourceRowNumber: z.number().int().min(2).optional(),
  partNumber: z.string().trim().min(1).max(128),
  brand: z.string({ error: "品牌不能为空，请在 Excel 中补充该列后重新导入" })
    .trim().min(1, "品牌不能为空，请在 Excel 中补充该列后重新导入")
    .max(64, "品牌最多 64 个字符"),
  category: z.string().trim().max(32).optional(),
  pkg: z.string().trim().max(32).optional(),
  dateCode: z.string({ error: "生产周期（Date Code） 不能为空，请在 Excel 中补充该列后重新导入" })
    .trim().min(1, "生产周期（Date Code） 不能为空，请在 Excel 中补充该列后重新导入")
    .max(32, "生产周期（Date Code） 最多 32 个字符"),
  qtyOnSale: z.number({ error: "上架数量不能为空，请在 Excel 中补充该列后重新导入" })
    .int("上架数量须为正整数").positive("上架数量须为正整数").max(2_147_483_647, "上架数量超过数据库上限"),
  qtyStock: z.number().int("实际库存须为正整数").positive("实际库存须为正整数")
    .max(2_147_483_647, "实际库存超过数据库上限").optional(),
  priceEx: z.number().positive().max(99_999_999.9999, "单价超过数据库上限").optional(),
  taxIncluded: z.boolean().default(true),
  moq: z.number().int().positive().max(2_147_483_647, "MOQ超过数据库上限").optional(),
  spq: z.number().int().positive().max(2_147_483_647, "SPQ超过数据库上限").optional(),
  leadTime: z.string({ error: "交期不能为空，请在 Excel 中补充该列后重新导入" })
    .trim().min(1, "交期不能为空，请在 Excel 中补充该列后重新导入")
    .max(INVENTORY_UPLOAD_LEAD_TIME_MAX_LENGTH, `交期最多${INVENTORY_UPLOAD_LEAD_TIME_MAX_LENGTH}个字符`),
  warehouseAddress: z.string().trim()
    .max(INVENTORY_UPLOAD_WAREHOUSE_MAX_LENGTH, `仓库地址最多${INVENTORY_UPLOAD_WAREHOUSE_MAX_LENGTH}个字符`).optional(),
  rohs: z.boolean().optional(),
  note: z.string().trim()
    .max(INVENTORY_UPLOAD_NOTE_MAX_LENGTH, `物料备注最多${INVENTORY_UPLOAD_NOTE_MAX_LENGTH}个字符`).optional(),
}).superRefine((row, ctx) => {
  for (const field of ["brand", "category"] as const) {
    if (containsCompetitorDisplayName(row[field])) {
      ctx.addIssue({ code: "custom", message: COMPETITOR_DISPLAY_VALIDATION_MESSAGE, path: [field] });
    }
  }
  if (row.qtyStock != null && row.qtyStock < row.qtyOnSale) {
    ctx.addIssue({ code: "custom", message: "实际库存须大于或等于上架数量", path: ["qtyStock"] });
  }
  if (row.partNumber.normalize("NFKC").trim().length > 128) {
    ctx.addIssue({ code: "custom", message: "型号标准化后超过128个字符", path: ["partNumber"] });
  }
  const noteVerdict = detectForbiddenContent(row.note);
  if (!noteVerdict.ok) {
    ctx.addIssue({ code: "custom", message: noteVerdict.message, path: ["note"] });
  }
}).refine(row => row.taxIncluded || (typeof row.priceEx === "number" && row.priceEx > 0), {
  message: "选择未税价时必须填写单价", path: ["priceEx"],
});
