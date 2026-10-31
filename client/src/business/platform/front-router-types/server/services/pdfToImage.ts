import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * PDF 首页转 JPEG。
 *
 * 用途：阿里云 RecognizeBusinessLicense 不支持 PDF
 * （官方文档明示仅支持 PNG/JPG/JPEG/BMP/GIF/TIFF/WebP），
 * 因此 PDF 版营业执照需先转成图片再送识别。
 *
 * 安全约定（务必保持）：
 *  - 一律使用 execFile + 参数数组，绝不拼接 shell 命令
 *  - 临时文件名由服务端生成（randomUUID），绝不使用用户上传的文件名
 *  - 全流程带超时，避免畸形 PDF 卡住工作进程
 *  - finally 中清理临时目录，异常路径同样清理
 */

/** 只转第 1 页：营业执照均为单页，多转无意义且浪费资源 */
const PAGE = "1";
/** 200 dpi 实测足够清晰（A4 → 1654×2339），再高只增体积不提准确率 */
const DPI = "200";
/** 转换超时：实测正常单页仅需约 50ms，15s 足以覆盖异常情况 */
const TIMEOUT_MS = 15_000;
/** 输入上限，与上传接口的 10MB 限制保持一致 */
const MAX_INPUT_BYTES = 10 * 1024 * 1024;

export class PdfConvertError extends Error {
  constructor(
    message: string,
    readonly reason: "unavailable" | "timeout" | "invalid" | "failed",
  ) {
    super(message);
    this.name = "PdfConvertError";
  }
}

let cachedAvailable: boolean | null = null;

/**
 * 探测 pdftoppm 是否可用。
 *
 * 这是**服务器环境依赖**而非代码依赖：迁移服务器或重建机器时若忘记
 * 安装 poppler-utils，此处会返回 false，调用方据此降级为手工填写，
 * 而不是抛错阻塞上传。
 */
export async function isPdfConvertAvailable(): Promise<boolean> {
  if (cachedAvailable !== null) return cachedAvailable;
  try {
    await execFileAsync("pdftoppm", ["-v"], { timeout: 5_000 });
    cachedAvailable = true;
  } catch {
    cachedAvailable = false;
  }
  return cachedAvailable;
}

/** 仅供测试重置探测缓存 */
export function resetPdfConvertAvailabilityCache() {
  cachedAvailable = null;
}

/** PDF 魔数校验：%PDF-，防止伪装扩展名的文件进入转换流程 */
export function looksLikePdf(buffer: Buffer): boolean {
  return buffer.length >= 5 && buffer.subarray(0, 5).toString("latin1") === "%PDF-";
}

/**
 * 将 PDF 首页转换为 JPEG buffer。
 * 失败一律抛 PdfConvertError，由调用方决定降级行为。
 */
export async function convertPdfFirstPageToJpeg(pdf: Buffer): Promise<Buffer> {
  if (pdf.length === 0 || pdf.length > MAX_INPUT_BYTES) {
    throw new PdfConvertError("PDF 文件大小无效", "invalid");
  }
  if (!looksLikePdf(pdf)) {
    throw new PdfConvertError("文件不是有效的 PDF", "invalid");
  }
  if (!(await isPdfConvertAvailable())) {
    throw new PdfConvertError("服务器未安装 PDF 转换组件", "unavailable");
  }

  // 目录名与文件名均由服务端生成，不含任何用户输入
  const dir = await mkdtemp(join(tmpdir(), "license-pdf-"));
  const input = join(dir, `${randomUUID()}.pdf`);
  const outPrefix = join(dir, randomUUID());

  try {
    await writeFile(input, pdf);
    await execFileAsync(
      "pdftoppm",
      [
        "-jpeg",
        "-r", DPI,
        "-f", PAGE,
        "-l", PAGE,
        // -singlefile 让输出固定为 <prefix>.jpg，避免 -1/-01 页码后缀的差异
        "-singlefile",
        input,
        outPrefix,
      ],
      { timeout: TIMEOUT_MS, maxBuffer: 1024 * 1024 },
    );
    return await readFile(`${outPrefix}.jpg`);
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { killed?: boolean; signal?: string };
    if (e?.killed || e?.signal === "SIGTERM") {
      throw new PdfConvertError("PDF 转换超时", "timeout");
    }
    if (e?.code === "ENOENT" && String(e?.message ?? "").includes("pdftoppm")) {
      cachedAvailable = false;
      throw new PdfConvertError("服务器未安装 PDF 转换组件", "unavailable");
    }
    throw new PdfConvertError(`PDF 转换失败：${e?.message ?? "未知原因"}`, "failed");
  } finally {
    // 异常路径同样要清理，避免临时文件堆积
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
