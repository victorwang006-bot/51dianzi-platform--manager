import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "../ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { trpc } from "../../../../../api/business-trpc";
import type { ContactsListInput } from "../../../../shared/customerContacts";
import {
  contactErrorMessage,
  formatContactMethod,
  withCustomerContactScope,
  type ContactRecord,
  type CustomerContactScope,
} from "./customerContacts";
import "./CustomerContactsSummary.css";

export type CustomerContactsSummaryProps = {
  customerId: number;
  contactName?: string | null;
  primaryMethod?: string | null;
  contactCount?: number | null;
  scope: CustomerContactScope | null;
  scopeReady: boolean;
  identityKey: string;
};

/**
 * A compact row summary.  It deliberately does not call contactsList until the
 * user asks to see more; list-page counts come from one page-bounded summary query.
 */
export function CustomerContactsSummary({
  customerId,
  contactName,
  primaryMethod,
  contactCount,
  scope,
  scopeReady,
  identityKey,
}: CustomerContactsSummaryProps) {
  const utils = trpc.useUtils();
  const [open, setOpen] = useState(false);
  const [openedIdentity, setOpenedIdentity] = useState(identityKey);
  const previousIdentityRef = useRef(identityKey);
  const canRead = scopeReady && Boolean(scope);
  // Hide old-identity content during render, before the cache-reset effect runs.
  const currentOpen = open && canRead && openedIdentity === identityKey;
  const queryInput: ContactsListInput = scope
    ? withCustomerContactScope(scope, { customerId })
    : { customerId, expectedActorUserId: 0, expectedEnterpriseId: 0 };
  const listQuery = trpc.customer.contactsList.useQuery(queryInput, {
    enabled: currentOpen,
    retry: false,
    staleTime: 0,
  });

  useEffect(() => {
    if (previousIdentityRef.current !== identityKey) {
      setOpen(false);
      void utils.customer.contactsList.reset();
    }
    previousIdentityRef.current = identityKey;
  }, [identityKey, utils]);

  const count = Number.isFinite(Number(contactCount)) ? Math.max(0, Math.floor(Number(contactCount))) : 0;
  const hasMore = count > 1;
  const contacts = useMemo(() => currentOpen ? (listQuery.data?.contacts ?? []).filter(contact => !contact.stoppedAt) : [], [currentOpen, listQuery.data?.contacts]);
  const title = [contactName?.trim() || "未填写联系人", primaryMethod?.trim()].filter(Boolean).join(" · ");

  return <Popover open={currentOpen} onOpenChange={next => {
    if (!next || canRead) {
      if (next) setOpenedIdentity(identityKey);
      setOpen(next);
    }
  }}>
    <div className="customer-contacts-summary" title={title || undefined}>
      <span className="customer-contacts-summary__name">{contactName?.trim() || "—"}</span>
      <span className="customer-contacts-summary__method" title={primaryMethod || undefined}>{primaryMethod?.trim() || "—"}</span>
      {hasMore ? <PopoverTrigger asChild>
        <button type="button" className="customer-contacts-summary__more" disabled={!canRead}>更多</button>
      </PopoverTrigger> : null}
    </div>
    <PopoverContent align="start" collisionPadding={12} className="z-[70] w-[min(360px,calc(100vw-24px))] p-3 text-xs">
      <div className="mb-2 flex items-center justify-between gap-2 border-b border-slate-100 pb-2">
        <strong className="min-w-0 truncate text-slate-800">联系人</strong>
        {hasMore ? <span className="shrink-0 text-[11px] text-slate-500">共 {count} 位</span> : null}
      </div>
      {!canRead ? <p className="text-slate-500">登录身份或企业上下文已变化，已关闭联系人读取。</p> : listQuery.isPending || listQuery.isLoading ? <p className="flex items-center gap-2 py-2 text-slate-500"><Loader2 className="h-3.5 w-3.5 animate-spin" />正在加载联系人…</p> : listQuery.isError ? <div className="space-y-2"><p className="text-red-700">读取失败：{contactErrorMessage(listQuery.error)}</p><Button type="button" size="sm" variant="outline" className="h-7 px-2 text-[11px]" onClick={() => void listQuery.refetch()}>重试</Button></div> : contacts.length ? <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
        {contacts.map(contact => <ContactLine key={contact.id} contact={contact} />)}
      </div> : <p className="py-2 text-slate-500">暂无有效联系人</p>}
    </PopoverContent>
  </Popover>;
}

function ContactLine({ contact }: { contact: ContactRecord }) {
  const title = [contact.department, contact.position].filter(Boolean).join(" · ");
  return <article className="border-b border-slate-100 pb-2 last:border-b-0 last:pb-0">
    <div className="flex flex-wrap items-center gap-1.5"><strong className="text-slate-800">{contact.name}</strong>{contact.isPrimary ? <span className="rounded bg-blue-50 px-1.5 py-0.5 text-[10px] text-[#185FA5]">主联系人</span> : null}</div>
    {title ? <p className="mt-0.5 text-[11px] text-slate-500">{title}</p> : null}
    <p className="mt-1 break-all leading-5 text-slate-700">{contact.methods.map(formatContactMethod).join("；") || "未填写联系方式"}</p>
  </article>;
}
