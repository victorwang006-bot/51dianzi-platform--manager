import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { trpc } from "../../../../api/business-trpc";
import { normalizeCompanyCreditCode } from "../lib/companyCreditCode";
import { shouldSynchronizeCompanyFormFromQuery } from "../lib/companyFormSync";
import { normalizeBankAccountNumber } from "../../../shared/bankAccountNumber";
import HongKongCompanyForm from "./HongKongCompanyForm";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { Checkbox } from "./ui/checkbox";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import {
  ENTERPRISE_SERVICE_AGREEMENT_HASH,
  ENTERPRISE_SERVICE_AGREEMENT_VERSION,
} from "../../../shared/enterpriseServiceAgreementContent";
import { AlertCircle, CheckCircle2, Clock, FileText, Loader2, ShieldCheck, Sparkles, Upload } from "lucide-react";

// 仅用于ERP申请页下拉展示。表单保存的salesOwner与salesOwnerCode仍使用后台原始姓名和工号。
const SALES_OWNER_DISPLAY_LABELS: Record<string, string> = {
  "倪先明": "Jack",
  "周雨琦": "Yuki",
};

function salesOwnerDisplayLabel(name: string): string {
  return SALES_OWNER_DISPLAY_LABELS[name] || name;
}

/**
 * 企业资料表单（可复用）：
 * - CRM 工作台「企业信息」页（/company）
 * - 商城侧「开通 CRM」页（/crm-apply，提交企业信息后自动开通 CRM 权限）
 */
export function useCertBadge(certLevel: string) {
  return certLevel === "premium" ? (
    <Badge className="bg-[#185FA5] text-white hover:bg-[#185FA5] shadow-none gap-1">
      <ShieldCheck className="w-3 h-3" /> 高级认证
    </Badge>
  ) : certLevel === "certified" ? (
    <Badge className="bg-[#EAF3DE] text-[#3B6D11] hover:bg-[#EAF3DE] shadow-none gap-1">
      <ShieldCheck className="w-3 h-3" /> 已认证
    </Badge>
  ) : (
    <Badge className="bg-[#FAEEDA] text-[#854F0B] hover:bg-[#FAEEDA] shadow-none">
      待审核
    </Badge>
  );
}

export type CompanyFormProps = {
  saveButtonText?: string;
  /** 保存成功后的回调（如：商城侧开通 CRM 后跳转） */
  onSaved?: () => void;
  /** CRM 申请必须走后台专用审核协议；普通企业资料继续保留本地审核流程。 */
  submissionMode?: "company-profile" | "crm-application";
};

