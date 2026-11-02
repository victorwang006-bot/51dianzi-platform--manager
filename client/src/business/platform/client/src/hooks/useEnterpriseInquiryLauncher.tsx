import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { InquiryEnterpriseChooserDialog } from "../components/InquiryEnterpriseChooserDialog";
import { isOperatingEnterprise, useEnterpriseSession } from "../contexts/EnterpriseSessionContext";
import { createSearchInquiryUrl, type SearchInquiryIntent } from "../lib/searchInquiry";

type InquiryLaunchIntent = Omit<SearchInquiryIntent, "inquiryEnterpriseId">;
type PendingInquiry = { accountId: number; intent: InquiryLaunchIntent; open: (url: string) => void };

/** Source pages use only the authenticated buyer's explicit operating selection. */
export function useEnterpriseInquiryLauncher() {
  const session = useEnterpriseSession();
  const [pending, setPending] = useState<PendingInquiry | null>(null);
  useEffect(() => {
    setPending(current => current?.accountId === session.accountId && session.isAuthenticated ? current : null);
  }, [session.accountId, session.isAuthenticated]);

  const openForEnterprise = useCallback((intent: InquiryLaunchIntent, enterpriseId: number, open: (url: string) => void) => {
    open(createSearchInquiryUrl({ ...intent, inquiryEnterpriseId: enterpriseId }));
  }, []);

  const launchInquiry = useCallback((intent: InquiryLaunchIntent, open: (url: string) => void) => {
    if (session.authLoading || session.isLoading || session.isRestoringSelection) {
      toast.info("正在加载可询价企业，请稍候");
      return false;
    }
    if (!session.isAuthenticated || session.accountId === null || intent.buyerUserId !== session.accountId) {
      toast.error("询价账号已变化，请登录后重新发起");
      return false;
    }
    if (session.error || session.invalidUrlEnterpriseId) {
      toast.error("企业身份暂不可用，请重新选择企业后发起询价");
      return false;
    }
    const active = session.activeEnterprise;
    if (session.hasExplicitSelection && isOperatingEnterprise(active ?? undefined)) {
      openForEnterprise(intent, active!.enterpriseId, open);
      return true;
    }
    setPending({ accountId: session.accountId, intent, open });
    return false;
  }, [openForEnterprise, session]);

  const chooser = useMemo(() => (
    <InquiryEnterpriseChooserDialog
      open={pending !== null && pending.accountId === session.accountId && session.isAuthenticated}
      onOpenChange={open => { if (!open) setPending(null); }}
      onSelect={enterpriseId => {
        if (!pending || pending.accountId !== session.accountId || !session.isAuthenticated) {
          setPending(null);
          return;
        }
        if (!isOperatingEnterprise(session.items.find(item => item.enterpriseId === enterpriseId))) {
          setPending(null);
          return;
        }
        const current = pending;
        setPending(null);
        openForEnterprise(current.intent, enterpriseId, current.open);
      }}
    />
  ), [openForEnterprise, pending, session]);

  return { launchInquiry, inquiryEnterpriseChooser: chooser };
}
