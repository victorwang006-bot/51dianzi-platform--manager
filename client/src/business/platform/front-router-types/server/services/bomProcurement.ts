import { and, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "../db";
import { companies, inventories, users } from "../../drizzle/schema";
import {
  CART_TAX_RATE,
  hasSellingPrice,
  normalizeLadder,
  round2,
  unitPriceOf,
} from "../../../shared/cartUtils";
import { SUPPLIER_NAME_FALLBACK } from "../../../shared/supplierDisplayName";

/**
 * BOM 批量配单匹配引擎。
 *
 * 目标：把用户上传的 BOM 行逐条匹配到平台上「真正可成交」的现货，
 * 而不是仅仅料号字面命中。因此除料号外还要逐层校验品牌、封装、
 * 库存量、起订量与是否有可售价格，任一层不满足都给出明确原因，
 * 便于前端把不可成交的行转入询价流程。
 *
 * 设计要点：
 * - 一次 SQL 取回全部候选后在内存分组，避免逐行查询造成的 N+1；
 * - 料号比较统一走 NFKC 归一化 + 去空格 + 转大写，规避全角字符与大小写差异；
 * - 排除买家自己发布的库存，避免自买自卖；
 * - 金额一律 round2 后以字符串返回，避免浮点误差进入前端展示与后续结算。
 */

/** 单次匹配的 BOM 行数上限，与前端上传限制保持一致 */
export const BOM_MATCH_MAX_ROWS = 200;

export type BomMatchStatus =
  | "matched"
  | "not_found"
  | "brand_mismatch"
  | "package_mismatch"
  | "own_inventory"
  | "insufficient_stock"
  | "below_moq"
  | "price_negotiable";

export interface BomInputRow {
  /** Excel 原始行号，用于前端回溯定位，也是询价时的行标识 */
  excelRow: number;
  partNumber: string;
  quantity: number;
  brand?: string;
  pkg?: string;
  /** 位号 */
  reference?: string;
  note?: string;
}

export interface BomMatchedOffer {
  inventoryId: number;
  partNumber: string;
  brand: string | null;
  pkg: string | null;
  supplierId: number;
  supplierName: string | null;
  qtyOnSale: number;
  moq: number;
  leadTime: string | null;
  unitPriceEx: string;
  unitPriceIncl: string;
  subtotalEx: string;
  subtotalIncl: string;
}

export interface BomMatchRow extends BomInputRow {
  status: BomMatchStatus;
  reason: string;
  offer: BomMatchedOffer | null;
}

interface BomCandidate {
  id: number;
  partNumber: string;
  brand: string | null;
  pkg: string | null;
  qtyOnSale: number | null;
  priceEx: string | null;
  ladderPrices: unknown;
  moq: number | null;
  leadTime: string | null;
  supplierId: number;
  supplierName: string | null;
}

/** 料号/品牌/封装统一归一化：全角转半角、去首尾空格、转大写 */
function normalizeBomMatchText(value: unknown): string {
  return String(value ?? "")
    .normalize("NFKC")
    .trim()
    .toUpperCase();
}

function money(value: number): string {
  return round2(value).toFixed(2);
}

function failure(row: BomInputRow, status: BomMatchStatus, reason: string): BomMatchRow {
  return { ...row, status, reason, offer: null };
}

/**
 * 从同料号候选中挑出最优可成交报价。
 * 过滤顺序即失败原因的优先级：品牌 → 封装 → 自有库存 → 库存量 → 起订量 → 价格。
 */
function selectBestBomOffer(
  row: BomInputRow,
  candidates: BomCandidate[],
  buyerUserId: number,
): BomMatchRow {
  if (candidates.length === 0) {
    return failure(row, "not_found", "暂无匹配现货");
  }

  let eligible = [...candidates];

  // BOM 指定了品牌时必须完全一致，避免误配非目标品牌
  const brandKey = normalizeBomMatchText(row.brand);
  if (brandKey) {
    eligible = eligible.filter((item) => normalizeBomMatchText(item.brand) === brandKey);
    if (eligible.length === 0) {
      return failure(row, "brand_mismatch", "现货品牌与 BOM 不一致");
    }
  }

  const packageKey = normalizeBomMatchText(row.pkg);
  if (packageKey) {
    eligible = eligible.filter((item) => normalizeBomMatchText(item.pkg) === packageKey);
    if (eligible.length === 0) {
      return failure(row, "package_mismatch", "现货封装与 BOM 不一致");
    }
  }

  eligible = eligible.filter((item) => item.supplierId !== buyerUserId);
  if (eligible.length === 0) {
    return failure(row, "own_inventory", "仅匹配到本人发布的库存");
  }

  eligible = eligible.filter((item) => Number(item.qtyOnSale ?? 0) >= row.quantity);
  if (eligible.length === 0) {
    return failure(row, "insufficient_stock", "现货数量不足以满足本行需求");
  }

  eligible = eligible.filter((item) => row.quantity >= Number(item.moq || 1));
  if (eligible.length === 0) {
    return failure(row, "below_moq", "需求数量低于现货最小起订量");
  }

  // 面议价（无有效价格）不能自动成交，只能走询价
  const priced = eligible
    .filter((item) => hasSellingPrice(item.priceEx, item.ladderPrices))
    .map((item) => {
      const ladder = normalizeLadder(item.ladderPrices, item.priceEx, item.moq);
      const unitPrice = unitPriceOf(ladder, row.quantity);
      return { item, unitPrice };
    })
    .filter((result) => Number.isFinite(result.unitPrice) && result.unitPrice > 0)
    .sort(
      (a, b) =>
        a.unitPrice - b.unitPrice ||
        Number(b.item.qtyOnSale ?? 0) - Number(a.item.qtyOnSale ?? 0) ||
        a.item.id - b.item.id,
    );

  const best = priced[0];
  if (!best) {
    return failure(row, "price_negotiable", "匹配现货暂无可交易价格");
  }

  // 库存单价已为含税价，不再叠加税额。
  // unitPriceEx / subtotalEx 保留为价内税拆分后的未税值，仅供开票参考，
  // 与含税值相加关系恒成立，不影响买家实付金额。
  const unitPriceIncl = round2(best.unitPrice);
  const subtotalIncl = round2(best.unitPrice * row.quantity);
  const unitPriceEx = round2(unitPriceIncl / (1 + CART_TAX_RATE));
  const subtotalEx = round2(subtotalIncl / (1 + CART_TAX_RATE));

  return {
    ...row,
    status: "matched",
    reason: "已匹配最优现货",
    offer: {
      inventoryId: best.item.id,
      partNumber: best.item.partNumber,
      brand: best.item.brand,
      pkg: best.item.pkg,
      supplierId: best.item.supplierId,
      supplierName: best.item.supplierName,
      qtyOnSale: Number(best.item.qtyOnSale ?? 0),
      moq: Number(best.item.moq || 1),
      leadTime: best.item.leadTime,
      unitPriceEx: money(unitPriceEx),
      unitPriceIncl: money(unitPriceIncl),
      subtotalEx: money(subtotalEx),
      subtotalIncl: money(subtotalIncl),
    },
  };
}

/**
 * 批量匹配 BOM 行。返回顺序与入参一致，便于前端按行对齐渲染。
 * 服务端不保存上传的原始 Excel，只处理结构化行数据。
 */
export async function matchBomRows(
  rows: BomInputRow[],
  buyerUserId: number,
): Promise<BomMatchRow[]> {
  if (rows.length === 0) return [];
  if (rows.length > BOM_MATCH_MAX_ROWS) {
    throw new Error(`单次最多匹配 ${BOM_MATCH_MAX_ROWS} 条 BOM`);
  }

  const db = await getDb();
  if (!db) throw new Error("数据库未连接");

  const partKeys = Array.from(
    new Set(rows.map((row) => normalizeBomMatchText(row.partNumber)).filter(Boolean)),
  );
  if (partKeys.length === 0) {
    return rows.map((row) => failure(row, "not_found", "料号为空"));
  }

  // 用 SQL 侧归一化保证与内存侧归一化口径一致
  const partKeyExpression = sql`UPPER(TRIM(${inventories.partNumber}))`;
  const candidates = (await db
    .select({
      id: inventories.id,
      partNumber: inventories.partNumber,
      brand: inventories.brand,
      pkg: inventories.pkg,
      qtyOnSale: inventories.qtyOnSale,
      priceEx: inventories.priceEx,
      ladderPrices: inventories.ladderPrices,
      moq: inventories.moq,
      leadTime: inventories.leadTime,
      supplierId: inventories.userId,
      /*
       * 供应商名称必须与全站取同一口径（见 shared/supplierDisplayName.ts）：
       * 优先企业名，再回退用户姓名/账号。
       * 早期此处直接取 users.name，导致同一卖家在搜索页显示企业名、
       * 在 BOM 配单结果却显示个人用户名（如 victor），采购方无法识别交易对象。
       * 2026-08-17 自营平权：移除自营别名分支，自营与第三方同一回退链。
       */
      supplierName:
        sql<string>`COALESCE(${companies.companyName}, ${users.name}, ${users.username}, ${SUPPLIER_NAME_FALLBACK})`,
    })
    .from(inventories)
    .leftJoin(users, eq(inventories.userId, users.id))
    .leftJoin(companies, eq(companies.userId, inventories.userId))
    .where(
      and(eq(inventories.status, "published"), inArray(partKeyExpression, partKeys)),
    )) as unknown as BomCandidate[];

  const grouped = new Map<string, BomCandidate[]>();
  for (const candidate of candidates) {
    const key = normalizeBomMatchText(candidate.partNumber);
    const list = grouped.get(key) ?? [];
    list.push(candidate);
    grouped.set(key, list);
  }

  return rows.map((row) =>
    selectBestBomOffer(row, grouped.get(normalizeBomMatchText(row.partNumber)) ?? [], buyerUserId),
  );
}