/** 中国内地表单：字段、校验、上传和审核流保持原实现。 */
function MainlandCompanyForm({
  saveButtonText = "保存企业资料",
  onSaved,
  submissionMode = "company-profile",
  onBusyChange,
}: CompanyFormProps & { onBusyChange?: (busy: boolean) => void }) {
  const utils = trpc.useUtils();
  const { data: company, isLoading } = trpc.company.get.useQuery();
  const { data: currentUser } = trpc.auth.me.useQuery();
  const enterpriseAgreementQuery = trpc.company.enterpriseAgreementStatus.useQuery();
  // 销售负责人名单来自后台启用人员，不在前端硬编码员工姓名
  const salesStaffQuery = trpc.company.salesStaff.useQuery();
  const fileRef = useRef<HTMLInputElement>(null);
  /** 银行资料上传控件（与执照分开，两者可各自独立上传） */
  const bankFileRef = useRef<HTMLInputElement>(null);
  const bankUploadButtonRef = useRef<HTMLButtonElement>(null);
  const agreementRef = useRef<HTMLDivElement>(null);
  const agreementCheckboxRef = useRef<HTMLButtonElement>(null);
  const agreementAttentionTimerRef = useRef<number | null>(null);
  /** 上传阶段提示：compress=压缩中 upload=上传+AI识别中 */
  const [uploadStage, setUploadStage] = useState<"" | "compress" | "upload">("");
  /** 银行资料的上传阶段，独立于执照，避免两个按钮同时转圈 */
  const [bankUploadStage, setBankUploadStage] = useState<"" | "compress" | "upload">("");
  const [bankEvidenceUploaded, setBankEvidenceUploaded] = useState(false);
  const [agreementAccepted, setAgreementAccepted] = useState(false);
  const [agreementNeedsAttention, setAgreementNeedsAttention] = useState(false);
  /** AI识别已回填标志：为true时禁止 company.get 的空数据覆盖表单（修复回填被覆盖bug） */
  const aiFilledRef = useRef(false);
  /** 手填内容不得被上传后的资料刷新或后台查询覆盖。 */
  const formEditedRef = useRef(false);

  const [form, setForm] = useState({
    companyName: "",
    creditCode: "",
    companyType: "",
    legalPerson: "",
    companyRole: "",
    bankAccountName: "",
    bankAccountNumber: "",
    bankName: "",
    regAddress: "",
    establishedAt: "",
    salesOwner: "",
    salesOwnerCode: "",
  });
  const updateForm = (patch: Partial<typeof form>) => {
    formEditedRef.current = true;
    setForm(f => ({ ...f, ...patch }));
  };

  const bankLicenseUrl = (company as { bankLicenseAccessUrl?: string | null; bankLicenseUrl?: string | null } | null | undefined)
    ?.bankLicenseAccessUrl ?? (company as { bankLicenseUrl?: string | null } | null | undefined)?.bankLicenseUrl;
  const bankLicenseFileName = (
    company as { bankLicenseFileName?: string | null } | null | undefined
  )?.bankLicenseFileName;

  useEffect(() => {
    if (enterpriseAgreementQuery.data?.accepted) setAgreementAccepted(true);
  }, [enterpriseAgreementQuery.data?.accepted]);

  useEffect(() => () => {
    if (agreementAttentionTimerRef.current !== null) {
      window.clearTimeout(agreementAttentionTimerRef.current);
    }
  }, []);

  const requestAgreementAttention = () => {
    const container = agreementRef.current;
    const checkbox = agreementCheckboxRef.current;
    setAgreementNeedsAttention(true);
    container?.scrollIntoView({ behavior: "smooth", block: "center" });
    checkbox?.focus({ preventScroll: true });

    if (container && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      container.animate(
        [
          { transform: "translateX(0)" },
          { transform: "translateX(-5px)" },
          { transform: "translateX(5px)" },
          { transform: "translateX(-3px)" },
          { transform: "translateX(3px)" },
          { transform: "translateX(0)" },
        ],
        { duration: 320, easing: "ease-out" },
      );
    }
    if (window.matchMedia("(pointer: coarse)").matches && "vibrate" in navigator) {
      navigator.vibrate(30);
    }
    if (agreementAttentionTimerRef.current !== null) {
      window.clearTimeout(agreementAttentionTimerRef.current);
    }
    agreementAttentionTimerRef.current = window.setTimeout(() => {
      setAgreementNeedsAttention(false);
      agreementAttentionTimerRef.current = null;
    }, 1_800);
  };

  useEffect(() => {
    if (!company || !shouldSynchronizeCompanyFormFromQuery({
      aiFilled: aiFilledRef.current,
      formEdited: formEditedRef.current,
    })) return;
    // 历史数据只存了姓名没存工号，按姓名反查一次，
    // 反查不到则保留空工号并在下方提示重新选择
    const resolveCode = (code?: string | null, name?: string | null) => {
      const normalizedCode = code?.trim().toLowerCase() || "";
      const activeMatch = salesStaffQuery.data?.find(item => item.staffCode === normalizedCode);
      if (activeMatch) return activeMatch.staffCode;
      return salesStaffQuery.data?.find(
        item => item.displayName.toLowerCase() === name?.trim().toLowerCase(),
      )?.staffCode || "";
    };
    // 有待审核草稿时，表单展示用户最近提交的草稿内容（原信息在审核通过前维持生效）
    const d = (company as any).draft as Partial<typeof form> | null;
    if (d) {
      setForm({
        companyName: d.companyName || "",
        creditCode: normalizeCompanyCreditCode(d.creditCode || ""),
        companyType: d.companyType || "",
        legalPerson: d.legalPerson || "",
        companyRole: d.companyRole || "",
        bankAccountName: d.bankAccountName || "",
        bankAccountNumber: d.bankAccountNumber || "",
        bankName: d.bankName || "",
        regAddress: d.regAddress || "",
        establishedAt: (d as any).establishedAt || "",
        salesOwner: (d as any).salesOwner || "",
        salesOwnerCode: resolveCode(
          (d as any).salesOwnerCode,
          (d as any).salesOwner,
        ),
      });
      return;
    }
    setForm({
      companyName: company.companyName || "",
      creditCode: normalizeCompanyCreditCode(company.creditCode || ""),
      companyType: company.companyType || "",
      legalPerson: company.legalPerson || "",
      companyRole: company.companyRole || "",
      bankAccountName: company.bankAccountName || "",
      bankAccountNumber: company.bankAccountNumber || "",
      bankName: company.bankName || "",
      regAddress: company.regAddress || "",
      establishedAt: (company as any).establishedAt || "",
      salesOwner: (company as any).salesOwner || "",
      salesOwnerCode: resolveCode(
        (company as any).salesOwnerCode,
        (company as any).salesOwner,
      ),
    });
    // 依赖 salesStaffQuery.data：名单到达后需重跑一次以完成姓名→工号反查
  }, [company, salesStaffQuery.data]);

  const handleSaveSuccess = () => {
    aiFilledRef.current = false;
    formEditedRef.current = false;
    utils.company.get.invalidate();
    utils.company.enterpriseAgreementStatus.invalidate();
    utils.auth.me.invalidate();
    toast.success("企业资料已提交，等待平台人工审核", {
      description: "审核通过后将开通/更新 ERP 权限，请留意审核状态",
    });
    onSaved?.();
  };

  const saveMutation = trpc.company.save.useMutation({
    onSuccess: handleSaveSuccess,
    onError: e => toast.error(e.message),
  });

  const crmApplicationMutation = trpc.company.submitCrmApplication.useMutation({
    onSuccess: handleSaveSuccess,
    onError: e => toast.error(e.message),
  });

  const activeSaveMutation = submissionMode === "crm-application"
    ? crmApplicationMutation
    : saveMutation;

  const uploadMutation = trpc.company.uploadLicense.useMutation({
    onSuccess: data => {
      setUploadStage("");
      aiFilledRef.current = true;
      const ex = data.extracted;
      if (ex && (ex.companyName || ex.creditCode || ex.regAddress || ex.establishedAt)) {
        aiFilledRef.current = true;
        setForm(f => ({
          ...f,
          companyName: ex.companyName || f.companyName,
          creditCode: normalizeCompanyCreditCode(ex.creditCode || f.creditCode),
          regAddress: ex.regAddress || f.regAddress,
          legalPerson: ex.legalPerson || f.legalPerson,
          companyType: ex.companyType || f.companyType,
          establishedAt: ex.establishedAt || f.establishedAt,
        }));
        toast.success("营业执照已上传，AI已自动识别并回填企业信息", {
          description: "请核对识别结果，确认无误后保存",
        });
      } else {
        // 区分「试了没识别出来」与「服务端能力缺失」，后者要告知可改传图片
        const reason = (data as { ocrSkippedReason?: string | null }).ocrSkippedReason;
        toast.success("营业执照已上传", {
          description:
            reason === "pdf_unavailable"
              ? "当前暂无法识别 PDF 执照，请手动填写下方表单，或改传 JPG / PNG 图片版执照"
              : "未能自动识别执照信息，请手动填写下方表单",
        });
      }
      // invalidate 放在 setForm 之后：仅刷新执照文件名/URL展示；表单覆盖由 aiFilledRef 拦截
      utils.company.get.invalidate();
    },
    onError: e => toast.error(e.message),
  });

  const bankUploadMutation = trpc.company.uploadBankLicense.useMutation({
    onSuccess: data => {
      setBankUploadStage("");
      setBankEvidenceUploaded(true);
      aiFilledRef.current = true;
      const ex = data.extracted;
      if (ex && (ex.bankAccountName || ex.bankAccountNumber || ex.bankName)) {
        aiFilledRef.current = true;
        setForm(f => ({
          ...f,
          bankAccountName: ex.bankAccountName || f.bankAccountName,
          bankAccountNumber: ex.bankAccountNumber || f.bankAccountNumber,
          bankName: ex.bankName || f.bankName,
        }));
        /*
         * 强制核对而非“已完成”：账号识错会直接导致打款到错误账户，
         * 后果远重于企业名称识错，文案需明确点名“账号”。
         */
        toast.success("银行资料已上传，AI已自动识别并回填", {
          description: "请务必核对账号数字是否一致，确认无误后保存",
        });
      } else {
        toast.success("银行资料已上传", {
          description: "请手动填写账户信息，识别失败不影响提交",
        });
      }
      utils.company.get.invalidate();
    },
    onError: e => toast.error(e.message),
  });

  const mainlandBusy = activeSaveMutation.isPending
    || uploadMutation.isPending
    || bankUploadMutation.isPending
    || Boolean(uploadStage)
    || Boolean(bankUploadStage);

  useEffect(() => {
    onBusyChange?.(mainlandBusy);
  }, [mainlandBusy, onBusyChange]);

  useEffect(() => () => onBusyChange?.(false), [onBusyChange]);

  // 上传结束（含失败）时清理阶段提示
  useEffect(() => {
    if (!uploadMutation.isPending && uploadStage === "upload") setUploadStage("");
  }, [uploadMutation.isPending]);
  useEffect(() => {
    if (!bankUploadMutation.isPending && bankUploadStage === "upload") {
      setBankUploadStage("");
    }
  }, [bankUploadMutation.isPending]);

  const handleSave = () => {
    const creditCode = normalizeCompanyCreditCode(form.creditCode);
    if (!form.companyName.trim() || form.companyName.trim().length < 2) {
      toast.error("请输入企业名称");
      return;
    }
    if (!creditCode) {
      toast.error("统一社会信用代码为必填项");
      return;
    }
    if (!/^[0-9A-HJ-NPQRTUWXY]{18}$/.test(creditCode)) {
      toast.error("请输入18位统一社会信用代码");
      return;
    }
    const requiredFields = [
      [form.companyType, "请输入企业类型"],
      [form.legalPerson, "请输入法定代表人"],
      [form.establishedAt, "请输入营业执照上的成立时间"],
      [form.regAddress, "请输入注册地址"],
      [form.bankAccountName, "请输入账户名称"],
      [form.bankAccountNumber, "请输入账户号码"],
      [form.bankName, "请输入开户行"],
    ] as const;
    const missing = requiredFields.find(([value]) => !value.trim());
    if (missing) {
      toast.error(missing[1]);
      return;
    }
    if (!currentUser?.crmAccess && !bankEvidenceUploaded && !bankLicenseFileName && !bankLicenseUrl) {
      toast.error("请先上传银行资料附件", { description: "账户信息可手动填写" });
      bankUploadButtonRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      bankUploadButtonRef.current?.focus({ preventScroll: true });
      return;
    }
    if (!agreementAccepted) {
      requestAgreementAttention();
      return;
    }
    activeSaveMutation.mutate({
      companyName: form.companyName.trim(),
      creditCode,
      companyType: form.companyType.trim(),
      legalPerson: form.legalPerson.trim(),
      companyRole: form.companyRole.trim() || null,
      regAddress: form.regAddress.trim(),
      establishedAt: form.establishedAt,
      bankAccountName: form.bankAccountName.trim(),
      bankAccountNumber: normalizeBankAccountNumber(form.bankAccountNumber),
      bankName: form.bankName.trim(),
      salesOwner: form.salesOwner.trim() || undefined,
      salesOwnerCode: form.salesOwnerCode || null,
      agreementAccepted: true,
      agreementVersion: ENTERPRISE_SERVICE_AGREEMENT_VERSION,
      agreementHash: ENTERPRISE_SERVICE_AGREEMENT_HASH,
    });
  };

  /**
   * 图片压缩：识别与存档不需要 8MB 原图。
   * 压到最长边 1600px 的 JPEG（约 300-600KB），上传耗时与 AI 识别耗时均降一个数量级。
   * PDF 不压缩，原样上传。
   */
  const compressImage = (file: File): Promise<{ base64: string; mimeType: "image/jpeg"; fileName: string }> =>
    new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        const MAX = 1600;
        let { width, height } = img;
        // 小图不放大；大图等比缩到最长边 1600px
        if (Math.max(width, height) > MAX) {
          const ratio = MAX / Math.max(width, height);
          width = Math.round(width * ratio);
          height = Math.round(height * ratio);
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) return reject(new Error("图片处理失败，请重试"));
        // 白底铺垫，避免透明 PNG 转 JPEG 出现黑底
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);
        const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
        const base64 = dataUrl.split(",")[1];
        const fileName = file.name.replace(/\.(png|jpeg|jpg|webp|bmp)$/i, "") + ".jpg";
        resolve({ base64, mimeType: "image/jpeg", fileName });
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("图片读取失败，请更换文件重试"));
      };
      img.src = url;
    });

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      toast.error("文件大小不能超过 10MB");
      return;
    }
    try {
      if (file.type.startsWith("image/")) {
        // 图片先压缩再上传：8MB 原图 → 数百 KB，上传与 AI 识别提速一个数量级
        setUploadStage("compress");
        const { base64, mimeType, fileName } = await compressImage(file);
        setUploadStage("upload");
        uploadMutation.mutate({ fileName, base64, mimeType });
      } else {
        // PDF 等非图片原样上传
        setUploadStage("upload");
        const reader = new FileReader();
        reader.onload = () => {
          const base64 = (reader.result as string).split(",")[1];
          uploadMutation.mutate({
            fileName: file.name,
            base64,
            mimeType: "application/pdf",
          });
        };
        reader.onerror = () => {
          setUploadStage("");
          toast.error("文件读取失败，请重试");
        };
        reader.readAsDataURL(file);
      }
    } catch (err) {
      setUploadStage("");
      toast.error(err instanceof Error ? err.message : "图片处理失败，请重试");
    }
  };

  /** 银行资料选文件：与执照同构，图片先压缩，PDF 原样上传 */
  const handleBankFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      toast.error("文件大小不能超过 10MB");
      return;
    }
    try {
      if (file.type.startsWith("image/")) {
        setBankUploadStage("compress");
        const { base64, mimeType, fileName } = await compressImage(file);
        setBankUploadStage("upload");
        bankUploadMutation.mutate({ fileName, base64, mimeType });
      } else {
        setBankUploadStage("upload");
        const reader = new FileReader();
        reader.onload = () => {
          const base64 = (reader.result as string).split(",")[1];
          bankUploadMutation.mutate({
            fileName: file.name,
            base64,
            mimeType: "application/pdf",
          });
        };
        reader.onerror = () => {
          setBankUploadStage("");
          toast.error("文件读取失败，请重试");
        };
        reader.readAsDataURL(file);
      }
    } catch (err) {
      setBankUploadStage("");
      toast.error(err instanceof Error ? err.message : "图片处理失败，请重试");
    }
  };

  /*
   * 银行资料属于新增列，生产库完成 DDL 前接口可能不返回该字段，
   * 故此处宽松取值，避免部署时序差异导致页面报错。
   */
  const licenseAccessUrl = (company as { licenseAccessUrl?: string | null; licenseUrl?: string | null } | null | undefined)
    ?.licenseAccessUrl ?? (company as { licenseUrl?: string | null } | null | undefined)?.licenseUrl;

  const reviewStatus = (company as any)?.reviewStatus as
    | "pending"
    | "approved"
    | "rejected"
    | undefined;
  const rejectReason = (company as any)?.rejectReason as string | null | undefined;
  /** 是否为"已生效企业的修改申请"（存在待审核草稿） */
  const hasDraft = Boolean((company as any)?.draft);
  /** 是否已提交过资料（有企业名称才算正式提交，仅上传执照不算） */
  const hasSubmitted = Boolean(company?.companyName);

  if (isLoading) {
    return (
      <div className="p-12 flex justify-center">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <Card className="max-w-[920px] gap-3 border-[#e2e8f0] p-5 shadow-none md:p-6 [&_[data-slot=input]]:h-10 [&_[data-slot=input]]:text-sm [&_[data-slot=label]]:text-[13px] [&_[data-slot=label]]:font-medium">
      {/* 审核状态提示：提交后待审核 / 驳回原因 / 已通过 */}
      {hasSubmitted && reviewStatus === "pending" && (
        <div className="mb-5 flex items-start gap-2.5 rounded-lg border border-[#f5d9a8] bg-[#FDF6E9] px-4 py-3">
          <Clock className="w-4 h-4 text-[#B4770E] mt-0.5 shrink-0" />
          <div className="text-[13px] leading-relaxed">
            <p className="font-medium text-[#854F0B]">企业资料审核中</p>
            <p className="text-[#a97a2a]">
              {hasDraft
                ? "您提交的修改内容正在人工审核，审核通过前原企业信息维持生效，现有 ERP 权限不受影响。"
                : "平台工作人员将人工核对您提交的资料，审核通过后开通/更新 ERP 权限；修改资料再次提交后也需重新审核。"}
            </p>
          </div>
        </div>
      )}
      {hasSubmitted && reviewStatus === "rejected" && (
        <div className="mb-5 flex items-start gap-2.5 rounded-lg border border-[#f0c4c4] bg-[#FDF0F0] px-4 py-3">
          <AlertCircle className="w-4 h-4 text-[#C24040] mt-0.5 shrink-0" />
          <div className="text-[13px] leading-relaxed">
            <p className="font-medium text-[#A02F2F]">审核未通过</p>
            <p className="text-[#b05555]">
              驳回原因：{rejectReason || "资料不符合认证要求"}。请修改资料后重新提交审核。
            </p>
          </div>
        </div>
      )}
      {hasSubmitted && reviewStatus === "approved" && (
        <div className="mb-5 flex items-start gap-2.5 rounded-lg border border-[#cfe3bc] bg-[#F3F9EC] px-4 py-3">
          <CheckCircle2 className="w-4 h-4 text-[#4C8A1F] mt-0.5 shrink-0" />
          <div className="text-[13px] leading-relaxed">
            <p className="font-medium text-[#3B6D11]">企业认证已通过</p>
            <p className="text-[#618c3c]">
              ERP 权限已开通。修改企业资料并重新提交后，将由平台重新审核（审核期间现有权限不受影响）。
            </p>
          </div>
        </div>
      )}

      <div>
        <h2 className="text-[15px] font-semibold text-slate-900">企业资料</h2>
        <p className="mt-0.5 text-[11px] text-slate-500">请按营业执照填写，上传后可自动识别</p>
      </div>

      {/* 营业执照上传（置顶）：上传后AI自动识别并回填企业信息 */}
      <div className="border-b border-border/60 pb-3">
        <div className="flex items-center gap-2 mb-1">
          <Label>
            营业执照 <span className="text-destructive">*</span>
          </Label>
          <span className="inline-flex items-center gap-1 rounded-full bg-[#EAF3FD] px-2 py-0.5 text-[10px] text-[#185FA5]">
            <Sparkles className="w-3 h-3" /> 上传后 AI 自动识别并回填企业信息
          </span>
        </div>
        <div className="flex items-center gap-3 mt-2">
          <input
            ref={fileRef}
            type="file"
            accept=".pdf,.jpg,.jpeg,.png"
            className="hidden"
            onChange={handleFileChange}
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="flex h-[72px] w-[112px] flex-col items-center justify-center gap-1 rounded-md border border-dashed border-[#c3d4e8] bg-[#f8fbff] text-[11px] text-[#6f8bab] transition-colors hover:border-[#185FA5] hover:bg-[#f0f6fd]">
            {uploadMutation.isPending || uploadStage ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin text-[#185FA5]" />
                {uploadStage === "compress" ? "处理中…" : "AI识别中…"}
              </>
            ) : licenseAccessUrl ? (
              <>
                <FileText className="h-4 w-4 text-[#185FA5]" />
                重新上传
              </>
            ) : (
              <>
                <Upload className="h-4 w-4 text-[#185FA5]" />
                上传执照
              </>
            )}
          </button>
          <div className="space-y-1 text-[11px]">
            {licenseAccessUrl ? (
              <>
                <a
                  href={licenseAccessUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[#185FA5] hover:underline flex items-center gap-1">
                  <FileText className="w-3.5 h-3.5" />
                  {company?.licenseFileName || "营业执照"}
                </a>
                <p className="text-muted-foreground">已上传，点击文件名可预览</p>
              </>
            ) : (
              <p className="text-muted-foreground">
                支持 PDF / JPG / PNG，大小不超过 10MB
                <br />
                上传后将自动识别企业名称、信用代码、成立时间、注册地址
              </p>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label>
            企业名称 <span className="text-destructive">*</span>
          </Label>
          <Input
            placeholder="营业执照上的企业全称"
            value={form.companyName}
            onChange={e => updateForm({ companyName: e.target.value })}
          />
        </div>
        <div className="space-y-1.5">
          <Label>
            统一社会信用代码 <span className="text-destructive">*</span>
          </Label>
          <Input
            placeholder="18位统一社会信用代码"
            value={form.creditCode}
            onChange={e =>
              updateForm({ creditCode: normalizeCompanyCreditCode(e.target.value) })
            }
          />
        </div>
        <div className="space-y-1.5">
          <Label>企业类型 <span className="text-destructive">*</span></Label>
          <Input
            placeholder="如：有限责任公司（制造业 · 智能硬件）"
            value={form.companyType}
            onChange={e => updateForm({ companyType: e.target.value })}
          />
        </div>
        <div className="space-y-1.5">
          <Label>法定代表人 <span className="text-destructive">*</span></Label>
          <Input
            placeholder="法定代表人姓名"
            value={form.legalPerson}
            onChange={e => updateForm({ legalPerson: e.target.value })}
          />
        </div>
        <div className="space-y-1.5">
          <Label>成立时间 <span className="text-destructive">*</span></Label>
          <Input
            type="date"
            max={new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10)}
            value={form.establishedAt}
            onChange={e => updateForm({ establishedAt: e.target.value })}
          />
          <p className="text-[11px] text-muted-foreground">以营业执照“成立日期”为准</p>
        </div>
        <div className="space-y-1.5">
          <Label>企业角色（选填）</Label>
          <Input
            placeholder="如：供应商、采购方或生产厂家；可不填写"
            value={form.companyRole}
            onChange={e => updateForm({ companyRole: e.target.value })}
          />
        </div>
        <div className="space-y-1.5 md:col-span-2">
          <Label>注册地址 <span className="text-destructive">*</span></Label>
          <Input
            placeholder="营业执照注册地址"
            value={form.regAddress}
            onChange={e => updateForm({ regAddress: e.target.value })}
          />
        </div>
        <div className="md:col-span-2 mt-2 border-t border-border/60 pt-5">
          <h2 className="text-[15px] font-semibold text-slate-900">结算账户</h2>
          <p className="mt-0.5 text-[11px] text-slate-500">账户信息可手动填写，请核对账号</p>
        </div>
        {/*
          * 银行资料上传：跨满两列，紧贴三个银行字段之上。
          * 位置紧邻回填目标，用户才能看懂“传这个会填那几格”。
          */}
        <div className="rounded-md border border-[#e3ecf6] bg-[#fbfdff] px-3.5 py-3 md:col-span-2">
          <div className="flex flex-wrap items-center gap-2 mb-1">
            <Label>银行资料（必传） <span className="text-destructive">*</span></Label>
            <span className="inline-flex items-center gap-1 rounded-full bg-[#EAF3FD] px-2 py-0.5 text-[10px] text-[#185FA5]">
              <Sparkles className="w-3 h-3" /> 自动识别辅助填写
            </span>
          </div>
          <div className="flex items-center gap-3 mt-2">
            <input
              ref={bankFileRef}
              type="file"
              accept=".pdf,.jpg,.jpeg,.png"
              className="hidden"
              onChange={handleBankFileChange}
              data-testid="company-bank-license-input"
            />
            <button
              ref={bankUploadButtonRef}
              type="button"
              onClick={() => bankFileRef.current?.click()}
              data-testid="company-bank-license-upload"
              className="flex h-[72px] w-[112px] shrink-0 flex-col items-center justify-center gap-1 rounded-md border border-dashed border-[#c3d4e8] bg-[#f8fbff] text-[11px] text-[#6f8bab] transition-colors hover:border-[#185FA5] hover:bg-[#f0f6fd]">
              {bankUploadMutation.isPending || bankUploadStage ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin text-[#185FA5]" />
                  {bankUploadStage === "compress" ? "处理中…" : "上传处理中…"}
                </>
              ) : bankLicenseUrl || bankLicenseFileName || bankEvidenceUploaded ? (
                <>
                  <FileText className="h-4 w-4 text-[#185FA5]" />
                  重新上传
                </>
              ) : (
                <>
                  <Upload className="h-4 w-4 text-[#185FA5]" />
                  上传银行资料
                </>
              )}
            </button>
            <div className="min-w-0 space-y-1 text-[11px]">
              {bankLicenseUrl ? (
                <>
                  <a
                    href={bankLicenseUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[#185FA5] hover:underline flex items-center gap-1">
                    <FileText className="w-3.5 h-3.5 shrink-0" />
                    <span className="truncate">{bankLicenseFileName || "银行资料"}</span>
                  </a>
                  <p className="text-muted-foreground">已上传，点击文件名可预览</p>
                </>
              ) : bankLicenseFileName || bankEvidenceUploaded ? (
                <p className="text-muted-foreground">银行资料已上传</p>
              ) : (
                <p className="text-muted-foreground leading-relaxed">
                  请上传开户许可证或基本存款账户信息表（二选一）
                  <br />
                  支持 PDF / JPG / PNG，大小不超过 10MB
                  <br />
                  账户信息可手动填写
                </p>
              )}
            </div>
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground" data-testid="company-bank-manual-tip">识别失败不影响提交</p>
        </div>
        <div className="space-y-1.5">
          <Label>账户名称 <span className="text-destructive">*</span></Label>
          <Input
            placeholder="企业银行账户名称"
            maxLength={128}
            value={form.bankAccountName}
            onChange={e => updateForm({ bankAccountName: e.target.value })}
          />
        </div>
        <div className="space-y-1.5">
          <Label>账户号码 <span className="text-destructive">*</span></Label>
          <Input
            placeholder="企业银行账户号码"
            maxLength={64}
            value={form.bankAccountNumber}
            onChange={e => updateForm({ bankAccountNumber: e.target.value })}
          />
        </div>
        <div className="space-y-1.5">
          <Label>开户行 <span className="text-destructive">*</span></Label>
          <Input
            placeholder="如：招商银行深圳科技园支行"
            maxLength={128}
            value={form.bankName}
            onChange={e => updateForm({ bankName: e.target.value })}
          />
        </div>
        <div className="mt-2 border-t border-border/60 pt-4 md:col-span-2" data-testid="company-submission-footer">
          <div className="grid gap-3 md:grid-cols-[240px_minmax(0,1fr)_auto] md:items-end">
            <div className="space-y-1.5" style={{ maxWidth: 240 }}>
              <Label>
                销售负责人 <span className="ml-1 text-[10px] font-normal text-muted-foreground">选填</span>
              </Label>
              <Select
                value={form.salesOwnerCode || "unassigned"}
                disabled={salesStaffQuery.isLoading || salesStaffQuery.isError}
                onValueChange={code => {
                  const matched = salesStaffQuery.data?.find(item => item.staffCode === code);
                  // 工号与姓名成对写入：后台依工号归属，前台展示用姓名
                  updateForm({
                    salesOwnerCode: code === "unassigned" ? "" : code,
                    salesOwner: matched?.displayName || "",
                  });
                }}>
                <SelectTrigger className="h-9 w-full" data-testid="company-sales-owner-select">
                  <SelectValue
                    placeholder={
                      salesStaffQuery.isLoading ? "正在加载销售人员…" : "请选择销售负责人"
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="unassigned">暂不选择</SelectItem>
                  {(salesStaffQuery.data ?? []).map(item => (
                    <SelectItem key={item.staffCode} value={item.staffCode}>
                      {salesOwnerDisplayLabel(item.displayName)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div
              ref={agreementRef}
              className="relative flex min-h-9 min-w-0 items-center gap-2"
              data-testid="enterprise-agreement-consent"
            >
              <Checkbox
                ref={agreementCheckboxRef}
                id="enterprise-service-agreement"
                checked={agreementAccepted}
                onCheckedChange={checked => {
                  const accepted = checked === true;
                  setAgreementAccepted(accepted);
                  if (accepted) setAgreementNeedsAttention(false);
                }}
                disabled={enterpriseAgreementQuery.isLoading}
              />
              <Label htmlFor="enterprise-service-agreement" className="shrink-0 cursor-pointer text-xs font-normal text-foreground">
                同意
              </Label>
              <a
                href="/enterprise-service-agreement"
                target="_blank"
                rel="noreferrer"
                className="min-w-0 truncate text-xs font-normal text-foreground underline-offset-2 hover:underline"
              >
                《51电子网开通企业服务协议》{ENTERPRISE_SERVICE_AGREEMENT_VERSION}
              </a>
              <span className="shrink-0 text-[10px] text-muted-foreground">必选</span>
              <p
                className={`absolute left-6 top-full mt-0.5 text-[10px] text-muted-foreground transition-opacity ${
                  agreementNeedsAttention ? "opacity-100" : "pointer-events-none opacity-0"
                }`}
                aria-live="polite"
              >
                请先阅读并同意服务协议
              </p>
            </div>

            <Button
              className="h-9 shrink-0 bg-[#185FA5] px-5 text-xs hover:bg-[#0C447C]"
              disabled={activeSaveMutation.isPending || enterpriseAgreementQuery.isLoading}
              onClick={handleSave}>
              {activeSaveMutation.isPending && (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              )}
              {hasSubmitted && reviewStatus !== "approved" ? "重新提交审核" : saveButtonText}
            </Button>
          </div>
          {salesStaffQuery.isError ? (
            <p className="mt-1.5 text-[11px] text-destructive">
              销售负责人列表暂时不可用，请刷新页面后重试
            </p>
          ) : form.salesOwner && !form.salesOwnerCode ? (
            <p className="mt-1.5 text-[11px] text-amber-700">
              历史负责人“{form.salesOwner}”不在有效名单中，请重新选择
            </p>
          ) : null}
        </div>
      </div>

    </Card>
  );
}

type RegistrationRegion = "CN" | "HK";
type HkCapabilityState = { enabled: boolean; loading: boolean };

/**
 * CN/HK form container. Both forms stay mounted while only the active jurisdiction is visible,
 * so each keeps its own in-memory draft. A bound enterprise or in-flight upload/save locks switching.
 */
export default function CompanyForm(props: CompanyFormProps) {
  const { data: company } = trpc.company.get.useQuery();
  const [region, setRegion] = useState<RegistrationRegion>("CN");
  const [mainlandBusy, setMainlandBusy] = useState(false);
  const [hongKongBusy, setHongKongBusy] = useState(false);
  const [hkCapability, setHkCapability] = useState<HkCapabilityState>({ enabled: false, loading: true });

  const boundRegion: RegistrationRegion | null = (() => {
    const record = company as {
      registrationRegion?: string | null;
      registrationIdentifier?: string | null;
      creditCode?: string | null;
      companyName?: string | null;
    } | null | undefined;
    // Legacy mainland records may not yet have registrationIdentifier; their existing name/code still binds CN.
    if (!record?.registrationIdentifier && !record?.creditCode && !record?.companyName) return null;
    return record?.registrationRegion === "HK" ? "HK" : "CN";
  })();

  useEffect(() => {
    if (boundRegion) setRegion(boundRegion);
  }, [boundRegion]);

  const handleHkCapabilities = useCallback((next: HkCapabilityState) => {
    setHkCapability(current => (
      current.enabled === next.enabled && current.loading === next.loading ? current : next
    ));
  }, []);

  const switchingLocked = Boolean(boundRegion) || mainlandBusy || hongKongBusy;
  const hkSelectable = hkCapability.enabled || boundRegion === "HK";
  const selectRegion = (next: RegistrationRegion) => {
    if (switchingLocked || (next === "HK" && !hkSelectable)) return;
    setRegion(next);
  };

  return (
    <div className="max-w-[920px]">
      <section className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-[#e2e8f0] bg-white px-5 py-3 shadow-none md:px-6">
        <Label className="shrink-0 text-[13px] font-medium">
          注册地区 <span className="text-destructive">*</span>
        </Label>
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <div className="inline-flex rounded-md border border-[#d8e3ef] bg-[#f6f9fc] p-1" role="group" aria-label="注册地区">
            <button type="button" data-testid="company-region-cn" aria-pressed={region === "CN"}
              disabled={switchingLocked} onClick={() => selectRegion("CN")}
              className={`rounded px-4 py-2 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${region === "CN" ? "bg-[#185FA5] text-white" : "text-slate-600 hover:bg-white"}`}>
              中国内地
            </button>
            <button type="button" data-testid="company-region-hk" aria-pressed={region === "HK"}
              disabled={switchingLocked || !hkSelectable} onClick={() => selectRegion("HK")}
              className={`rounded px-4 py-2 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${region === "HK" ? "bg-[#185FA5] text-white" : "text-slate-600 hover:bg-white"}`}
              title={!hkSelectable && !hkCapability.loading ? "香港注册公司申请暂未开放" : undefined}>
              中国香港
            </button>
          </div>
          {switchingLocked && !boundRegion ? (
            <span className="text-[11px] text-muted-foreground">上传或保存进行中，暂不可切换注册地区</span>
          ) : boundRegion ? (
            <span className="text-[11px] text-muted-foreground">已绑定企业主体，注册地区不可更改</span>
          ) : !hkCapability.loading && !hkCapability.enabled ? (
            <span className="text-[11px] text-muted-foreground">香港注册公司申请暂未开放</span>
          ) : null}
        </div>
      </section>

      <div hidden={region !== "CN"} aria-hidden={region !== "CN"}>
        <MainlandCompanyForm {...props} onBusyChange={setMainlandBusy} />
      </div>
      <div hidden={region !== "HK"} aria-hidden={region !== "HK"}>
        <HongKongCompanyForm {...props} onBusyChange={setHongKongBusy} onCapabilitiesChange={handleHkCapabilities} />
      </div>
    </div>
  );
}
