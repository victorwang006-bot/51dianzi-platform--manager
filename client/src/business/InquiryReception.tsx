import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { ArrowLeft, Info, Mail, MessageCircle, Pin, RefreshCw, Search, UsersRound, Volume2, VolumeX, X } from "lucide-react";
import ChatPage from "./platform/client/src/pages/ChatPage";
import UserAvatar from "./platform/client/src/components/UserAvatar";
import BusinessContentFrame from "./BusinessContentFrame";
import { BUSINESS_CHAT_PERSONAL_FLOW_MESSAGES } from "./BusinessChatContract";
import { useInquiryReception, useInquiryReceptionNotice } from "./useInquiryReception";
import {
  filterReceptionQueue, INQUIRY_RECEPTION_FILTER_LABELS, receptionConversationId, receptionInquiryId, receptionRequestedQuantity,
  type InquiryReceptionFilter, type InquiryReceptionRow, type ReceptionConversation,
} from "./InquiryReceptionModel";
import { groupReceptionQueue, receptionMaterialKey, sortReceptionQueue } from "./InquiryReceptionGrouping";
import { formatBeijingDateTime, formatBeijingRelativeTime } from "./platform/shared/beijingTime";
import "./InquiryReception.css";

// Match the front chat's five original gradients. Never assign a customer's color
// from row/conversation IDs or a display name; those are not buyer identities.
const AVATAR_COLORS = [
  "bg-gradient-to-br from-[#2B7AE8] to-[#185FA5]",
  "bg-gradient-to-br from-[#43a867] to-[#2d7a4f]",
  "bg-gradient-to-br from-[#f0893a] to-[#c9610d]",
  "bg-gradient-to-br from-[#9b59b6] to-[#6c3483]",
  "bg-gradient-to-br from-[#17a2b8] to-[#0d6675]",
];
type MessageSection = "all" | "unread" | "pinned";
// Older reception DTOs may omit these fields. Their absence never implies a
// synthetic avatar, pin, or permission to call a pin mutation.
type ReceptionListConversation = ReceptionConversation & { pinned?: boolean; otherUserAvatar?: string | null };
type ReceptionListRow = InquiryReceptionRow & { buyerId?: number | null };
const positiveId = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value > 0;
const freshNavigation = (scope: string) => ({ scope, materialKey: null as string | null, section: "all" as MessageSection, filter: "all" as InquiryReceptionFilter, text: "", mobileNavigation: "queue" as "messages" | "queue", sidebarOpen: false });

