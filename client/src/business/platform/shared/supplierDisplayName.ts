/**
 * 供应商展示名的全站唯一口径。
 *
 * 背景：早期各处自行拼接供应商名，导致同一卖家在不同页面显示不同名称——
 * 搜索页显示企业名、BOM 配单显示个人用户名（如 victor）、购物车又显示另一种，
 * 采购方无法确认交易对象是谁。兜底文案也曾出现「认证商户」「认证供应商」「供应商」三种混用。
 *
 * 规则（优先级从高到低）：
 *   1. 企业名称 companies.companyName
 *   2. 用户姓名 users.name
 *   3. 登录账号 users.username
 *   4. 兜底 SUPPLIER_NAME_FALLBACK
 *
 * 新增任何展示供应商名的位置，必须使用本模块，不得自行拼接 COALESCE。
 * 服务端 SQL 用 supplierDisplayNameSql()，内存数据用 resolveSupplierDisplayName()。
 *
 * ── 自营平权（2026-08-17）────────────────────────────────────────────────
 * 此前自营主体享有两项展示特殊：名称被替换为平台自营别名，
 * 以及深蓝加粗高亮（#1e4e8f / 600）而其他商家为灰色常规（#555 / 500）。
 * 排序权重、流量分配等核心机制从未偏袒自营，但视觉上的差异仍会让入驻商家
 * 产生「平台在推自己货」的观感——商家看不到代码，只能从界面推断。
 *
 * 经业务决策，取消上述两项特殊：自营主体以工商全称与其他商家完全平等展示。
 * 因此本模块不再导出 SELF_OPERATOR_DISPLAY_NAME 与高亮样式常量，
 * resolveSupplierDisplayName / applySelfOperatorAlias 不再做自营改写。
 *
 * isSelfOperatorName 予以保留：日后若需按自营区分业务规则
 * （如自营质保、售后兜底、发票主体判定），可直接复用而无需重建口径。
 * 但**任何展示层不得再用它做名称或样式的差异化**，否则即为平权回退。
 */

/** 平台自营运营主体的工商注册名 */
export const SELF_OPERATOR_COMPANY_NAME = "深圳市智捷创芯信息科技有限公司";

/** 三级回退全部为空时的兜底文案（全站统一，不再混用「认证供应商」「供应商」） */
export const SUPPLIER_NAME_FALLBACK = "认证商户";

/**
 * 按全站口径计算供应商展示名（用于已取到内存的数据）。
 *
 * 自营与第三方走完全相同的回退链，不做任何区分。
 */
export function resolveSupplierDisplayName(input: {
  companyName?: string | null;
  userName?: string | null;
  username?: string | null;
}): string {
  const companyName = input.companyName?.trim();
  if (companyName) return companyName;
  const userName = input.userName?.trim();
  if (userName) return userName;
  const username = input.username?.trim();
  if (username) return username;
  return SUPPLIER_NAME_FALLBACK;
}

/**
 * 归一化已聚合出的展示名。
 *
 * 用于上游已算好名称、无法拆出三个字段的场景（如订单创建时取历史快照名）。
 * 平权后仅做空值兜底，不再改写自营名称。函数保留是为了两点：
 * 一是历史快照可能存有空串，仍需兜底；二是保持调用点签名稳定，
 * 避免为删除一层无副作用的调用而改动 6 处业务代码。
 */
export function applySelfOperatorAlias(name?: string | null): string {
  const trimmed = name?.trim();
  return trimmed || SUPPLIER_NAME_FALLBACK;
}

/**
 * 自营主体判定。
 *
 * 保留供业务规则使用（如自营质保、售后责任划分、发票主体判定）。
 * **不得用于展示层的名称替换或样式高亮**——那是已被取消的平权前行为。
 *
 * 判定只认工商注册名：平权后系统不再产生任何自营别名，
 * 历史快照中的旧平台别名已随本次变更一并订正为工商名。
 */
export function isSelfOperatorName(name?: string | null): boolean {
  return name?.trim() === SELF_OPERATOR_COMPANY_NAME;
}
