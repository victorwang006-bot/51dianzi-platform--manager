import { logoHeaderMark, logoHomeWordmark } from "./homeLogo";
import logoWhiteUrl from "./brand/logo-white.png";

/**
 * 51电子网品牌资源集中映射。
 *
 * 导出名称保持历史兼容；具体二进制由 Vite 输出为同源内容哈希资源，避免
 * 把 Logo Base64 内联到首屏 JavaScript。蓝色标志和横向字标复用已经过
 * 像素哈希审计的无损 WebP，白色标志保留原始 PNG 二进制。
 */
export const logoNav = logoHeaderMark;
export const logoFull = logoHeaderMark;
export const logoWhite = logoWhiteUrl;
export const logoWordmark = logoHomeWordmark;
