import React, { useEffect, useRef, useState } from "react";
import { inventoryError, type InventoryContext, type InventoryManagementClient, type ReadableInventoryChannel } from "./management";
import "./management.css";

type Props = {
  client: InventoryManagementClient;
  context: InventoryContext;
  scopeKey: string;
  active: boolean;
  canReadChannels: boolean;
  canReadTeamSources: boolean;
  isCurrent: () => boolean;
  onSelect: (channel: ReadableInventoryChannel) => void;
  onAuthorizationError: (error: unknown) => void;
};

/** Only existing server-authorized channel and team-source lists establish source access. */
export function ChannelInventoryBrowsePanel(props: Props) {
  const [page, setPage] = useState(1);
  const [name, setName] = useState("");
  const [revision, setRevision] = useState(0);
  const key = JSON.stringify([props.scopeKey, revision, props.active, props.canReadChannels, props.canReadTeamSources]);
  const [query, setQuery] = useState<{ key: string; items?: ReadableInventoryChannel[]; error?: string; loading: boolean }>({ key: "", loading: true });
  const latest = useRef(props); latest.current = props;
  const liveKey = useRef(key); liveKey.current = key;

  useEffect(() => {
    if (!props.active || !props.isCurrent()) return;
    const controller = new AbortController();
    const current = () => !controller.signal.aborted && latest.current.active && latest.current.isCurrent() && liveKey.current === key;
    setQuery({ key, loading: true });
    const load = async () => {
      const channels = new Map<number, ReadableInventoryChannel>();
      const remember = (channel: ReadableInventoryChannel) => {
        if (!Number.isSafeInteger(channel.id) || channel.id <= 0 || typeof channel.name !== "string") throw new Error("渠道数据无效，未显示其他渠道。");
        if (channel.canViewSource !== false) channels.set(channel.id, { id: channel.id, name: channel.name, canViewSource: true });
      };
      if (props.canReadChannels) {
        let nextPage = 1;
        let pageCount = 1;
        do {
          const result = await props.client.listChannels.query({ ...props.context, page: nextPage, pageSize: 100 }, { signal: controller.signal });
          if (!current()) return;
          if (!Array.isArray(result.items) || result.items.length > 100 || result.page !== nextPage || !Number.isSafeInteger(result.total) || result.total < 0) throw new Error("渠道分页结果无效，未显示其他渠道。");
          pageCount = Math.max(1, Math.ceil(result.total / 100));
          if (pageCount > 1000) throw new Error("渠道数量过多，请联系管理员核实；未截断或展示其他范围。");
          result.items.forEach(remember);
          nextPage += 1;
        } while (nextPage <= pageCount);
      }
      if (props.canReadTeamSources) {
        const result = await props.client.listTeamSourceOptions.query(props.context, { signal: controller.signal });
        if (!current()) return;
        if (!Array.isArray(result.items)) throw new Error("可读渠道来源返回无效。");
        if (result.canFilterSource === true) result.items.forEach(remember);
      }
      if (current()) {
        setQuery({ key, items: Array.from(channels.values()).sort((a, b) => a.name.localeCompare(b.name, "zh-CN") || a.id - b.id), loading: false });
        setPage(1);
      }
    };
    void load().catch(error => {
      if (current()) {
        props.onAuthorizationError(error);
        setQuery({ key, loading: false, error: inventoryError(error, "渠道读取失败，请刷新后重试。") });
      }
    });
    return () => controller.abort();
  }, [key, props.active, props.client, props.context]);

  useEffect(() => {
    const refresh = () => setRevision(value => value + 1);
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, []);

  const authorized = props.active && props.isCurrent() && query.key === key;
  const allItems = authorized ? query.items : undefined;
  const filtered = allItems?.filter(channel => channel.name.toLocaleLowerCase().includes(name.trim().toLocaleLowerCase())) ?? [];
  const pageCount = Math.max(1, Math.ceil(filtered.length / 20));
  const items = filtered.slice((page - 1) * 20, page * 20);
  const loading = props.active && (query.key !== key || query.loading);
  return <section className="ci-panel" aria-label="按渠道查看库存">
    <div className="ci-toolbar">
      <label className="ci-field ci-toolbar-search"><span className="ci-filter-label">渠道名称</span><input aria-label="搜索可读库存渠道" placeholder="搜索渠道" maxLength={128} value={name} onChange={event => { setName(event.target.value); setPage(1); }} /></label>
      <button type="button" className="ci-button" onClick={() => { setName(""); setPage(1); }}>重置</button>
      <button type="button" className="ci-button" onClick={() => setRevision(value => value + 1)}>刷新渠道列表</button>
      <span className="ci-filter-count">{allItems ? `${filtered.length} 个渠道` : loading ? "正在读取渠道条数…" : "渠道条数不可用"}</span>
    </div>
    <p className="ci-readonly">仅列出当前有权查看来源的渠道；点击后查看此渠道库存。</p>
    <div className="ci-tablewrap"><table className="ci-table ci-readable-channels-table admin-table-readable"><thead><tr><th>渠道名称</th><th className="ci-col-actions">操作</th></tr></thead><tbody>
      {!props.active ? <tr><td colSpan={2} className="ci-empty">正在核验当前渠道读取权限…</td></tr> : loading ? <tr><td colSpan={2} className="ci-empty">正在读取渠道…</td></tr> : query.error ? <tr><td colSpan={2} className="ci-empty ci-host-error" role="alert">{query.error}</td></tr> : !allItems ? <tr><td colSpan={2} className="ci-empty">当前账号没有渠道来源查看权限，可使用平铺查看已授权库存。</td></tr> : !items.length ? <tr><td colSpan={2} className="ci-empty">暂无符合条件的渠道。</td></tr> : null}
      {items.map(channel => <tr key={channel.id}><td><strong className="ci-channel-name admin-cell-primary">{channel.name}</strong></td><td className="ci-col-actions"><button type="button" className="ci-inline-link" onClick={() => { if (authorized && latest.current.isCurrent() && liveKey.current === query.key && allItems?.some(item => item.id === channel.id)) props.onSelect(channel); }}>查看该渠道库存</button></td></tr>)}
    </tbody></table></div>
    <nav className="ci-pagination" aria-label="可读渠道分页"><span>{allItems ? `共 ${filtered.length} 个渠道，第 ${page} / ${pageCount} 页` : loading ? "正在读取渠道分页…" : "渠道分页条数不可用"}</span><button type="button" className="ci-button" disabled={loading || !allItems || page <= 1} onClick={() => setPage(value => value - 1)}>上一页</button><button type="button" className="ci-button" disabled={loading || !allItems || page >= pageCount} onClick={() => setPage(value => value + 1)}>下一页</button></nav>
  </section>;
}
