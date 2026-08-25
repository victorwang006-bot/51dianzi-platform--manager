export type CompanyPhotoThumbnail = {
  base64: string;
  width: number;
  height: number;
  size: number;
};

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || "");
      resolve(result.includes(",") ? result.slice(result.indexOf(",") + 1) : result);
    };
    reader.onerror = () => reject(reader.error || new Error("读取缩略图失败"));
    reader.readAsDataURL(blob);
  });
}

export async function createCompanyPhotoThumbnail(file: File): Promise<CompanyPhotoThumbnail> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  try {
    const maxEdge = 800;
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("浏览器无法处理该图片");
    context.drawImage(bitmap, 0, 0, width, height);
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        result => result ? resolve(result) : reject(new Error("生成缩略图失败")),
        "image/webp",
        0.8,
      );
    });
    return { base64: await blobToBase64(blob), width, height, size: blob.size };
  } finally {
    bitmap.close();
  }
}
