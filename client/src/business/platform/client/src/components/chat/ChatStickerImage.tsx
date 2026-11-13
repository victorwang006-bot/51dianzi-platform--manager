import { useEffect, useState, type ImgHTMLAttributes } from "react";

type ChatStickerImageProps = Omit<ImgHTMLAttributes<HTMLImageElement>, "onError">;

/** 仅用于已知 sticker；未知历史 ID 继续走消息气泡原有占位分支。 */
export default function ChatStickerImage({ src, alt, className, style, ...imageProps }: ChatStickerImageProps) {
  const [failedSource, setFailedSource] = useState<string | null>(null);
  useEffect(() => { setFailedSource(null); }, [src]);
  const label = alt?.trim() || "表情";
  if (src && failedSource === src) {
    return <span role="img" aria-label={`${label}：表情暂不可用`} className={className}
      style={{ ...style, display: "flex", alignItems: "center", justifyContent: "center",
        minHeight: 64, padding: 8, boxSizing: "border-box", border: "1px solid #e5e7eb",
        borderRadius: 8, background: "#fff", color: "#6b7280", fontSize: 12, textAlign: "center" }}>
      {label} · 表情暂不可用
    </span>;
  }
  return <img {...imageProps} src={src} alt={alt} className={className} style={style}
    onError={() => { if (src) setFailedSource(src); }} />;
}
