/**
 * 51电子网 LOGO 组件
 * 图片已上传至 Manus 静态存储，URL 硬编码在此文件中，不依赖外部资源，不会丢失。
 * 如需更换 LOGO，仅修改此文件中的 LOGO_URL 即可全局生效。
 */

const LOGO_URL = "/manus-storage/logo-51_f9722eb3.webp";

interface LogoProps {
  /** 图片高度，Tailwind class，默认 h-10 */
  className?: string;
  alt?: string;
}

export function Logo({ className = "h-10 w-auto object-contain", alt = "51电子网" }: LogoProps) {
  return <img src={LOGO_URL} alt={alt} className={className} />;
}

export { LOGO_URL };
