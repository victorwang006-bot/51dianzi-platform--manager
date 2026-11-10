import { trpc } from "../../../../../api/business-trpc";
import { contactErrorMessage, formatContactMethod, withCustomerContactScope, type CustomerContactScope } from "./customerContacts";

export function CustomerWorkbenchContacts({ customerId, scope, scopeReady }: {
  customerId: number; scope: CustomerContactScope | null; scopeReady: boolean;
}) {
  const query = trpc.customer.contactsList.useQuery(scope
    ? withCustomerContactScope(scope, { customerId })
    : { customerId, expectedActorUserId: 0, expectedEnterpriseId: 0 }, {
    enabled: scopeReady && Boolean(scope), retry: false, staleTime: 0, placeholderData: undefined,
  });
  const result = scopeReady && scope && !query.isError && !query.isFetching && !query.isPlaceholderData && query.isFetchedAfterMount !== false
    && query.data?.customer.id === customerId ? query.data : undefined;
  const contacts = result?.contacts.filter(contact => !contact.stoppedAt) ?? [];
  if (query.isError) return <p role="alert" className="customer-workbench-empty">读取联系人失败：{contactErrorMessage(query.error)} <button type="button" className="crm-link" onClick={() => void query.refetch()}>重试</button></p>;
  if (!result) return <p className="customer-workbench-empty" role="status">正在读取联系人…</p>;
  return contacts.length ? <div className="customer-workbench-contacts">{contacts.map(contact => <article key={contact.id}>
    <div><strong>{contact.name}</strong>{contact.isPrimary && <span className="crm-badge bg-blue-50 text-[#185FA5]">主联系人</span>}</div>
    {(contact.department || contact.position) && <p className="customer-detail-meta">{[contact.department, contact.position].filter(Boolean).join(" · ")}</p>}
    <p>{contact.methods.map(formatContactMethod).join("；") || "未填写联系方式"}</p>
  </article>)}</div> : <p className="customer-workbench-empty">暂无有效联系人，可在管理联系人中维护。</p>;
}