export default function InquiryReception({ canReply = false }: { canReply?: boolean }) {
  const rootRef = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const section = rootRef.current;
    if (!section) return;
    const measure = () => {
      const height = window.visualViewport?.height ?? window.innerHeight;
      const top = section.getBoundingClientRect().top;
      section.style.setProperty("--reception-height", `${Math.max(0, height - Math.max(0, top))}px`);
    };
    measure();
    window.addEventListener("resize", measure);
    window.visualViewport?.addEventListener("resize", measure);
    window.visualViewport?.addEventListener("scroll", measure);
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    // Navigation height may change through responsive wrapping or merchant labels.
    document.querySelectorAll('header, nav, [aria-label="后台导航"], [data-business-navigation]').forEach(node => observer?.observe(node));
    if (section.parentElement) observer?.observe(section.parentElement);
    return () => {
      window.removeEventListener("resize", measure);
      window.visualViewport?.removeEventListener("resize", measure);
      window.visualViewport?.removeEventListener("scroll", measure);
      observer?.disconnect();
    };
  }, []);
  const data = useInquiryReception();
  const search = useSearch();
  const [location, navigate] = useLocation();
  const selectedId = receptionConversationId(search);
  const selectedInquiryId = receptionInquiryId(search);
  const hasInquirySelection = new URLSearchParams(search).has("inquiryId");
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [view, setView] = useState<"mine" | "team">("mine");
  const loading = data.enterprise.isLoading || data.inbox.isPending || data.query.isLoading;
  const error = data.enterprise.error || data.inbox.error || data.query.error;
  const scopeKey = JSON.stringify([data.scope.storageScope, data.scope.contextVerification.authorizationVersion, view, data.canReceive, !!error]);
  const [navigation, setNavigation] = useState(() => freshNavigation(scopeKey));
  const scopeCurrent = navigation.scope === scopeKey;
  // Mask the previous scope in render, before the reset effect runs. This also
  // withdraws summary/chat/notice when permission or a queue read fails.
  const current = scopeCurrent ? navigation : freshNavigation(scopeKey);
  const ready = data.canReceive && !error && scopeCurrent;
  useEffect(() => {
    setNavigation(previous => previous.scope === scopeKey ? previous : freshNavigation(scopeKey));
    setSummaryOpen(false);
  }, [scopeKey]);
  const notice = useInquiryReceptionNotice(data.scope.storageScope, data.conversations, ready && data.query.isSuccess);
  useEffect(() => { notice.dismiss(); }, [scopeKey]);
  const conversationById = useMemo(() => new Map<number, ReceptionListConversation>(data.conversations.map(item => [item.id, item])), [data.conversations]);
  const allRows = ready ? data.inbox.data ?? [] : [];
  const ownerCanSupervise = data.enterprise.data?.isOwner === true;
  // Supervision never claims the assigned staff actor, even for the owner's own conversation.
  const authorizedRows = allRows.filter(row => view === "team" && ownerCanSupervise || conversationById.has(row.conversationId));
  const groups = groupReceptionQueue(authorizedRows, data.conversations, "all", "");
  const activeGroup = groups.find(group => group.key === current.materialKey);
  const materialRows = current.materialKey ? authorizedRows.filter(row => receptionMaterialKey(row) === current.materialKey) : authorizedRows;
  const queue = sortReceptionQueue(filterReceptionQueue(materialRows, data.conversations, current.filter, current.text)
    .filter(row => current.section !== "pinned" || conversationById.get(row.conversationId)?.pinned === true), data.conversations);
  const unreadConversationCount = new Set(authorizedRows.filter(row => Number(conversationById.get(row.conversationId)?.unreadCount) > 0).map(row => row.conversationId)).size;
  const selected = authorizedRows.find(row => row.conversationId === selectedId && (!hasInquirySelection || selectedInquiryId !== null && row.id === selectedInquiryId));
  const canOpenConversation = ready && view === "mine" && !!selectedId && conversationById.has(selectedId);
  const chooseSection = (section: MessageSection, clearMaterial = false) => setNavigation(previous => ({
    ...(previous.scope === scopeKey ? previous : freshNavigation(scopeKey)), section, filter: section === "unread" ? "unread" : "all",
    ...(clearMaterial ? { materialKey: null } : {}), mobileNavigation: "queue", sidebarOpen: false,
  }));
  const chooseMaterial = (key: string) => setNavigation(previous => ({
    ...freshNavigation(scopeKey), materialKey: previous.scope === scopeKey && previous.materialKey === key ? null : key,
  }));
  const openConversation = (conversationId: number | null, inquiryId?: number) => {
    const params = new URLSearchParams(search);
    if (conversationId) params.set("conversationId", String(conversationId));
    else params.delete("conversationId");
    if (conversationId && inquiryId) params.set("inquiryId", String(inquiryId));
    else params.delete("inquiryId");
    // Keep merchant/enterprise URL scope, never fabricate a participant or grant.
    navigate(`${location.split("?")[0]}${params.size ? `?${params}` : ""}`);
    setSummaryOpen(false);
    setNavigation(previous => ({ ...previous, mobileNavigation: "queue", sidebarOpen: false }));
  };
  const renderCustomer = (row: InquiryReceptionRow) => {
    const conversation = conversationById.get(row.conversationId);
    const unread = Math.max(0, Number(conversation?.unreadCount) || 0);
    const name = row.buyerCompanyName || row.buyerName || conversation?.otherUserName || "采购客户";
    const buyerId = positiveId((row as ReceptionListRow).buyerId) ? (row as ReceptionListRow).buyerId! : conversation?.otherUserId;
    const color = positiveId(buyerId) ? AVATAR_COLORS[buyerId % AVATAR_COLORS.length] : "";
    // Only the actual conversation DTO's returned avatar can become an image.
    const avatarUrl = typeof conversation?.otherUserAvatar === "string" && conversation.otherUserAvatar.trim() ? conversation.otherUserAvatar : null;
    const requestedQty = receptionRequestedQuantity(row);
    const title = `${name} · ${row.partNumber} · ${requestedQty !== null ? `采购数量 ${requestedQty}` : "数量待确认"} · ${INQUIRY_RECEPTION_FILTER_LABELS[row.status]}`;
    return <button key={row.id} type="button" className="inquiry-reception__item" title={title} data-inquiry-id={row.id} data-unread={unread > 0 ? "true" : "false"} data-pinned={conversation?.pinned === true ? "true" : "false"} aria-pressed={selected?.id === row.id} onClick={() => openConversation(row.conversationId, row.id)}>
      <span className={`inquiry-reception__avatar ${avatarUrl ? "" : color}`} data-avatar-user-id={positiveId(buyerId) ? buyerId : undefined}>
        {avatarUrl ? <UserAvatar key={`${buyerId}:${avatarUrl}`} avatarUrl={avatarUrl} name={name} userId={positiveId(buyerId) ? buyerId : undefined} className="inquiry-reception__avatar inquiry-reception__avatar-image" fallbackClassName={color} /> : name.charAt(0)}
      </span>
      <span className="inquiry-reception__item-body">
        <span className="inquiry-reception__item-top"><strong title={name}>{name}</strong>{conversation?.pinned === true ? <Pin size={12} aria-label="已置顶" /> : null}<time title={formatBeijingDateTime(conversation?.lastMessageAt || row.lastActivityAt || row.createdAt)}>{formatBeijingRelativeTime(conversation?.lastMessageAt || row.lastActivityAt || row.createdAt)}</time></span>
        <span className="inquiry-reception__preview-row"><span className="inquiry-reception__preview">{conversation?.lastMessagePreview || (conversation ? row.brand || "询价" : "监督记录 · 非本人参与会话")}</span>{unread > 0 ? <span className="inquiry-reception__unread" aria-label={`${unread} 条询价未读`}>{unread > 99 ? "99+" : unread}</span> : null}</span>
      </span>
    </button>;
  };
  return <BusinessContentFrame>
    <section ref={rootRef} className="inquiry-reception" data-inquiry-reception data-detail={selectedId ? "true" : "false"} data-navigation={current.mobileNavigation} data-sidebar-open={current.sidebarOpen ? "true" : "false"} aria-label="询价接待">
      {ready && notice.notice ? <div className="inquiry-reception__notice" role="status" aria-live="polite">{notice.notice}<button type="button" aria-label="关闭新询价提示" onClick={notice.dismiss}><X size={14} /></button></div> : null}
      {!data.enterprise.isLoading && !data.canReceive ? <p className="inquiry-reception__state" role="alert">当前真实员工未获得询价接待权限或接待尚未安全就绪；库存权限不能代替 inquiry.receive。</p> : error ? <p className="inquiry-reception__state" role="alert">询价读取失败：{error.message}<button type="button" onClick={() => void data.refresh()}>重试</button></p> : <div className="inquiry-reception__panels">
        <aside className="inquiry-reception__sidebar" aria-label="消息与询价分组">
          <button type="button" className="inquiry-reception__mobile-back inquiry-reception__sidebar-close" onClick={() => setNavigation(previous => ({ ...previous, mobileNavigation: "queue", sidebarOpen: false }))}><ArrowLeft size={15} />返回会话</button>
          <div className="inquiry-reception__sidebar-section inquiry-reception__sidebar-heading">消息</div>
          {(["all", "unread", "pinned"] as const).map(section => {
            const Icon = section === "all" ? MessageCircle : section === "unread" ? Mail : Pin;
            return <button key={section} type="button" className="inquiry-reception__nav-item" aria-pressed={current.section === section && !current.materialKey && (current.filter === "all" || current.filter === "unread")} onClick={() => chooseSection(section, true)}><Icon size={15} aria-hidden="true" /><span className="inquiry-reception__nav-label">{section === "all" ? "全部会话" : section === "unread" ? "未读消息" : "已置顶"}</span>{section === "unread" && unreadConversationCount > 0 ? <span className="inquiry-reception__unread" aria-label={`${unreadConversationCount} 个未读会话`}>{unreadConversationCount > 99 ? "99+" : unreadConversationCount}</span> : null}</button>;
          })}
          <div className="inquiry-reception__sidebar-section inquiry-reception__sidebar-heading inquiry-reception__group-heading">询价分组</div>
          <div className="inquiry-reception__groups inquiry-reception__group-list">
            {loading && !allRows.length ? <p className="inquiry-reception__state">正在读取分组…</p> : !groups.length ? <p className="inquiry-reception__state">暂无询价分组</p> : groups.map(group => <button key={group.key} type="button" className="inquiry-reception__group-item" data-material-key={group.key} aria-pressed={current.materialKey === group.key} title={`${group.partNumber} · ${group.brand} · ${group.sourceSummary}`} onClick={() => chooseMaterial(group.key)}>
              <UsersRound size={15} aria-hidden="true" /><span className="inquiry-reception__group-title inquiry-reception__group-label">{group.partNumber}</span><span className="inquiry-reception__group-stats inquiry-reception__group-count">{group.customerCount}家</span>{group.unreadCount > 0 ? <span className="inquiry-reception__unread" aria-label={`${group.unreadCount} 条会话未读（已去重）`}>{group.unreadCount > 99 ? "99+" : group.unreadCount}</span> : null}
            </button>)}
          </div>
          <div className="inquiry-reception__sidebar-section inquiry-reception__sidebar-heading">接待状态</div>
          <div className="inquiry-reception__status-filters" role="group" aria-label="询价状态">
            {(["open", "replied", "closed"] as const).map(filter => <button key={filter} type="button" className="inquiry-reception__nav-item" aria-pressed={current.filter === filter} onClick={() => setNavigation(previous => ({ ...previous, filter, section: "all", mobileNavigation: "queue", sidebarOpen: false }))}>{INQUIRY_RECEPTION_FILTER_LABELS[filter]}</button>)}
          </div>
          <div className="inquiry-reception__sidebar-footer inquiry-reception__sidebar-controls" role="group" aria-label="接待范围与操作">
            {ownerCanSupervise ? <select aria-label="接待查看范围" value={view} onChange={event => setView(event.target.value as "mine" | "team")}><option value="mine">我的接待</option><option value="team">企业监督（仅查看）</option></select> : <span className="inquiry-reception__scope-label">我的接待</span>}
            <button type="button" onClick={() => void data.refresh()} disabled={!data.canReceive || data.inbox.isFetching || data.query.isFetching} aria-label="刷新询价"><RefreshCw size={15} />刷新</button>
            <button type="button" aria-pressed={notice.sound} aria-label={notice.sound ? "关闭询价提示音" : "开启询价提示音"} onClick={() => notice.setSound(!notice.sound)}>{notice.sound ? <Volume2 size={15} /> : <VolumeX size={15} />}<span>提示音{notice.sound ? "开" : "关"}</span></button>
          </div>
        </aside>
        <aside className="inquiry-reception__queue" aria-label="受权询价队列" aria-busy={loading}>
          <div className="inquiry-reception__queue-header"><div className="inquiry-reception__queue-title inquiry-reception__queue-heading"><button type="button" className="inquiry-reception__sidebar-toggle inquiry-reception__messages-back" aria-label="打开消息导航" aria-expanded={current.sidebarOpen} onClick={() => setNavigation(previous => ({ ...previous, mobileNavigation: "messages", sidebarOpen: !previous.sidebarOpen }))}><ArrowLeft size={15} />返回消息</button><h2>会话</h2>{activeGroup ? <span className="inquiry-reception__queue-material" title={`${activeGroup.brand} · ${activeGroup.sourceSummary}`}>{activeGroup.partNumber} · {activeGroup.customerCount}家</span> : null}</div>
            <label className="inquiry-reception__search"><Search size={15} aria-hidden="true" /><input aria-label="搜索客户或型号" placeholder="搜索联系人..." value={current.text} onChange={event => setNavigation(previous => ({ ...previous, text: event.target.value }))} /></label>
          </div>
          <div className="inquiry-reception__queue-filters" role="group" aria-label="会话筛选">
            {(["all", "unread", "pinned"] as const).map(section => <button key={section} type="button" aria-pressed={current.section === section && (current.filter === "all" || current.filter === "unread")} onClick={() => chooseSection(section)}>{section === "all" ? "全部" : section === "unread" ? "未读" : "置顶"}</button>)}
          </div>
          <div className="inquiry-reception__queue-list">{loading && !allRows.length ? <p className="inquiry-reception__state">正在读取询价…</p> : !queue.length ? <p className="inquiry-reception__state">暂无符合条件的询价</p> : queue.map(renderCustomer)}</div>
        </aside>
        <main className="inquiry-reception__conversation" aria-label="原企业接待会话">
          {selectedId ? <div className="inquiry-reception__detail-bar"><button type="button" className="inquiry-reception__back" onClick={() => openConversation(null)}><ArrowLeft size={15} />返回会话</button><span>{selected?.partNumber || "询价会话"}</span>{selected ? <button type="button" className="inquiry-reception__summary-trigger" onClick={() => setSummaryOpen(true)}><Info size={15} />业务摘要</button> : null}</div> : null}
          {canOpenConversation ? <ChatPage businessReception={{ requiredPermission: "inquiry.receive", personalFlowMessages: BUSINESS_CHAT_PERSONAL_FLOW_MESSAGES }} receptionConversation={{ conversationId: selectedId!, onBack: () => openConversation(null), canReply }} /> : <div className={`inquiry-reception__empty-state${view === "team" || selectedId ? " inquiry-reception__readonly-state" : ""}`} data-empty-kind={view === "team" ? "supervision" : selectedId ? "unavailable" : "idle"} role={view === "team" || selectedId ? "status" : undefined}>{view === "mine" && !selectedId ? <span className="inquiry-reception__empty-icon" aria-hidden="true">💬</span> : null}<p>{view === "team" ? "企业监督仅查看询价摘要。监督查看不会成为参与人，也不能回复或自动标为已读；切换“我的接待”后可进入本人会话。" : selectedId ? "该记录不属于当前员工参与的受权接待会话。监督查看不会成为参与人，也不能回复或自动标为已读。" : "选择一个会话开始聊天"}</p></div>}
        </main>
      </div>}
      {summaryOpen && selected && ready ? <SummaryDrawer onClose={() => setSummaryOpen(false)} row={selected} /> : null}
    </section>
  </BusinessContentFrame>;
}

