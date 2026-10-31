/**
 * 功能模块间跳转规则：新开页面，原页面保留。
 *
 * 为什么需要这个规则：
 * 电子元件采购的真实场景是「横向对比」——买家搜出一批报价后，需要逐个点进
 * 详情页看参数、看图片、看供应商资质，再回到结果列表对比下一家。如果详情页
 * 在当前标签打开，返回后搜索关键词、筛选条件、翻到的页码、展开的参数全部丢失，
 * 用户得从头再来一遍。BOM 配单更严重：上传解析好的几十行清单，点一个型号进
 * 详情页就整份丢掉。
 *
 * 边界（刻意不做一刀切）：
 * - 新开页：从「带工作状态的页面」进入另一个功能模块
 *   （搜索结果→商品详情、搜索页→上传BOM、BOM结果→商品详情、需求中心→商品详情）
 * - 不新开：同一功能内的操作（搜索、翻页、改筛选、加购物车、关注供应商）
 * - 不新开：导航栏的模块切换。那是纯浏览切换，若也新开页，用户在导航栏点几下
 *   就会积攒五六个标签，反而成为负担；浏览器返回键本就能回去。
 *
 * 安全说明：
 * 必须带 noopener，否则新页面可通过 window.opener 反向操纵原页面（钓鱼风险）。
 */

/**
 * 在新标签页打开站内路径，原页面保持不动。
 *
 * 不能再用 `window.open(..., "noopener,noreferrer")` 的返回值判断是否打开成功：
 * 浏览器在启用 noopener 时会按规范返回 null，即使新标签已经成功创建。旧实现把
 * 这个安全语义误判成弹窗被拦截，又调用 fallbackNavigate，导致一次点击同时打开
 * 新标签并把原搜索页跳到目标页。
 *
 * 这里改为临时原生链接，等价于用户点击
 * `<a target="_blank" rel="noopener noreferrer">`。调用点保留第二个参数仅为兼容
 * 现有签名，但不再做不可可靠判定的同页回退。
 */
export function openInNewTab(path: string, _fallbackNavigate?: (p: string) => void) {
  const link = document.createElement("a");
  link.href = path;
  link.target = NEW_TAB_LINK_PROPS.target;
  link.rel = NEW_TAB_LINK_PROPS.rel;
  link.style.display = "none";
  document.body.appendChild(link);
  try {
    link.click();
  } finally {
    link.remove();
  }
  return true;
}

/**
 * 供 <a> / <Link> 使用的属性，语义与 openInNewTab 一致。
 * 用于原本就是链接的元素，保留浏览器原生的「新标签打开/复制链接」右键菜单。
 */
export const NEW_TAB_LINK_PROPS = {
  target: "_blank",
  rel: "noopener noreferrer",
} as const;
