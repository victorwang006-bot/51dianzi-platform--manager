import React, { useEffect, useRef, useState } from "react";
import { inventoryError, type InventoryContext, type InventoryManagementClient, type ReadableInventoryChannel } from "./management";

export type InventoryChannelAvailability = {
  scopeKey: string;
  ready: boolean;
  channels: readonly ReadableInventoryChannel[];
};

type Props = {
  client: InventoryManagementClient;
  context: InventoryContext;
  scopeKey: string;
  active: boolean;
  canReadChannels: boolean;
  canReadTeamSources: boolean;
  selectedChannelId?: number;
  isCurrent: () => boolean;
  onSelect: (channel: ReadableInventoryChannel) => void;
  onAvailability: (state: InventoryChannelAvailability) => void;
  onAuthorizationError: (error: unknown) => void;
};

/** These lists already enforce source/owner/team scope on the server. Never
 * infer a grant from a URL, stock author, local preferences or a channel name. */
export function InventoryChannelSelector(props: Props) {
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
    latest.current.onAvailability({ scopeKey: props.scopeKey, ready: false, channels: [] });
    const load = async () => {
      const channels = new Map<number, ReadableInventoryChannel>();
      const remember = (channel: ReadableInventoryChannel) => {
        if (!Number.isSafeInteger(channel.id) || channel.id <= 0 || typeof channel.name !== "string") throw new Error("渠道数据无效，未显示其他渠道。");
        if (channel.canViewSource !== false) channels.set(channel.id, { id: channel.id, name: channel.name, canViewSource: true });
      };
      if (props.canReadChannels) {
        let page = 1;
        let total: number | undefined;
        let pageCount = 1;
        do {
          const result = await props.client.listChannels.query({ ...props.context, page, pageSize: 100 }, { signal: controller.signal });
          if (!current()) return;
          if (!Array.isArray(result.items) || result.items.length > 100 || result.page !== page || !Number.isSafeInteger(result.total) || result.total < 0 || total !== undefined && result.total !== total) throw new Error("渠道列表已变化或分页无效，请重新读取；未扩大范围。");
          total = result.total;
          pageCount = Math.max(1, Math.ceil(total / 100));
          if (pageCount > 1000) throw new Error("渠道数量过多，请联系管理员核实，未截断其他范围。");
          result.items.forEach(remember);
          page += 1;
        } while (page <= pageCount);
      }
      if (props.canReadTeamSources) {
        const result = await props.client.listTeamSourceOptions.query(props.context, { signal: controller.signal });
        if (!current()) return;
        if (!Array.isArray(result.items)) throw new Error("可读渠道返回无效。");
        if (result.canFilterSource === true) result.items.forEach(remember);
      }
      if (!current()) return;
      const items = Array.from(channels.values()).sort((a, b) => a.name.localeCompare(b.name, "zh-CN") || a.id - b.id);
      setQuery({ key, items, loading: false });
      latest.current.onAvailability({ scopeKey: props.scopeKey, ready: true, channels: items });
      if (items.length === 1 && latest.current.selectedChannelId !== items[0].id) latest.current.onSelect(items[0]);
    };
    void load().catch(error => {
      if (!current()) return;
      latest.current.onAuthorizationError(error);
      latest.current.onAvailability({ scopeKey: props.scopeKey, ready: false, channels: [] });
      setQuery({ key, loading: false, error: inventoryError(error, "渠道读取失败，请重新读取。") });
    });
    return () => controller.abort();
  }, [key, props.active, props.client, props.context]);

  useEffect(() => {
    const refresh = () => {
      // Remove the previous selection's read proof synchronously, before the new
      // request resolves. A denial must never show another channel's stock.
      latest.current.onAvailability({ scopeKey: latest.current.scopeKey, ready: false, channels: [] });
      setRevision(value => value + 1);
    };
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, []);

  const authorized = props.active && props.isCurrent() && query.key === key;
  const items = authorized ? query.items : undefined;
  const selected = items?.find(item => item.id === props.selectedChannelId);
  const loading = props.active && (query.key !== key || query.loading);
  return <span className="ci-channel-selector" role="group" aria-label="按渠道查看库存">
    <label className="ci-field ci-channel-select">
      <span className="ci-filter-label">已授权渠道</span>
      <select aria-label="选择已授权库存渠道" disabled={!items?.length || loading} value={selected?.id ?? ""} onChange={event => {
        const channel = items?.find(item => String(item.id) === event.target.value);
        if (channel && authorized && latest.current.isCurrent() && liveKey.current === query.key) latest.current.onSelect(channel);
      }}>
        {!selected ? <option value="">{loading ? "正在核验渠道…" : query.error ? "渠道读取失败" : !items?.length ? "暂无分配渠道" : "请选择已授权渠道"}</option> : null}
        {items?.map(channel => <option key={channel.id} value={channel.id}>{channel.name}</option>)}
      </select>
    </label>
    <button type="button" className="ci-button ci-channel-reload" aria-label="重新核验渠道权限" title="重新核验渠道权限" disabled={!props.active || loading} onClick={() => {
      latest.current.onAvailability({ scopeKey: props.scopeKey, ready: false, channels: [] });
      setRevision(value => value + 1);
    }}>重查渠道</button>
    {query.error && authorized ? <span className="ci-channel-selector-error" role="alert">{query.error}</span> : items && !items.length ? <span className="ci-channel-selector-empty" role="status">暂无分配渠道，未展示其他渠道库存。</span> : null}
  </span>;
}
