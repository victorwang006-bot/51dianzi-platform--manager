export type PublicReviewImage = {
  base64: string;
  previewUrl: string;
  width: number;
  height: number;
  byteSize: number;
};

export const PUBLIC_REVIEW_IMAGE_LIMIT = 3;
export const PUBLIC_REVIEW_IMAGE_MAX_SOURCE_BYTES = 8 * 1024 * 1024;
export const PUBLIC_REVIEW_IMAGE_MAX_OUTPUT_BYTES = 2 * 1024 * 1024;
export const PUBLIC_REVIEW_IMAGE_MIMES = ["image/jpeg", "image/png", "image/webp"] as const;

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const value = String(reader.result ?? "");
      const comma = value.indexOf(",");
      comma >= 0 ? resolve(value.slice(comma + 1)) : reject(new Error("图片读取失败"));
    };
    reader.onerror = () => reject(new Error("图片读取失败"));
    reader.readAsDataURL(blob);
  });
}

function canvasToWebp(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      blob => blob ? resolve(blob) : reject(new Error("图片压缩失败")),
      "image/webp",
      quality,
    );
  });
}

/**
 * 评价图片最长边压缩到 1600px 并重编码为 WebP。
 * Canvas 重编码会移除 EXIF/GPS 等元数据，公开展示时不泄露拍摄位置。
 */
export async function createPublicReviewImage(file: File): Promise<PublicReviewImage> {
  if (!PUBLIC_REVIEW_IMAGE_MIMES.includes(file.type as (typeof PUBLIC_REVIEW_IMAGE_MIMES)[number])) {
    throw new Error("仅支持 JPG、PNG、WebP 图片");
  }
  if (!file.size || file.size > PUBLIC_REVIEW_IMAGE_MAX_SOURCE_BYTES) {
    throw new Error("单张图片不能超过8MB");
  }

  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  try {
    const maxEdge = 1600;
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("浏览器无法处理该图片");
    context.drawImage(bitmap, 0, 0, width, height);

    let blob = await canvasToWebp(canvas, 0.84);
    for (const quality of [0.72, 0.6, 0.48]) {
      if (blob.size <= PUBLIC_REVIEW_IMAGE_MAX_OUTPUT_BYTES) break;
      blob = await canvasToWebp(canvas, quality);
    }
    if (blob.size > PUBLIC_REVIEW_IMAGE_MAX_OUTPUT_BYTES) {
      throw new Error("图片内容过大，请更换图片");
    }
    return {
      base64: await blobToBase64(blob),
      previewUrl: URL.createObjectURL(blob),
      width,
      height,
      byteSize: blob.size,
    };
  } finally {
    bitmap.close();
  }
}