export function InquiryReceptionSummary({ row }: { row?: InquiryReceptionRow }) {
  if (!row) return <p className="inquiry-reception__state">选择询价后查看业务摘要</p>;
  const requestedQty = receptionRequestedQuantity(row);
  const details: [string, string][] = [
    ["型号", row.partNumber], ["品牌", row.brand || "—"], ["采购数量", requestedQty !== null ? String(requestedQty) : "数量待确认"],
    ["采购客户", row.buyerCompanyName || row.buyerName || "—"],
    ["来源工厂", row.sourceFactoryName || row.sourceLabel || "原询价未提供来源快照"],
    ["接待负责人", row.assigneeName || "服务端尚未提供负责人快照"],
    ["询价时间", formatBeijingDateTime(row.createdAt)], ["状态", INQUIRY_RECEPTION_FILTER_LABELS[row.status]],
  ];
  return <div className="inquiry-reception__summary-content"><h2>本次询价</h2><dl>{details.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl><p>来源标签不代替卖方企业身份。客户联系方式、库存资料仍遵循原会话和库存权限。</p></div>;
}

function SummaryDrawer({ row, onClose }: { row: InquiryReceptionRow; onClose: () => void }) {
  // Native modal dialog supplies keyboard focus containment and Escape close.
  return <dialog className="inquiry-reception__drawer" ref={node => { if (node && !node.open) node.showModal(); }} onCancel={onClose} aria-label="本次询价业务摘要"><button type="button" className="inquiry-reception__drawer-close" onClick={onClose} autoFocus><X size={15} />关闭摘要</button><InquiryReceptionSummary row={row} /></dialog>;
}
