import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { toast } from "sonner";
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  FileText,
  Loader2,
  Sparkles,
  Upload,
} from "lucide-react";
import { trpc } from "../../../../api/business-trpc";
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
import { Textarea } from "./ui/textarea";
import {
  ENTERPRISE_SERVICE_AGREEMENT_HASH,
  ENTERPRISE_SERVICE_AGREEMENT_VERSION,
} from "../../../shared/enterpriseServiceAgreementContent";
import {
  displayHkDate,
  hkRegistrationDataSchema,
  normalizeHkDate,
  type HkDocumentKind,
  type HkExtractedFields,
  type HkRegistrationData,
} from "../../../shared/hongKongRegistration";
import type { CompanyFormProps } from "./CompanyForm";

/** Keep the same ERP-only display names as the mainland form; saved values remain the real name and staff code. */
const SALES_OWNER_DISPLAY_LABELS: Record<string, string> = {
  倪先明: "Jack",
  周雨琦: "Yuki",
};

function salesOwnerDisplayLabel(name: string): string {
  return SALES_OWNER_DISPLAY_LABELS[name] || name;
}

type HkDocument = { id: string; fileName: string; accessUrl: string | null };
type HkDocumentMime = "image/jpeg" | "image/png" | "application/pdf";

type HkFormState = {
  companyName: string;
  chineseName: string;
  businessNature: string;
  legalStatus: string;
  brn: string;
  registrationNumber: string;
  brStartDate: string;
  brExpiryDate: string;
  ciNumber: string;
  establishedAt: string;
  regAddress: string;
  bankAccountName: string;
  bankAccountNumber: string;
  bankName: string;
  bankAddress: string;
  swift: string;
  bankCode: string;
  companyRole: string;
  salesOwner: string;
  salesOwnerCode: string;
};

const EMPTY_HK_FORM: HkFormState = {
  companyName: "",
  chineseName: "",
  businessNature: "",
  legalStatus: "",
  brn: "",
  registrationNumber: "",
  brStartDate: "",
  brExpiryDate: "",
  ciNumber: "",
  establishedAt: "",
  regAddress: "",
  bankAccountName: "",
  bankAccountNumber: "",
  bankName: "",
  bankAddress: "",
  swift: "",
  bankCode: "",
  companyRole: "",
  salesOwner: "",
  salesOwnerCode: "",
};

const OCR_FIELDS: Array<keyof HkFormState> = [
  "companyName",
  "chineseName",
  "businessNature",
  "legalStatus",
  "brn",
  "registrationNumber",
  "brStartDate",
  "brExpiryDate",
  "ciNumber",
  "establishedAt",
  "regAddress",
  "bankAccountName",
  "bankAccountNumber",
  "bankName",
  "bankAddress",
  "swift",
  "bankCode",
  "companyRole",
];

const DATE_FIELDS = new Set<keyof HkFormState>([
  "brStartDate",
  "brExpiryDate",
  "establishedAt",
]);

function isSoleProprietorOrPartnership(legalStatus: string): boolean {
  return /SOLE|PARTNERSHIP|独资|獨資|合伙|合夥/i.test(legalStatus);
}

function dateInputValue(value: string): string {
  const iso = normalizeHkDate(value);
  return iso ? displayHkDate(iso) : value;
}

function supportedMimeType(file: File): HkDocumentMime | null {
  if (
    file.type === "application/pdf" ||
    file.type === "image/jpeg" ||
    file.type === "image/png"
  ) {
    return file.type;
  }
  // Some desktop file pickers do not populate File.type. Restrict that fallback to the same suffix whitelist.
  if (file.type) return null;
  if (/\.pdf$/i.test(file.name)) return "application/pdf";
  if (/\.jpe?g$/i.test(file.name)) return "image/jpeg";
  if (/\.png$/i.test(file.name)) return "image/png";
  return null;
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string" || !result.includes(",")) {
        reject(new Error("文件读取失败，请重试"));
        return;
      }
      resolve(result.slice(result.indexOf(",") + 1));
    };
    reader.onerror = () => reject(new Error("文件读取失败，请重试"));
    reader.readAsDataURL(file);
  });
}

