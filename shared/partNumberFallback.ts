/**
 * 型号回退查找：兼容「库内短号」与「完整型号」两种写法。
 *
 * ── 背景 ──────────────────────────────────────────────────────────
 * 平台早期批量导入的 464 条 ST 物料，partNumber 被截去了尾部 2 位
 * 封装+温度等级标识（如库内存 STM32F038K6，真实料号为 STM32F038K6U6）。
 * 图片上传 API 文档明确记载「注意库内型号不含封装后缀」，运营脚本
 * 一直按短号上传图片。
 *
 * 2026-08 将 partNumber 补全为完整型号后，若接口仍只做精确匹配，
 * 运营按既有文档用短号上传会直接报「型号不存在」，图片上传链路中断。
 * 故需要回退查找，兼容两种写法。
 *
 * ── 为什么不复用 front/shared/partNumber.ts 的白名单 ────────────────
 * 那份白名单服务于「撮合」场景，其中 T6/T7 被【明确排除】——因为
 * T6/T7 是温度等级，撮合时把它们当同料会推错料，导致整批物料报废。
 *
 * 而本模块服务于「同一条记录的两种写法」场景：短号 STM32F038K6 与
 * 补全后的 STM32F038K6U6 指向【同一个物料 id】，不是两颗不同的料。
 * 两者语义相反，必须分开维护，不可共用同一份清单。
 */

/**
 * ST 封装 + 温度等级后缀（补全型号时被加回的那 2 位）。
 * 来源：生产库 464 条实测分布，与 package 字段严格对应。
 *   T6=370(LQFP)  U6=33(UFQFPN)  H6=24(BGA)
 *   Y6=16(WLCSP)  I6=14         P6=7(TSSOP)
 * 维护说明：发现新后缀直接在此追加，匹配逻辑无需改动。
 */
export const ST_PACKAGE_TEMP_SUFFIXES = [
  "T6", "T7", "T8",
  "U6", "U7",
  "H6", "H7",
  "Y6",
  "I6",
  "P6",
  "F6",
  "K6",
  "C6",
  "G6",
  "R6",
  "V6",
  "Z6",
] as const;

/**
 * 由短号推导出所有可能的完整型号候选。
 *
 * 仅做「短号 → 完整型号」单向扩展。反向（完整型号 → 短号）
 * 不需要处理，因为完整型号本身就能精确命中补全后的记录。
 *
 * @param shortPn 可能的短号
 * @returns 候选完整型号数组（不含入参本身）
 */
export function expandShortPartNumber(shortPn: string): string[] {
  const base = shortPn.trim().toUpperCase();
  if (!base) return [];
  // 仅对 ST 的 STM32 系列生效：其命名规则明确、后缀位数固定为 2。
  // 刻意不泛化到所有品牌——否则会为无关型号生成大量无效候选，
  // 增加误命中风险（例如把图片挂到另一颗真实存在的料上）。
  if (!/^STM32/.test(base)) return [];
  // 完整料号形如 STM32F103C8T6（13 位）。已达完整长度的不再扩展。
  if (base.length >= 13) return [];
  return ST_PACKAGE_TEMP_SUFFIXES.map(s => `${base}${s}`);
}

/**
 * 判断 full 是否为 short 补全封装后缀后的形态。
 * 用于校验回退命中的记录确实对应该短号，而非碰巧的其他料。
 */
export function isPackageSuffixExpansion(shortPn: string, full: string): boolean {
  const s = shortPn.trim().toUpperCase();
  const f = full.trim().toUpperCase();
  if (!s || !f || f.length <= s.length) return false;
  if (!f.startsWith(s)) return false;
  const suffix = f.slice(s.length);
  return (ST_PACKAGE_TEMP_SUFFIXES as readonly string[]).includes(suffix);
}
