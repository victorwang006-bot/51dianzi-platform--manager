import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import { trpc } from "../../../../api/business-trpc";

/**
 * 面单 OCR 上传识别组件。
 *
 * 用于发货表单：卖家上传面单照片，自动识别运单号与快递公司并回填。
 *
 * 三个关键的设计取向：
 *
 * 1. **识别结果必须经用户确认才回填**。快递100 官方明确声明
 *    「无法保证 100% 准确识别，请务必检查识别的数据是否正确」，
 *    因此这里展示识别结果与置信度，由用户点击「使用此结果」才写入表单。
 * 2. **快递公司给候选而非单一答案**。OCR 接口只返回运单号，不返回快递公司；
 *    快递公司靠本地单号规则推断，纯数字单号存在多家重合的情况，
 *    此时列出候选让用户选，比给一个可能错的默认值更安全。
 * 3. **前端做体积压缩**。面单 OCR 实时扣费，但体积超限被服务端拒绝
 *    并不会扣费——真正的问题是用户手机原图动辄 5MB 以上，直接上传必然失败。
 *    因此先在浏览器内缩放，既能通过限制又能加快上传。
 */

type Candidate = {
  code: string;
  name: string;
  confidence: number;
  reason: string;
};

type Props = {
  /** 关联订单 ID，服务端据此校验权限 */
  orderId?: number;
  /**
   * 用户确认使用识别结果时回调。
   * expressName 为中文快递公司名（可能为空串，表示未能确定）。
   */
  onApply: (result: { waybill: string; expressName: string }) => void;
};

/** 压缩后的最长边像素。面单文字较大，1600px 足够识别且体积可控 */
const MAX_EDGE = 1600;

/**
 * 在浏览器内压缩图片并转 base64（不含 data URI 头）。
 *
 * 用 canvas 重绘而非直接读原文件：手机拍照原图常有 4000px 以上宽度、
 * 体积超过 5MB，超出快递100 的 4M base64 限制。
 */
async function compressToBase64(file: File): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error("图片读取失败"));
    reader.readAsDataURL(file);
  });

  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("图片解析失败"));
    img.src = dataUrl;
  });

  const scale = Math.min(1, MAX_EDGE / Math.max(image.width, image.height));
  // 原图已在合理尺寸内时不重绘，避免二次压缩降低识别率
  if (scale >= 1 && dataUrl.length < 3.5 * 1024 * 1024) {
    return dataUrl.slice(dataUrl.indexOf(",") + 1);
  }

  const canvas = document.createElement("canvas");
  canvas.width = Math.round(image.width * scale);
  canvas.height = Math.round(image.height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("当前浏览器不支持图片压缩");
  // 面单多为白底黑字，先铺白底避免 PNG 透明区域转 JPEG 后变黑影响识别
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

  const out = canvas.toDataURL("image/jpeg", 0.9);
  return out.slice(out.indexOf(",") + 1);
}

export default function WaybillOcrUploader({ orderId, onApply }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{
    waybill: string;
    expressName: string;
    expressCode: string | null;
    candidates: Candidate[];
    receiverName: string;
    receiverMobile: string;
    cached: boolean;
  } | null>(null);
  /** 用户在候选中选择的快递公司中文名 */
  const [pickedName, setPickedName] = useState("");

  const { data: availability } = trpc.order.waybillOcrAvailability.useQuery();
  const ocrMut = trpc.order.recognizeWaybill.useMutation();

  const handleFile = useCallback(
    async (file: File) => {
      setBusy(true);
      setResult(null);
      try {
        const base64 = await compressToBase64(file);
        setPreview(`data:image/jpeg;base64,${base64}`);
        const res = await ocrMut.mutateAsync({ imageBase64: base64, orderId });
        setResult({
          waybill: res.waybill,
          expressName: res.expressName,
          expressCode: res.expressCode,
          candidates: res.candidates as Candidate[],
          receiverName: res.receiver?.name ?? "",
          receiverMobile: res.receiver?.mobile ?? "",
          cached: res.cached,
        });
        setPickedName(res.expressName || res.candidates[0]?.name || "");
        if (res.cached) {
          toast.info("该图片此前已识别过", {
            description: "本次直接使用历史结果，未消耗识别额度",
          });
        }
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "面单识别失败");
      } finally {
        setBusy(false);
        // 清空 input 值，否则重复选择同一文件不会触发 change 事件
        if (inputRef.current) inputRef.current.value = "";
      }
    },
    [ocrMut, orderId],
  );

  // 未开通时完全不渲染，避免用户点开后才知道不可用
  if (!availability?.enabled) return null;

  return (
    <div className="rounded-md border border-dashed border-[#c9d6e2] bg-[#f8fbfd] p-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="text-[12px] font-semibold text-[#3a5570]">
            上传面单照片自动识别
          </div>
          <div className="text-[11px] text-[#7f93a8] mt-0.5">
            支持 jpg/png，自动提取运单号并推断快递公司
          </div>
        </div>
        <button
          type="button"
          className="crm-btn shrink-0"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
        >
          {busy ? "识别中…" : "选择图片"}
        </button>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/jpg,image/png,image/bmp"
        className="hidden"
        onChange={e => {
          const file = e.target.files?.[0];
          if (file) void handleFile(file);
        }}
      />

      {preview && (
        <div className="mt-3 flex gap-3">
          <img
            src={preview}
            alt="面单预览"
            className="h-24 w-24 shrink-0 rounded border border-[#e3ebf2] object-cover"
          />
          <div className="min-w-0 flex-1">
            {busy && (
              <div className="text-[12px] text-[#7f93a8]">
                正在识别，请稍候…
              </div>
            )}
            {result && (
              <div className="space-y-2">
                <div className="text-[12px] text-[#333]">
                  运单号：
                  <span className="font-mono font-semibold">
                    {result.waybill}
                  </span>
                </div>

                {result.candidates.length > 0 ? (
                  <div>
                    <div className="text-[11px] text-[#7f93a8] mb-1">
                      快递公司（推断结果，请核对后选择）
                    </div>
                    <select
                      className="crm-input w-full text-[12px]"
                      value={pickedName}
                      onChange={e => setPickedName(e.target.value)}
                    >
                      {result.candidates.map(c => (
                        <option key={c.code} value={c.name}>
                          {c.name}（可信度 {Math.round(c.confidence * 100)}%·
                          {c.reason}）
                        </option>
                      ))}
                    </select>
                  </div>
                ) : (
                  <div className="text-[11px] text-[#A32D2D]">
                    无法从单号推断快递公司，请在上方手工选择
                  </div>
                )}

                {(result.receiverName || result.receiverMobile) && (
                  <div className="text-[11px] text-[#7f93a8]">
                    面单收件人：{result.receiverName} {result.receiverMobile}
                    <span className="ml-1 text-[#b0bfcd]">（供核对）</span>
                  </div>
                )}

                <button
                  type="button"
                  className="crm-btn crm-btn-primary text-[12px]"
                  onClick={() =>
                    onApply({
                      waybill: result.waybill,
                      expressName: pickedName,
                    })
                  }
                >
                  使用此结果填入表单
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="mt-2 text-[11px] leading-4 text-[#a0b1c2]">
        识别结果由快递100 提供，无法保证完全准确，请务必核对运单号与快递公司后再提交发货。
      </div>
    </div>
  );
}
