import { useEffect, useId, useMemo, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { ArrowLeft, ChevronDown, ChevronRight, Info, RefreshCw, Search, Volume2, VolumeX, X } from "lucide-react";
import ChatPage from "./platform/client/src/pages/ChatPage";
import BusinessContentFrame from "./BusinessContentFrame";
import { BUSINESS_CHAT_PERSONAL_FLOW_MESSAGES } from "./BusinessChatContract";
import { useInquiryReception, useInquiryReceptionNotice } from "./useInquiryReception";
import {
  filterReceptionQueue, INQUIRY_RECEPTION_FILTER_LABELS, receptionConversationId, receptionInquiryId, receptionRequestedQuantity,
  type InquiryReceptionFilter, type InquiryReceptionRow,
} from "./InquiryReceptionModel";
import { groupReceptionQueue, sortReceptionQueue, type InquiryReceptionQueueMode } from "./InquiryReceptionGrouping";
import { formatBeijingDateTime } from "./platform/shared/beijingTime";
import "./InquiryReception.css";

export default function InquiryReception({ canReply = false }: { canReply?: boolean }) {
  const data = useInquiryReception();
  const search = useSearch();
  const [location, navigate] = useLocation();
  const selectedId = receptionConversationId(search);
  const selectedInquiryId = receptionInquiryId(search);
  const hasInquirySelection = new URLSearchParams(search).has("inquiryId");
  const [filter, setFilter] = useState<InquiryReceptionFilter>("all");
  const [text, setText] = useState("");
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [view, setView] = useState<"mine" | "team">("mine");
  const [queueMode, setQueueMode] = useState<InquiryReceptionQueueMode>("material");
  const queueId = useId();
  const notice = useInquiryReceptionNotice(data.scope.storageScope, data.conversations, data.canReceive && data.query.isSuccess);
  const conversationById = useMemo(() => new Map(data.conversations.map(item => [item.id, item])), [data.conversations]);
  const allRows = data.inbox.isError ? [] : data.inbox.data ?? [];
  const ownerCanSupervise = data.enterprise.data?.isOwner === true;
  // A server-authorized owner inbox may contain colleagues' assignments. Merely
  // seeing those rows never selects somebody else's conversation or claims their actor.
  const authorizedRows = allRows.filter(row => view === "team" && ownerCanSupervise || conversationById.has(row.conversationId));
  const queue = sortReceptionQueue(filterReceptionQueue(authorizedRows, data.conversations, filter, text), data.conversations);
  const groups = groupReceptionQueue(authorizedRows, data.conversations, filter, text);
  const expansionScope = JSON.stringify([data.scope.storageScope, data.scope.contextVerification.authorizationVersion, view]);
  const [expansion, setExpansion] = useState<{ scope: string; initialized: boolean; keys: string[] }>(() => ({ scope: expansionScope, initialized: false, keys: [] }));
  const expandedKeys = expansion.scope === expansionScope ? expansion.keys : [];
  useEffect(() => {
    if (expansion.scope !== expansionScope) {
      // A changed identity/permission/view cannot carry old expansion state.
      setExpansion({ scope: expansionScope, initialized: true, keys: [] });
      setSummaryOpen(false);
    } else if (!expansion.initialized && groups.length) {
      setExpansion({ scope: expansionScope, initialized: true, keys: [(groups.find(group => group.unreadCount > 0) || groups[0]).key] });
    }
  }, [expansionScope, expansion, groups]);
  const toggleGroup = (key: string) => setExpansion(previous => {
    const keys = previous.scope === expansionScope ? previous.keys : [];
    return { scope: expansionScope, initialized: true, keys: keys.includes(key) ? keys.filter(value => value !== key) : [...keys, key] };
  });
  const selected = allRows.find(row => row.conversationId === selectedId && (!hasInquirySelection || selectedInquiryId !== null && row.id === selectedInquiryId));
  const canOpenConversation = view === "mine" && !!selectedId && conversationById.has(selectedId);
  const openConversation = (conversationId: number | null, inquiryId?: number) => {
    const params = new URLSearchParams(search);
    if (conversationId) params.set("conversationId", String(conversationId));
    else params.delete("conversationId");
    if (conversationId && inquiryId) params.set("inquiryId", String(inquiryId));
    else params.delete("inquiryId");
    // Preserve only the existing URL scope, not a grant or fabricated participant.
    navigate(`${location.split("?")[0]}${params.size ? `?${params}` : ""}`);
    setSummaryOpen(false);
  };
  const renderCustomer = (row: InquiryReceptionRow) => {
    const conversation = conversationById.get(row.conversationId);
    const unread = Math.max(0, Number(conversation?.unreadCount) || 0);
    const requestedQty = receptionRequestedQuantity(row);
    return <button key={row.id} type="button" className="inquiry-reception__item" data-inquiry-id={row.id} aria-pressed={selected?.id === row.id} onClick={() => openConversation(row.conversationId, row.id)}>
      <span className="inquiry-reception__item-top"><strong>{row.buyerCompanyName || row.buyerName || "采购客户"}</strong>{unread > 0 ? <span className="inquiry-reception__unread" aria-label={`${unread} 条询价未读`}>{unread > 99 ? "99+" : unread}</span> : null}</span>
      <span className="inquiry-reception__part">{row.partNumber}<span>{requestedQty !== null ? ` × ${requestedQty}` : " · 数量待确认"}</span></span>
      <span className="inquiry-reception__preview">{conversation?.lastMessagePreview || (conversation ? row.brand || "询价" : "监督记录 · 非本人参与会话")}</span>
      <span className="inquiry-reception__item-bottom"><span data-status={row.status}>{INQUIRY_RECEPTION_FILTER_LABELS[row.status]}</span><time>{formatBeijingDateTime(conversation?.lastMessageAt || row.lastActivityAt || row.createdAt)}</time></span>
    </button>;
  };
  const loading = data.enterprise.isLoading || data.inbox.isPending || data.query.isLoading;
  const error = data.enterprise.error || data.inbox.error || data.query.error;
  return <BusinessContentFrame>
    <section className="inquiry-reception" data-inquiry-reception data-detail={selectedId ? "true" : "false"} aria-label="询价接待">
      <div className="inquiry-reception__toolbar" role="group" aria-label="接待筛选与操作">
        <label className="inquiry-reception__search"><Search size={15} aria-hidden="true" /><input aria-label="搜索客户或型号" placeholder="搜索客户 / 型号" value={text} onChange={event => setText(event.target.value)} /></label>
        <div className="inquiry-reception__filters" role="group" aria-label="询价状态">
          {(Object.keys(INQUIRY_RECEPTION_FILTER_LABELS) as InquiryReceptionFilter[]).map(value => <button key={value} type="button" aria-pressed={filter === value} onClick={() => setFilter(value)}>{INQUIRY_RECEPTION_FILTER_LABELS[value]}</button>)}
        </div>
        {ownerCanSupervise ? <select aria-label="接待查看范围" value={view} onChange={event => setView(event.target.value as "mine" | "team")}><option value="mine">我的接待</option><option value="team">企业监督（仅查看）</option></select> : <span className="inquiry-reception__scope-label">我的接待</span>}
        <button type="button" onClick={() => void data.refresh()} disabled={!data.canReceive || data.inbox.isFetching || data.query.isFetching} aria-label="刷新询价"><RefreshCw size={15} />刷新</button>
        <button type="button" aria-pressed={notice.sound} aria-label={notice.sound ? "关闭询价提示音" : "开启询价提示音"} onClick={() => notice.setSound(!notice.sound)}>{notice.sound ? <Volume2 size={15} /> : <VolumeX size={15} />}<span>提示音{notice.sound ? "开" : "关"}</span></button>
      </div>
      {notice.notice ? <div className="inquiry-reception__notice" role="status" aria-live="polite">{notice.notice}<button type="button" aria-label="关闭新询价提示" onClick={notice.dismiss}><X size={14} /></button></div> : null}
      {!data.enterprise.isLoading && !data.canReceive ? <p className="inquiry-reception__state" role="alert">当前真实员工未获得询价接待权限或接待尚未安全就绪；库存权限不能代替 inquiry.receive。</p> : error ? <p className="inquiry-reception__state" role="alert">询价读取失败：{error.message}<button type="button" onClick={() => void data.refresh()}>重试</button></p> : <div className="inquiry-reception__panels">
        <aside className="inquiry-reception__queue" aria-label="受权询价队列" aria-busy={loading}>
          <div className="inquiry-reception__queue-modes" role="group" aria-label="队列展示方式">
            <button type="button" aria-pressed={queueMode === "material"} onClick={() => setQueueMode("material")}>按物料</button>
            <button type="button" aria-pressed={queueMode === "customer"} onClick={() => setQueueMode("customer")}>按客户</button>
          </div>
          <div className="inquiry-reception__queue-list">
            {loading && !allRows.length ? <p className="inquiry-reception__state">正在读取询价…</p> : !queue.length ? <p className="inquiry-reception__state">暂无符合条件的询价</p> : queueMode === "customer" ? queue.map(renderCustomer) : groups.map(group => {
              const expanded = expandedKeys.includes(group.key);
              const contentId = `${queueId}-${encodeURIComponent(group.key)}`;
              return <div key={group.key} className="inquiry-reception__material-group" data-material-key={group.key}>
                <button type="button" className="inquiry-reception__group-trigger" aria-expanded={expanded} aria-controls={contentId} onClick={() => toggleGroup(group.key)}>
                  <span className="inquiry-reception__group-title">{expanded ? <ChevronDown size={15} aria-hidden="true" /> : <ChevronRight size={15} aria-hidden="true" />}<strong>{group.partNumber}</strong>{group.unreadCount > 0 ? <span className="inquiry-reception__unread" aria-label={`${group.unreadCount} 条会话未读（已去重）`}>{group.unreadCount > 99 ? "99+" : group.unreadCount}</span> : null}</span>
                  <span className="inquiry-reception__group-source">{group.brand} · {group.sourceSummary}</span>
                  <span className="inquiry-reception__group-stats">{group.customerCount} 客户 / {group.conversationCount} 会话<time>{group.recentAt ? formatBeijingDateTime(group.recentAt) : "—"}</time></span>
                  <span className="inquiry-reception__preview">{group.lastMessagePreview}</span>
                </button>
                <div id={contentId} className="inquiry-reception__group-customers" hidden={!expanded}>{expanded ? group.rows.map(renderCustomer) : null}</div>
              </div>;
            })}
          </div>
        </aside>
        <main className="inquiry-reception__conversation" aria-label="原企业接待会话">
          <div className="inquiry-reception__detail-bar">
            <button type="button" className="inquiry-reception__back" onClick={() => openConversation(null)}><ArrowLeft size={15} />返回队列</button>
            <span>{selected?.partNumber || (selectedId ? "询价会话" : "选择询价")}</span>
            {selected ? <button type="button" className="inquiry-reception__summary-trigger" onClick={() => setSummaryOpen(true)}><Info size={15} />业务摘要</button> : null}
          </div>
          {canOpenConversation ? <ChatPage businessReception={{ requiredPermission: "inquiry.receive", personalFlowMessages: BUSINESS_CHAT_PERSONAL_FLOW_MESSAGES }} receptionConversation={{ conversationId: selectedId!, onBack: () => openConversation(null), canReply }} /> : <p className="inquiry-reception__state">{view === "team" ? "企业监督仅查看询价摘要。监督查看不会成为参与人，也不能回复或自动标为已读；切换“我的接待”后可进入本人会话。" : selectedId ? "该记录不属于当前员工参与的受权接待会话。监督查看不会成为参与人，也不能回复或自动标为已读。" : "从左侧队列选择询价，查看并回复原企业会话。"}</p>}
        </main>
      </div>}
      {summaryOpen && selected && data.canReceive && !error && expansion.scope === expansionScope ? <SummaryDrawer onClose={() => setSummaryOpen(false)} row={selected} /> : null}
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
