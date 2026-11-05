import { useEffect, useRef, useState } from "react";
import { trpc } from "../../../../../api/business-trpc";
import { useBusinessScope } from "../../../../../BusinessScope";
import { customerStarMetadataSchema } from "../../../../shared/customerStars";
import { useCustomerStars, type StarRow } from "../../hooks/useCustomerStars";
import type { CustomerContactScope } from "./customerContacts";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../ui/dialog";

type Customer = { id: number; name: string; archivedAt: string | null };
type Props = { customer: Customer | null; scope: CustomerContactScope; contextCurrent: boolean; onClose: () => void };
type EmployeeRow = StarRow & { name: string };
type Read = { key: string; items: EmployeeRow[]; total: number; loading: boolean; error: string };
const PAGE_SIZE = 20;
const emptyRead = (): Read => ({ key: "", items: [], total: 0, loading: true, error: "" });

/** This session never changes the main list's target, owner filters or page.
 * Delegated reads require all + the actual employee assignee, even for leaders
 * without canManageAll. Missing/invalid metadata never becomes writable. */
export function CustomerDelegatedStarDialog({ customer, scope, contextCurrent, onClose }: Props) {
  const utils = trpc.useUtils();
  const business = useBusinessScope();
  const [revision, setRevision] = useState(0);
  const [read, setRead] = useState<Read>(emptyRead);
  const stars = useCustomerStars(scope, contextCurrent, async () => {
    setRead(emptyRead());
    setRevision(value => value + 1);
    await utils.customer.list.invalidate();
  });
  // Target/authorization changes immediately discard the old local list state.
  const [filters, setFilters] = useState({ key: "", draft: "", keyword: "", page: 1 });
  const list = filters.key === stars.requestKey ? filters : { key: stars.requestKey, draft: "", keyword: "", page: 1 };
  const delegated = stars.targetUserId !== stars.actorUserId;
  const key = JSON.stringify([stars.requestKey, customer, list.keyword, list.page, revision]);
  const currentRef = useRef({ key, ready: stars.ready });
  currentRef.current = { key, ready: stars.ready };
  useEffect(() => {
    if (!stars.ready || !delegated) return;
    const abort = new AbortController();
    let alive = true;
    const current = () => alive && !abort.signal.aborted && currentRef.current.key === key && currentRef.current.ready;
    setRead({ ...emptyRead(), key });
    const validate = (item: { id: number; name: string; enterpriseId: number; assignedUserId: number; isStarred?: boolean; starRevision?: number; starUserId?: number; canSetStar?: boolean }): EmployeeRow => {
      const metadata = customerStarMetadataSchema.parse({ isStarred: item.isStarred, starRevision: item.starRevision,
        starUserId: item.starUserId, canSetStar: item.canSetStar });
      if (item.enterpriseId !== scope.enterpriseId || item.assignedUserId !== stars.targetUserId || metadata.starUserId !== stars.targetUserId)
        throw new Error("客户或员工身份核验失败，请重新读取。");
      return { id: item.id, name: item.name, ...metadata };
    };
    void (async () => {
      if (!customer) {
        const result = await utils.client.customer.list.query({ keyword: list.keyword,
          scope: "all", assignedUserId: stars.targetUserId, starUserId: stars.targetUserId,
          archived: false, due: "all", starredOnly: false, page: list.page, pageSize: PAGE_SIZE }, { signal: abort.signal });
        if (!current()) return;
        if (!Number.isSafeInteger(result.total) || result.total < 0) throw new Error("员工客户列表总数无法核验。");
        setRead({ key, items: result.items.map(validate), total: result.total, loading: false, error: "" });
        return;
      }
      const keyword = customer.name.trim().slice(0, 128);
      if (!keyword) throw new Error("客户名称为空，无法精确读取员工重点状态，请先补全客户名称；未执行代标。");
      // Row mode searches this name and matches the exact ID on bounded pages.
      for (let page = 1; page <= 5; page++) {
        const result = await utils.client.customer.list.query({ keyword,
          scope: "all", assignedUserId: stars.targetUserId, starUserId: stars.targetUserId,
          archived: Boolean(customer.archivedAt), due: "all", starredOnly: false, page, pageSize: 100 }, { signal: abort.signal });
        if (!current()) return;
        const found = result.items.find(item => item.id === customer.id);
        if (found) {
          setRead({ key, items: [validate(found)], total: 1, loading: false, error: "" });
          return;
        }
        if (page * 100 >= result.total || result.items.length === 0) break;
      }
      throw new Error("未能读取该员工对本客户的真实重点状态。客户可能不在该员工的授权负责人范围，或匹配结果过多；未执行代标。");
    })().catch(error => {
      if (!current()) return;
      business.onAuthorizationError(error);
      setRead({ key, items: [], total: 0, loading: false, error: error instanceof Error ? error.message : "重点客户状态读取失败，请重试。" });
    });
    return () => { alive = false; abort.abort(); };
  }, [key, stars.ready, delegated, utils]);
  const result = stars.ready && delegated && read.key === key ? read : null;
  const row = result?.items[0];
  const writable = (item: StarRow) => stars.canSet(item) && !stars.blocked;
  const close = () => { if (!stars.blocked) onClose(); };
  const search = () => { if (!stars.blocked) setFilters({ ...list, keyword: list.draft.trim().slice(0, 128), page: 1 }); };
  const pages = Math.max(1, Math.ceil((result?.total ?? 0) / PAGE_SIZE));
  useEffect(() => {
    if (!customer && result && !result.loading && !result.error && list.page > pages && !stars.blocked) setFilters({ ...list, page: pages });
  }, [key, result, pages, stars.blocked]);
  return <Dialog open onOpenChange={open => { if (!open) close(); }}>
    <DialogContent className={customer ? "sm:max-w-md" : "sm:max-w-2xl max-h-[85vh] overflow-y-auto"} showCloseButton={false}
      onEscapeKeyDown={event => { if (stars.blocked) event.preventDefault(); }}
      onPointerDownOutside={event => event.preventDefault()}>
      <DialogHeader>
        <DialogTitle>替员工标星</DialogTitle>
        <DialogDescription>{customer ? "将此客户标记为员工需要重点跟进的重点客户" : "管理所选员工实际负责的在档客户重点标记"}，不改变负责人或当前客户列表。</DialogDescription>
      </DialogHeader>
      {customer ? <p className="break-words text-sm">{customer.name || "未命名客户"}</p> : null}
      <label className="grid gap-2 text-sm">选择员工
        <select aria-label="替员工标星：选择员工" className="h-8 rounded border border-slate-300 bg-white px-2"
          value={delegated ? String(stars.targetUserId) : ""} disabled={stars.blocked || stars.loading || stars.failed}
          onChange={event => { if (!stars.blocked) stars.changeTarget(Number(event.target.value)); }}>
          <option value="" disabled>请选择员工</option>
          {stars.invalidTarget ? <option value={String(stars.targetUserId)}>员工权限已变化（ID {stars.targetUserId}）</option> : null}
          {stars.targets.filter(target => target.userId !== stars.actorUserId).map(target =>
            <option key={target.userId} value={String(target.userId)}>{target.name}（组员 · ID {target.userId}）</option>)}
        </select>
      </label>
      {stars.loading ? <p role="status" className="text-sm">正在核验重点客户权限…</p> : null}
      {stars.failed || stars.invalidTarget ? <div role="alert" className="text-sm text-red-700">
        {stars.invalidTarget ? "员工重点客户权限已变化，未切换为本人标记；请重新选择合法员工。" : "重点客户权限读取失败。"}
        <Button type="button" variant="link" disabled={stars.blocked} onClick={stars.refresh}>重新读取重点客户权限</Button>
      </div> : null}
      {delegated && stars.ready ? <div className="grid gap-2 text-sm">
        <p>正在为{stars.target?.name}管理{customer ? "本客户的重点标记" : "实际负责客户的重点标记"}（用户ID {stars.targetUserId}）</p>
        {!customer ? <form className="flex gap-2" onSubmit={event => { event.preventDefault(); search(); }}>
          <Input aria-label="搜索员工客户" placeholder="搜索员工客户名称、联系人或电话" value={list.draft} maxLength={128}
            disabled={stars.blocked} onChange={event => setFilters({ ...list, draft: event.target.value })} />
          <Button type="submit" variant="outline" disabled={stars.blocked}>搜索员工客户</Button>
        </form> : null}
        {!result || result.loading ? <p role="status">正在读取该员工的真实重点客户状态…</p> : null}
        {result?.error ? <p role="alert" className="text-red-700">{result.error}</p> : null}
        {customer && row ? <>
          <p role="status">当前状态：{row.isStarred ? "已标记为重点客户" : "未标记为重点客户"}</p>
          {!stars.canSet(row) ? <p role="alert">当前客户不能替该员工设置重点标记。</p> : null}
        </> : null}
        {!customer && result && !result.loading && !result.error ? <>
          {!result.items.length ? <p role="status">暂无匹配的员工客户</p> : <ul className="grid gap-2" aria-label="员工实际负责客户">
            {result.items.map(item => <li key={item.id} data-delegated-customer={item.id} className="flex flex-wrap items-center justify-between gap-2 rounded border p-2">
              <div className="min-w-0 break-words"><p>{item.name || "未命名客户"}</p>
                <p role="status">当前状态：{item.isStarred ? "已标记为重点客户" : "未标记为重点客户"}</p></div>
              <div className="flex gap-2">
                <Button type="button" variant="outline" aria-label={`取消重点客户标记：${item.name}`} disabled={!writable(item) || !item.isStarred}
                  onClick={() => stars.setStar(item, false)}>取消重点客户标记</Button>
                <Button type="button" aria-label={`标记为重点客户：${item.name}`} disabled={!writable(item) || item.isStarred === true}
                  onClick={() => stars.setStar(item, true)}>标记为重点客户</Button>
              </div>
            </li>)}
          </ul>}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>共 {result.total} 条 · 第 {list.page} / {pages} 页</span>
            <div className="flex gap-2">
              <Button type="button" variant="outline" disabled={stars.blocked || list.page <= 1} onClick={() => setFilters({ ...list, page: list.page - 1 })}>上一页</Button>
              <Button type="button" variant="outline" disabled={stars.blocked || list.page >= pages} onClick={() => setFilters({ ...list, page: list.page + 1 })}>下一页</Button>
            </div>
          </div>
        </> : null}
        <Button type="button" variant="link" disabled={stars.blocked} onClick={() => setRevision(value => value + 1)}>重新读取重点状态</Button>
      </div> : null}
      {stars.notice ? <div role={stars.unknown ? "alert" : "status"} aria-live="polite" className="text-sm">
        {stars.notice}
        {stars.unknown ? <Button type="button" variant="link" onClick={stars.retry}>重试原重点客户请求</Button> : null}
      </div> : null}
      <DialogFooter>
        <Button type="button" variant="outline" disabled={stars.blocked} onClick={close}>关闭</Button>
        {customer ? <>
          <Button type="button" variant="outline" disabled={!row || !writable(row) || !row.isStarred}
            onClick={() => { if (row && writable(row)) stars.setStar(row, false); }}>取消重点客户标记</Button>
          <Button type="button" disabled={!row || !writable(row) || row.isStarred === true}
            onClick={() => { if (row && writable(row)) stars.setStar(row, true); }}>标记为重点客户</Button>
        </> : null}
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
