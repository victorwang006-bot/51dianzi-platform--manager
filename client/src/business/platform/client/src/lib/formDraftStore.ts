import { businessStorageScope } from "../../../../BusinessScope";
/**
 * 表单草稿本地暂存。
 *
 * 为什么需要：
 * ERP 的录入表单（发布库存等）字段多、填写耗时，而页面切换会卸载组件、
 * useState 随之销毁。用户填了半页库存，点一下顶部导航去看订单，回来
 * 就是空表单 —— 而且全程没有任何提示，属于静默丢数据。
 *
 * 为什么用 localStorage 而不是 URL：
 * URL 适合存「用户选了什么」（少量、可枚举），不适合存「用户写了什么」。
 * 库存表单含型号、数量、单价、阶梯价、备注、照片等数十个字段，
 * 塞进 URL 会超出浏览器地址长度限制，且把报价信息暴露在地址栏并不合适。
 *
 * 为什么不用 sessionStorage：
 * sessionStorage 在标签页关闭后即失效。而本项目「功能模块间跳转新开页面」
 * 的规则会让用户频繁开关标签页，且浏览器崩溃/误关是草稿最需要兜底的场景，
 * 这些恰好都是 sessionStorage 覆盖不到的。
 *
 * 安全与隔离：
 * key 中带用户标识，避免同一台电脑上多账号切换时看到别人的草稿
 * （电子贸易场景下常有多人共用办公机的情况，价格属敏感信息）。
 * 同时设置过期时间，避免陈旧草稿在几周后突然弹出来干扰用户。
 */

/** 草稿有效期：7 天。够覆盖「周五填一半、周一继续」的真实节奏 */
const DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const KEY_PREFIX = "dianzi51:formDraft";

type DraftEnvelope<T> = {
  /** 保存时间戳（毫秒），用于过期判断与「上次编辑于」提示 */
  savedAt: number;
  data: T;
};

/** 生成隔离到「表单 + 用户」的存储键 */
export function draftStorageKey(formId: string, userId: string | number | null | undefined) {
  return `${KEY_PREFIX}:${businessStorageScope() ?? "unresolved"}:${formId}:${userId ?? "anonymous"}`;
}

/**
 * 读取草稿。
 * 任何异常（禁用存储、JSON 损坏、结构不符）都返回 null 而非抛错：
 * 草稿是辅助功能，绝不能因为它让整个页面打不开。
 */
export function loadFormDraft<T>(
  formId: string,
  userId: string | number | null | undefined
): { data: T; savedAt: number } | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(draftStorageKey(formId, userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DraftEnvelope<T>;
    if (!parsed || typeof parsed.savedAt !== "number" || parsed.data == null) return null;
    if (Date.now() - parsed.savedAt > DRAFT_TTL_MS) {
      window.localStorage.removeItem(draftStorageKey(formId, userId));
      return null;
    }
    return { data: parsed.data, savedAt: parsed.savedAt };
  } catch {
    return null;
  }
}

/** 写入草稿；存储不可用时静默失败，不影响表单填写 */
export function saveFormDraft<T>(
  formId: string,
  userId: string | number | null | undefined,
  data: T
): void {
  if (typeof window === "undefined") return;
  try {
    const envelope: DraftEnvelope<T> = { savedAt: Date.now(), data };
    window.localStorage.setItem(draftStorageKey(formId, userId), JSON.stringify(envelope));
  } catch {
    /*
     * 常见于隐私模式或存储配额耗尽。此时用户仍能正常填写并提交，
     * 只是失去草稿保护，不应打断操作或弹错误提示。
     */
  }
}

/** 清除草稿。表单成功提交或用户主动放弃后调用 */
export function clearFormDraft(
  formId: string,
  userId: string | number | null | undefined
): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(draftStorageKey(formId, userId));
  } catch {
    // 同上：清理失败不影响主流程，过期机制会兜底
  }
}

/**
 * 判断表单是否被用户改动过（即是否值得保存/提醒）。
 *
 * 为什么不能简单用 `JSON.stringify(a) !== JSON.stringify(b)`：
 * 键的顺序、数组内对象的字段顺序都会影响字符串结果，容易误判。
 * 这里逐字段比较，并对布尔型默认值（如「含税」默认 true）做正确处理 ——
 * 否则一进页面就被判定为「已填写」，离开时必然误弹确认框，
 * 那种狼来了式的提醒会让用户很快学会无脑点「离开」，反而失去保护作用。
 */
export function isFormDirty<T extends Record<string, unknown>>(current: T, empty: T): boolean {
  /*
   * 不用 Set 迭代：本项目 tsconfig 的 target 较低，
   * `for...of` 遍历 Set 会触发 downlevelIteration 编译错误。
   */
  const keys = Object.keys(current).concat(
    Object.keys(empty).filter(k => !Object.prototype.hasOwnProperty.call(current, k))
  );
  for (const key of keys) {
    const a = current[key];
    const b = empty[key];
    if (Array.isArray(a) || Array.isArray(b)) {
      const arrA = Array.isArray(a) ? a : [];
      const arrB = Array.isArray(b) ? b : [];
      /* 数组只比长度：阶梯价/照片这类字段「有没有加过」就是判断依据 */
      if (arrA.length !== arrB.length) return true;
      continue;
    }
    if (a !== b) return true;
  }
  return false;
}

/**
 * 把保存时间渲染成人读友好的提示。
 *
 * 近期用相对时间（「3 分钟前」比「14:23」更能让用户确认“就是我刚才那份”），
 * 超过一天则给出具体日期，以北京时间为准（与全站时间口径一致）。
 */
export function formatDraftTime(savedAt: number, now: number = Date.now()): string {
  const diffMs = now - savedAt;
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  return new Date(savedAt).toLocaleString("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/** 已登记的表单标识，集中管理避免各处硬编码字符串写错 */
export const FORM_DRAFT_IDS = {
  publishInventory: "publish-inventory",
} as const;