export type HongKongCompanyFormProps = CompanyFormProps & {
  onBusyChange?: (busy: boolean) => void;
  onCapabilitiesChange?: (state: {
    enabled: boolean;
    loading: boolean;
  }) => void;
};

/**
 * Isolated Hong Kong registered-company application. It does not reuse mainland upload, bank
 * number normalization, or submission routes: BR/CI/BANK evidence and data are private HK flows.
 */
export default function HongKongCompanyForm({
  saveButtonText = "保存企业资料",
  onSaved,
  onBusyChange,
  onCapabilitiesChange,
}: HongKongCompanyFormProps) {
  const utils = trpc.useUtils();
  const capabilitiesQuery = trpc.company.hkCapabilities.useQuery(undefined, {
    retry: false,
  });
  const hkEnabled = capabilitiesQuery.data?.enabled === true;
  const ocrConfigured =
    hkEnabled && capabilitiesQuery.data?.ocrConfigured === true;
  const draftQuery = trpc.company.hkDraft.useQuery(undefined, {
    enabled: hkEnabled,
  });
  const enterpriseAgreementQuery =
    trpc.company.enterpriseAgreementStatus.useQuery();
  const salesStaffQuery = trpc.company.salesStaff.useQuery();

  const [form, setForm] = useState<HkFormState>(EMPTY_HK_FORM);
  const [documents, setDocuments] = useState<
    Partial<Record<HkDocumentKind, HkDocument>>
  >({});
  const [pendingUploadKind, setPendingUploadKind] =
    useState<HkDocumentKind | null>(null);
  const [agreementAccepted, setAgreementAccepted] = useState(false);
  const [agreementNeedsAttention, setAgreementNeedsAttention] = useState(false);
  const agreementRef = useRef<HTMLDivElement>(null);
  const agreementCheckboxRef = useRef<HTMLButtonElement>(null);
  const brFileRef = useRef<HTMLInputElement>(null);
  const ciFileRef = useRef<HTMLInputElement>(null);
  const bankFileRef = useRef<HTMLInputElement>(null);
  const documentFileRefs: Record<HkDocumentKind, typeof brFileRef> = {
    BR: brFileRef,
    CI: ciFileRef,
    BANK: bankFileRef,
  };
  const formEditedRef = useRef(false);
  const draftFormHydratedRef = useRef(false);
  const draftDocumentsHydratedRef = useRef(false);
  const ocrValuesRef = useRef<Partial<HkFormState>>({});

  const updateForm = (patch: Partial<HkFormState>) => {
    formEditedRef.current = true;
    setForm(current => ({ ...current, ...patch }));
  };

  useEffect(() => {
    onCapabilitiesChange?.({
      enabled: hkEnabled,
      loading: capabilitiesQuery.isLoading,
    });
  }, [capabilitiesQuery.isLoading, hkEnabled, onCapabilitiesChange]);

  useEffect(() => {
    if (enterpriseAgreementQuery.data?.accepted) setAgreementAccepted(true);
  }, [enterpriseAgreementQuery.data?.accepted]);

  useEffect(() => {
    const draft = draftQuery.data;
    if (!draft) return;

    if (!draftFormHydratedRef.current) {
      draftFormHydratedRef.current = true;
      // A late draft must never overwrite manual typing or an upload/OCR result started by this user.
      if (!formEditedRef.current && draft.registrationData) {
        const patch: Partial<HkFormState> = {};
        for (const key of OCR_FIELDS) {
          const value = draft.registrationData[key as keyof HkExtractedFields];
          if (typeof value === "string" && value.trim()) {
            patch[key] = DATE_FIELDS.has(key) ? dateInputValue(value) : value;
          }
        }
        setForm(current => ({ ...current, ...patch }));
      }
    }

    if (!draftDocumentsHydratedRef.current) {
      draftDocumentsHydratedRef.current = true;
      // A document selected in this mount wins over a late draft response for the same role.
      setDocuments(current => ({ ...(draft.documents ?? {}), ...current }));
    }
  }, [draftQuery.data]);

  const patchRecognizedFields = (extracted: HkExtractedFields | null) => {
    if (!extracted) return false;
    const incoming: Partial<HkFormState> = {};
    for (const key of OCR_FIELDS) {
      const value = extracted[key as keyof HkExtractedFields];
      if (typeof value === "string" && value.trim()) {
        incoming[key] = DATE_FIELDS.has(key) ? dateInputValue(value) : value;
      }
    }
    if (!Object.keys(incoming).length) return false;

    setForm(current => {
      const next = { ...current };
      for (const [key, value] of Object.entries(incoming) as Array<
        [keyof HkFormState, string]
      >) {
        // A later OCR result may refresh its own prior value, but cannot silently overwrite user corrections.
        if (!current[key].trim() || current[key] === ocrValuesRef.current[key])
          next[key] = value;
      }
      return next;
    });
    ocrValuesRef.current = { ...ocrValuesRef.current, ...incoming };
    return true;
  };

  const uploadMutation = trpc.company.uploadHkDocument.useMutation({
    onSuccess: (result, variables) => {
      setPendingUploadKind(null);
      setDocuments(current => ({
        ...current,
        [variables.kind]: {
          id: result.document.id,
          fileName: result.document.fileName,
          accessUrl: null,
        },
      }));
      const filled =
        result.ocrStatus === "recognized" &&
        patchRecognizedFields(result.extracted);
      if (filled) {
        toast.success(
          `${variables.kind === "BANK" ? "香港银行证明" : variables.kind}已上传，已辅助回填`,
          {
            description: "已回填实际识别到的字段，请逐项核对后提交。",
          }
        );
      } else if (variables.kind === "BANK") {
        toast.success("香港银行证明已上传", {
          description:
            "未识别到可回填的信息，请手动核对填写账户、地址、SWIFT 与 Bank Code 后提交。",
        });
      } else {
        toast.success(`${variables.kind}已上传`, {
          description:
            result.ocrStatus === "failed"
              ? "未识别到可回填的信息，请按证件手动填写并核对。"
              : "未返回可回填的信息，请按证件手动填写并核对。",
        });
      }
    },
    onError: error => {
      setPendingUploadKind(null);
      toast.error(error.message || "文件上传失败，请重试");
    },
  });

  const submitMutation = trpc.company.submitHkApplication.useMutation({
    onSuccess: () => {
      formEditedRef.current = false;
      utils.company.get.invalidate();
      utils.company.enterpriseAgreementStatus.invalidate();
      utils.auth.me.invalidate();
      toast.success("香港注册公司申请已提交，等待平台人工审核", {
        description: "提交不代表服务已开通，具体服务状态以后台审核结果为准。",
      });
      onSaved?.();
    },
    onError: error => toast.error(error.message || "提交失败，请稍后重试"),
  });

  const busy =
    Boolean(pendingUploadKind) ||
    uploadMutation.isPending ||
    submitMutation.isPending;
  useEffect(() => {
    onBusyChange?.(busy);
  }, [busy, onBusyChange]);
  useEffect(() => () => onBusyChange?.(false), [onBusyChange]);

  const legalStatusNeedsManualVerification = isSoleProprietorOrPartnership(
    form.legalStatus
  );
  const mergedDocuments = documents;
  const reviewStatus = draftQuery.data?.reviewStatus;
  const submitted = draftQuery.data?.submitted === true;

  const handleFileChange = async (
    kind: HkDocumentKind,
    event: ChangeEvent<HTMLInputElement>
  ) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !hkEnabled || pendingUploadKind) return;
    const mimeType = supportedMimeType(file);
    if (!mimeType) {
      toast.error("仅支持 PDF、JPG 或 PNG 文件");
      return;
    }
    if (!file.size) {
      toast.error("文件为空，请重新选择");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast.error("文件大小不能超过 10MB");
      return;
    }

    formEditedRef.current = true;
    setPendingUploadKind(kind);
    try {
      // Upload the original bytes. HK evidence must not be browser-compressed into a different archival document.
      const base64 = await fileToBase64(file);
      uploadMutation.mutate({ kind, fileName: file.name, base64, mimeType });
    } catch (error) {
      setPendingUploadKind(null);
      toast.error(
        error instanceof Error ? error.message : "文件读取失败，请重试"
      );
    }
  };

  const requestAgreementAttention = () => {
    setAgreementNeedsAttention(true);
    agreementRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
    agreementCheckboxRef.current?.focus({ preventScroll: true });
  };

  const handleSubmit = () => {
    if (!hkEnabled || busy) return;
    if (legalStatusNeedsManualVerification) {
      toast.error(
        "独资／合伙请联系客服进行主体核验，无需提供公司注册证明书（CI）"
      );
      return;
    }
    const validation = hkRegistrationDataSchema.safeParse(form);
    if (!validation.success) {
      toast.error(
        validation.error.issues[0]?.message || "请核对香港注册公司资料"
      );
      return;
    }
    const missingDocument = (["BR", "BANK"] as HkDocumentKind[]).find(
      kind => !mergedDocuments[kind]?.id
    );
    if (missingDocument) {
      const labels: Record<HkDocumentKind, string> = {
        BR: "商业登记证（BR）",
        CI: "公司注册证明书（CI）",
        BANK: "香港银行账户证明",
      };
      toast.error(`请先上传${labels[missingDocument]}`);
      documentFileRefs[missingDocument].current?.focus();
      return;
    }
    if (!agreementAccepted) {
      requestAgreementAttention();
      return;
    }
    // The shared schema normalizes mandatory BR dates. Keep the optional CI establishment date
    // on the same ISO-at-the-wire contract when the user entered an accepted DD/MM/YYYY value.
    const registrationData: HkRegistrationData = {
      ...validation.data,
      establishedAt: validation.data.establishedAt
        ? normalizeHkDate(validation.data.establishedAt)!
        : "",
    };
    submitMutation.mutate({
      registrationData,
      documents: {
        BR: mergedDocuments.BR!.id,
        ...(mergedDocuments.CI?.id ? { CI: mergedDocuments.CI.id } : {}),
        BANK: mergedDocuments.BANK!.id,
      },
      agreementAccepted: true,
      agreementVersion: ENTERPRISE_SERVICE_AGREEMENT_VERSION,
      agreementHash: ENTERPRISE_SERVICE_AGREEMENT_HASH,
    });
  };

  const documentMeta = useMemo(
    () =>
      ({
        BR: {
          title: "商业登记证（BR）",
          uploadLabel: "上传 BR",
          description: "",
        },
        CI: {
          title: "公司注册证明书（CI，选填）",
          uploadLabel: "上传 CI",
          description: "",
        },
        BANK: {
          title: "香港银行账户证明",
          uploadLabel: "上传银行证明",
          description: ocrConfigured
            ? "上传后可辅助识别部分银行字段并回填；请逐项核对，仍须人工审核"
            : "OCR 服务暂未配置；请手动填写并核对银行资料",
        },
      }) satisfies Record<
        HkDocumentKind,
        { title: string; uploadLabel: string; description: string }
      >,
    [ocrConfigured]
  );

  const renderDocumentUpload = (kind: HkDocumentKind) => {
    const document = mergedDocuments[kind];
    const metadata = documentMeta[kind];
    const uploading = pendingUploadKind === kind;
    return (
      <div
        className="min-w-0 rounded-md border border-[#e3ecf6] bg-[#fbfdff] p-3"
        data-testid={`hk-${kind.toLowerCase()}-upload`}
      >
        <div className="mb-1 flex flex-wrap items-center gap-2">
          <Label>
            {metadata.title} {kind !== "CI" && <span className="text-destructive">*</span>}
          </Label>
          {kind === "BANK" && ocrConfigured && (
            <span className="inline-flex items-center gap-1 rounded-full bg-[#EAF3FD] px-2 py-0.5 text-[10px] text-[#185FA5]">
              <Sparkles className="h-3 w-3" /> 上传后自动识别辅助填写
            </span>
          )}
        </div>
        <div className="mt-2 flex items-center gap-3">
          <input
            ref={documentFileRefs[kind]}
            type="file"
            accept=".pdf,.jpg,.jpeg,.png"
            className="hidden"
            data-testid={`hk-${kind.toLowerCase()}-input`}
            disabled={Boolean(pendingUploadKind) || !hkEnabled}
            onChange={event => void handleFileChange(kind, event)}
          />
          <button
            type="button"
            disabled={Boolean(pendingUploadKind) || !hkEnabled}
            onClick={() => documentFileRefs[kind].current?.click()}
            className={`flex shrink-0 items-center justify-center rounded-md border border-dashed border-[#c3d4e8] bg-[#f8fbff] text-[11px] text-[#6f8bab] transition-colors hover:border-[#185FA5] hover:bg-[#f0f6fd] disabled:cursor-not-allowed disabled:opacity-60 ${kind === "BANK" ? "h-[72px] w-[112px] flex-col gap-1" : "h-10 gap-2 px-3"}`}
          >
            {uploading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin text-[#185FA5]" />
                上传处理中…
              </>
            ) : document ? (
              <>
                <FileText className="h-4 w-4 text-[#185FA5]" />
                重新上传
              </>
            ) : (
              <>
                <Upload className="h-4 w-4 text-[#185FA5]" />
                {metadata.uploadLabel}
              </>
            )}
          </button>
          <div className="min-w-0 space-y-1 text-[11px] leading-relaxed">
            {document ? (
              document.accessUrl ? (
                <>
                  <a
                    href={document.accessUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-1 break-all text-[#185FA5] hover:underline"
                  >
                    <FileText className="h-3.5 w-3.5 shrink-0" />
                    {document.fileName}
                  </a>
                  <p className="text-muted-foreground">
                    已上传，点击文件名可预览
                  </p>
                </>
              ) : (
                <>
                  <p className="break-all text-[#185FA5]">
                    {document.fileName}
                  </p>
                  <p className="text-muted-foreground">已上传</p>
                </>
              )
            ) : kind !== "BANK" ? (
              <p className="text-muted-foreground">未上传</p>
            ) : (
              <p className="text-muted-foreground">
                {metadata.description}
                <br />
                支持 PDF / JPG / PNG，大小不超过 10MB
              </p>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <Card className="max-w-[920px] gap-3 border-[#e2e8f0] p-5 shadow-none md:p-6 [&_[data-slot=input]]:h-10 [&_[data-slot=input]]:text-sm [&_[data-slot=label]]:text-[13px] [&_[data-slot=label]]:font-medium">
      {!hkEnabled && (
        <div className="mb-4 flex items-start gap-2.5 rounded-lg border border-[#f5d9a8] bg-[#FDF6E9] px-4 py-3 text-[13px] leading-relaxed">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-[#B4770E]" />
          <div>
            <p className="font-medium text-[#854F0B]">
              香港注册公司申请暂未开放
            </p>
            <p className="text-[#a97a2a]">
              正在等待后端香港注册能力完整上线；当前不会上传或提交任何香港资料。
            </p>
          </div>
        </div>
      )}
      {submitted && reviewStatus === "pending" && (
        <div className="mb-4 flex items-start gap-2.5 rounded-lg border border-[#f5d9a8] bg-[#FDF6E9] px-4 py-3">
          <Clock className="mt-0.5 h-4 w-4 shrink-0 text-[#B4770E]" />
          <div className="text-[13px] leading-relaxed">
            <p className="font-medium text-[#854F0B]">香港企业资料审核中</p>
            <p className="text-[#a97a2a]">
              平台将人工核验已提交的证件和银行证明；具体服务状态以后台审核结果为准。
            </p>
          </div>
        </div>
      )}
      {submitted && reviewStatus === "approved" && (
        <div className="mb-4 flex items-start gap-2.5 rounded-lg border border-[#cfe3bc] bg-[#F3F9EC] px-4 py-3">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#4C8A1F]" />
          <div className="text-[13px] leading-relaxed">
            <p className="font-medium text-[#3B6D11]">香港企业认证已通过</p>
            <p className="text-[#618c3c]">具体服务状态以后台审核结果为准。</p>
          </div>
        </div>
      )}
      {submitted && reviewStatus === "rejected" && (
        <div className="mb-4 flex items-start gap-2.5 rounded-lg border border-[#f0c4c4] bg-[#FDF0F0] px-4 py-3">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-[#C24040]" />
          <div className="text-[13px] leading-relaxed">
            <p className="font-medium text-[#A02F2F]">香港企业资料审核未通过</p>
            <p className="text-[#b05555]">
              请按工作人员说明补充或更正资料后重新提交。
            </p>
          </div>
        </div>
      )}

      <fieldset
        disabled={!hkEnabled}
        className="min-w-0 disabled:cursor-not-allowed"
      >
        <div className="mb-4">
          <h2 className="text-[15px] font-semibold text-slate-900">
            香港注册公司资料
          </h2>
          <p className="mt-0.5 text-[11px] text-slate-500">
            仅适用于香港注册公司
          </p>
        </div>

        <div className="border-b border-border/60 pb-3" data-testid="hk-registration-uploads">
          {ocrConfigured ? (
            <p className="mb-2 flex items-center gap-1 text-[11px] text-[#185FA5]">
              <Sparkles className="h-3.5 w-3.5 shrink-0" />
              上传后自动识别辅助填写
            </p>
          ) : (
            <p className="mb-2 text-[11px] text-muted-foreground">
              OCR 服务暂未配置，请按证件手动填写并核对。
            </p>
          )}
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {renderDocumentUpload("BR")}
          {legalStatusNeedsManualVerification ? (
            <div
              className="rounded-md border border-[#f5d9a8] bg-[#FDF6E9] px-4 py-3 text-[12px] leading-relaxed text-[#854F0B]"
              data-testid="hk-non-company-notice"
            >
              <p className="font-medium">独资／合伙主体请联系客服核验</p>
              <p className="mt-1">
                此路线只适用于香港注册公司。独资／合伙无需提供公司注册证明书（CI），请联系客服进行人工主体核验；请勿以公司资料提交。
              </p>
            </div>
          ) : (
            renderDocumentUpload("CI")
          )}
          </div>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-[11px] leading-relaxed text-muted-foreground" data-testid="hk-registration-upload-guidance">
            <p>请核对识别结果后提交，资料仍须人工审核。</p>
            <p>支持 PDF / JPG / PNG，每份不超过 10MB</p>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="space-y-1.5">
            <Label>
              企业名称（BR业务／法团名称） <span className="text-destructive">*</span>
            </Label>
            <Input
              placeholder="BR上的业务／法团名称"
              value={form.companyName}
              onChange={event =>
                updateForm({ companyName: event.target.value })
              }
            />
          </div>
          <div className="space-y-1.5">
            <Label>中文名称（选填）</Label>
            <Input
              placeholder="若证件有中文名称，请如实填写"
              value={form.chineseName}
              onChange={event =>
                updateForm({ chineseName: event.target.value })
              }
            />
            <p className="text-[11px] text-muted-foreground">
              证件未列中文名称时可留空，不会自动翻译或编造。
            </p>
          </div>
          <div className="space-y-1.5">
            <Label>
              企业性质（业务性质） <span className="text-destructive">*</span>
            </Label>
            <Textarea
              rows={2}
              placeholder="BR上的业务性质"
              value={form.businessNature}
              onChange={event =>
                updateForm({ businessNature: event.target.value })
              }
            />
          </div>
          <div className="space-y-1.5">
            <Label>
              法律地位 <span className="text-destructive">*</span>
            </Label>
            <Input
              placeholder="BR上的法律地位"
              value={form.legalStatus}
              onChange={event =>
                updateForm({ legalStatus: event.target.value })
              }
            />
            <p className="text-[11px] text-muted-foreground">
              与业务性质分开填写；独资／合伙将转为客服人工核验。
            </p>
          </div>
          <div className="space-y-1.5">
            <Label>
              商业登记号码（BRN） <span className="text-destructive">*</span>
            </Label>
            <Input
              inputMode="numeric"
              maxLength={8}
              placeholder="8位 BRN"
              value={form.brn}
              onChange={event =>
                updateForm({ brn: event.target.value.replace(/\s/g, "") })
              }
            />
          </div>
          <div className="space-y-1.5">
            <Label>
              完整商业登记证号码 <span className="text-destructive">*</span>
            </Label>
            <Input
              placeholder="完整商业登记证号码"
              value={form.registrationNumber}
              onChange={event =>
                updateForm({ registrationNumber: event.target.value })
              }
            />
            <p className="text-[11px] text-muted-foreground">
              前 8 位必须与 BRN 一致。
            </p>
          </div>
          <div className="space-y-1.5">
            <Label>
              BR 生效日期 <span className="text-destructive">*</span>
            </Label>
            <Input
              placeholder="日/月/年（DD/MM/YYYY）"
              value={form.brStartDate}
              onChange={event =>
                updateForm({ brStartDate: event.target.value })
              }
              onBlur={event =>
                updateForm({ brStartDate: dateInputValue(event.target.value) })
              }
            />
          </div>
          <div className="space-y-1.5">
            <Label>
              BR 届满日期 <span className="text-destructive">*</span>
            </Label>
            <Input
              placeholder="日/月/年（DD/MM/YYYY）"
              value={form.brExpiryDate}
              onChange={event =>
                updateForm({ brExpiryDate: event.target.value })
              }
              onBlur={event =>
                updateForm({ brExpiryDate: dateInputValue(event.target.value) })
              }
            />
          </div>
          <div className="space-y-1.5">
            <Label>
              公司注册证编号（选填）
            </Label>
            <Input
              placeholder="CI上的公司注册证编号"
              value={form.ciNumber}
              onChange={event => updateForm({ ciNumber: event.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label>成立日期（选填）</Label>
            <Input
              placeholder="日/月/年（DD/MM/YYYY）"
              value={form.establishedAt}
              onChange={event =>
                updateForm({ establishedAt: event.target.value })
              }
              onBlur={event =>
                updateForm({
                  establishedAt: dateInputValue(event.target.value),
                })
              }
            />
            <p className="text-[11px] text-muted-foreground">
              如 CI 未列明或未能确认，可留空。
            </p>
          </div>
          <div className="space-y-1.5 md:col-span-2">
            <Label>
              营业地址 <span className="text-destructive">*</span>
            </Label>
            <Textarea
              rows={3}
              placeholder="请按 BR 原文填写地址"
              value={form.regAddress}
              onChange={event => updateForm({ regAddress: event.target.value })}
            />
          </div>
          <div className="space-y-1.5 md:col-span-2">
            <Label>企业角色（选填）</Label>
            <Input
              placeholder="可不填写"
              value={form.companyRole}
              onChange={event =>
                updateForm({ companyRole: event.target.value })
              }
            />
          </div>
        </div>

        <div className="mt-5 border-t border-border/60 pt-4">
          <h2 className="text-[15px] font-semibold text-slate-900">
            香港结算账户
          </h2>
          <p className="mt-0.5 text-[11px] text-slate-500">
            银行账户证明必传。账号保留英文、前导零和连字符；地址保留原有换行。
          </p>
        </div>
        <div className="mt-3">{renderDocumentUpload("BANK")}</div>
        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="space-y-1.5">
            <Label>
              收款人（Beneficiary） <span className="text-destructive">*</span>
            </Label>
            <Input
              maxLength={128}
              placeholder="账户名称"
              value={form.bankAccountName}
              onChange={event =>
                updateForm({ bankAccountName: event.target.value })
              }
            />
          </div>
          <div className="space-y-1.5">
            <Label>
              银行账号（Bank A/c #） <span className="text-destructive">*</span>
            </Label>
            <Input
              maxLength={64}
              placeholder="保留证件上的英文、数字与连字符"
              value={form.bankAccountNumber}
              onChange={event =>
                updateForm({ bankAccountNumber: event.target.value })
              }
            />
          </div>
          <div className="space-y-1.5 md:col-span-2">
            <Label>
              收款银行（Beneficiary Bank）{" "}
              <span className="text-destructive">*</span>
            </Label>
            <Input
              maxLength={128}
              placeholder="银行名称"
              value={form.bankName}
              onChange={event => updateForm({ bankName: event.target.value })}
            />
          </div>
          <div className="space-y-1.5 md:col-span-2">
            <Label>银行地址（Bank Address，选填）</Label>
            <Textarea
              rows={3}
              placeholder="保留银行证明上的地址及换行"
              value={form.bankAddress}
              onChange={event =>
                updateForm({ bankAddress: event.target.value })
              }
            />
          </div>
          <div className="space-y-1.5">
            <Label>SWIFT Code（选填）</Label>
            <Input
              maxLength={32}
              placeholder="SWIFT Code"
              value={form.swift}
              onChange={event => updateForm({ swift: event.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Bank Code（选填）</Label>
            <Input
              maxLength={32}
              placeholder="Bank Code"
              value={form.bankCode}
              onChange={event => updateForm({ bankCode: event.target.value })}
            />
          </div>
        </div>

        <div className="mt-5 border-t border-border/60 pt-4" data-testid="hk-submission-footer">
          <div className="space-y-3">
            <div className="space-y-1.5" style={{ maxWidth: 240 }}>
              <Label>
                销售负责人{" "}
                <span className="ml-1 text-[10px] font-normal text-muted-foreground">
                  选填
                </span>
              </Label>
              <Select
                value={form.salesOwnerCode || "unassigned"}
                disabled={salesStaffQuery.isLoading || salesStaffQuery.isError}
                onValueChange={code => {
                  const matched = salesStaffQuery.data?.find(
                    item => item.staffCode === code
                  );
                  updateForm({
                    salesOwnerCode: code === "unassigned" ? "" : code,
                    salesOwner: matched?.displayName || "",
                  });
                }}
              >
                <SelectTrigger
                  className="h-9 w-full"
                  data-testid="hk-sales-owner-select"
                >
                  <SelectValue
                    placeholder={
                      salesStaffQuery.isLoading
                        ? "正在加载销售人员…"
                        : "请选择销售负责人"
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
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div
              ref={agreementRef}
              className="relative flex min-h-9 min-w-0 items-center gap-2"
              data-testid="hk-enterprise-agreement-consent"
            >
              <Checkbox
                ref={agreementCheckboxRef}
                id="enterprise-service-agreement-hk"
                checked={agreementAccepted}
                onCheckedChange={checked => {
                  const accepted = checked === true;
                  setAgreementAccepted(accepted);
                  if (accepted) setAgreementNeedsAttention(false);
                }}
                disabled={enterpriseAgreementQuery.isLoading}
              />
              <Label
                htmlFor="enterprise-service-agreement-hk"
                className="shrink-0 cursor-pointer text-xs font-normal text-foreground"
              >
                同意
              </Label>
              <a
                href="/enterprise-service-agreement"
                target="_blank"
                rel="noreferrer"
                className="min-w-0 text-xs font-normal text-foreground underline-offset-2 hover:underline"
              >
                《51电子网开通企业服务协议》
                {ENTERPRISE_SERVICE_AGREEMENT_VERSION}
              </a>
              <span className="shrink-0 text-[10px] text-muted-foreground">
                必选
              </span>
              <p
                className={`absolute left-6 top-full mt-0.5 text-[10px] text-muted-foreground transition-opacity ${agreementNeedsAttention ? "opacity-100" : "pointer-events-none opacity-0"}`}
                aria-live="polite"
              >
                请先阅读并同意服务协议
              </p>
            </div>
            <Button
              className="h-9 shrink-0 bg-[#185FA5] px-5 text-xs hover:bg-[#0C447C]"
              disabled={busy || enterpriseAgreementQuery.isLoading}
              onClick={handleSubmit}
            >
              {submitMutation.isPending && (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              )}
              {submitted && reviewStatus !== "approved"
                ? "重新提交审核"
                : saveButtonText}
            </Button>
            </div>
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
      </fieldset>
    </Card>
  );
}
