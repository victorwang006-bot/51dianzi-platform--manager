import { Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import {
  isOperatingEnterprise,
  type EnterpriseChoice,
  useEnterpriseSession,
} from "../contexts/EnterpriseSessionContext";
import { toast } from "sonner";

function accessStatusLabel(status: EnterpriseChoice["accessStatus"]) {
  return ({ enabled: "已开通", pending: "审核中", rejected: "已驳回", disabled: "不可用" } as const)[status];
}

/**
 * 询价只能以有效经营企业发起；不要复用工作台选择器，后者仍可显示待审核企业。
 */
export function InquiryEnterpriseChooserDialog({
  open,
  onOpenChange,
  onSelect,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (enterpriseId: number) => void;
}) {
  const session = useEnterpriseSession();
  const operatingEnterprises = session.items.filter(isOperatingEnterprise);

  const choose = (enterpriseId: number) => {
    const result = session.selectEnterprise(enterpriseId);
    if (result === "busy") {
      toast.info("当前企业仍有上传或提交任务，请等待完成后再切换");
      return;
    }
    if (result === "dirty") return;
    if (result === "invalid") {
      toast.error("该企业当前不可作为询价企业");
      return;
    }
    onOpenChange(false);
    onSelect(enterpriseId);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[calc(100%-2rem)] sm:max-w-[520px]" data-testid="inquiry-enterprise-chooser">
        <DialogHeader>
          <DialogTitle>请选择询价企业</DialogTitle>
          <DialogDescription>
            本次询价将以您选择的企业身份发送。不同企业的会话、询价和权限相互独立。
          </DialogDescription>
        </DialogHeader>
        {session.authLoading || session.isLoading ? (
          <div className="flex min-h-28 items-center justify-center gap-2 text-sm text-slate-500" data-testid="inquiry-enterprise-chooser-loading">
            <Loader2 className="size-4 animate-spin" />正在加载企业列表…
          </div>
        ) : session.error ? (
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-3 text-sm text-red-700" role="alert">
            企业列表加载失败：{session.error.message}
          </div>
        ) : operatingEnterprises.length ? (
          <div className="grid max-h-[min(52vh,420px)] gap-2 overflow-y-auto pr-1">
            {operatingEnterprises.map(item => (
              <button
                key={item.enterpriseId}
                type="button"
                onClick={() => choose(item.enterpriseId)}
                className="flex min-h-16 items-center justify-between gap-4 rounded-lg border border-[#dfe8f1] bg-white px-3 py-3 text-left transition-colors hover:border-[#9fc4e4] hover:bg-[#f7fbff] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#185FA5]"
                data-testid={`inquiry-enterprise-choice-${item.enterpriseId}`}
              >
                <span className="min-w-0">
                  <strong className="block truncate text-sm font-medium text-slate-800">{item.companyName}</strong>
                  <span className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
                    <span>{item.role || (item.isOwner ? "企业所有者" : "企业成员")}</span>
                    <span aria-hidden="true">·</span>
                    <span className="text-emerald-700">{accessStatusLabel(item.accessStatus)}</span>
                  </span>
                </span>
                <span className="shrink-0 text-xs font-medium text-[#185FA5]">选择</span>
              </button>
            ))}
          </div>
        ) : (
          <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-900" data-testid="inquiry-enterprise-chooser-empty">
            暂无可用于询价的已开通企业，请先完成企业开通或等待审核通过。
          </div>
        )}
        <DialogFooter>
          <button type="button" className="crm-btn h-9" onClick={() => onOpenChange(false)}>取消</button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
