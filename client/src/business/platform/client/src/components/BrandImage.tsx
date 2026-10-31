import { cn } from "../lib/utils";
import { useEffect, useState, type ImgHTMLAttributes } from "react";

type BrandImageTone = "brand" | "inverse";

type BrandImageProps = ImgHTMLAttributes<HTMLImageElement> & {
  fallbackText?: string;
  fallbackClassName?: string;
  tone?: BrandImageTone;
};

export default function BrandImage({
  src,
  alt,
  className,
  fallbackText = "51",
  fallbackClassName,
  tone = "brand",
  onError,
  onClick,
  style,
  title,
  ...imageProps
}: BrandImageProps) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [src]);

  if (!src || failed) {
    return (
      <span
        role={alt ? "img" : undefined}
        aria-label={alt || undefined}
        aria-hidden={alt ? undefined : true}
        data-brand-image-fallback="true"
        onClick={onClick}
        style={style}
        title={title}
        className={cn(
          "inline-flex shrink-0 select-none items-center justify-center overflow-hidden font-black leading-none tracking-[-0.08em]",
          tone === "inverse" ? "text-white" : "bg-white text-[#185FA5]",
          className,
          fallbackClassName
        )}
      >
        {fallbackText}
      </span>
    );
  }

  return (
    <img
      {...imageProps}
      src={src}
      alt={alt}
      className={className}
      onClick={onClick}
      style={style}
      title={title}
      decoding={imageProps.decoding ?? "async"}
      onError={event => {
        onError?.(event);
        setFailed(true);
      }}
    />
  );
}
