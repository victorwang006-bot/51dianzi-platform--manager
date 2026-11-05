import { useEffect, useRef, useState } from "react";
import type { inferRouterInputs, inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../front-router-types/server/routers";
import { trpc } from "../../../../api/business-trpc";
import { useBusinessScope } from "../../../../BusinessScope";
import { customerStarContextSchema, customerSetStarResultSchema } from "../../../shared/customerStars";
import type { CustomerContactScope } from "../components/customers/customerContacts";
import { isUnknownContactOutcome } from "../components/customers/customerContacts";
import { makeCustomerRequestId } from "../components/customers/customerUtils";

type Context = inferRouterOutputs<AppRouter>["customer"]["starContext"];
type Command = inferRouterInputs<AppRouter>["customer"]["setStar"];
export type StarRow = { id: number; enterpriseId: number; assignedUserId: number; isStarred?: boolean; starRevision?: number; starUserId?: number | null; canSetStar?: boolean };
type ReadState = { key: string; data: Context | null; loading: boolean; failed: boolean };
type WriteState = { key: string; command: Command; status: "pending" | "unknown"; message: string };

/** One authoritative target per row: its CURRENT native assignee. No local preference,
 * global star owner selection or silent self fallback. Unknown commands are retried verbatim. */
export function useCustomerStars(scope: CustomerContactScope | null, contextCurrent: boolean, onSaved: (customerId: number) => Promise<void>, viewKey = "") {
  const business = useBusinessScope();
  const utils = trpc.useUtils();
  const verification = business.contextVerification;
  const identity = `${business.storageScope}:${scope?.enterpriseId ?? 0}:${scope?.actorUserId ?? 0}`;
  const readKey = `${identity}:${verification.authorizationVersion}`;
  const requestKey = `${readKey}:${viewKey}`;
  const currentScope = Boolean(scope && contextCurrent && verification.state !== "revalidating");
  const [read, setRead] = useState<ReadState>({ key: "", data: null, loading: true, failed: false });
  const [revision, setRevision] = useState(0);
  const [write, setWrite] = useState<WriteState | null>(null);
  const [notice, setNotice] = useState("");
  const writeRef = useRef<WriteState | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const alive = useRef(true);
  const rowsRef = useRef(new Map<number, StarRow>());
  const saveRef = useRef(onSaved); saveRef.current = onSaved;
  const currentRef = useRef({ readKey, requestKey, currentScope });
  currentRef.current = { readKey, requestKey, currentScope };

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; abortRef.current?.abort(); writeRef.current = null; };
  }, []);
  useEffect(() => {
    abortRef.current?.abort(); abortRef.current = null;
    writeRef.current = null; setWrite(null); setNotice("");
  }, [requestKey, currentScope]);
  useEffect(() => {
    if (!currentScope || !scope) return;
    const abort = new AbortController();
    let active = true;
    setRead({ key: readKey, data: null, loading: true, failed: false });
    void Promise.resolve().then(() => utils.client.customer.starContext.query(undefined, { signal: abort.signal })).then(raw => {
      if (!active || abort.signal.aborted || currentRef.current.readKey !== readKey) return;
      const data = customerStarContextSchema.parse(raw);
      if (data.enterpriseId !== scope.enterpriseId || data.actorUserId !== scope.actorUserId
        || !data.targets.some(target => target.userId === scope.actorUserId)) throw new Error("重点客户身份核验失败");
      setRead({ key: readKey, data, loading: false, failed: false });
    }).catch(error => {
      if (!active || abort.signal.aborted || currentRef.current.readKey !== readKey) return;
      business.onAuthorizationError(error);
      setRead({ key: readKey, data: null, loading: false, failed: true });
    });
    return () => { active = false; abort.abort(); };
  }, [readKey, currentScope, revision, utils]);

  const data = currentScope && read.key === readKey && !read.failed && !read.loading ? read.data : null;
  const ready = Boolean(data);
  const activeWrite = write?.key === requestKey && currentScope ? write : null;
  const allowedRef = useRef({ data, ready }); allowedRef.current = { data, ready };
  const clearWrite = () => { writeRef.current = null; setWrite(null); };
  const refresh = () => { setRead({ key: readKey, data: null, loading: true, failed: false }); setRevision(value => value + 1); };
  const canSet = (row: StarRow) => Boolean(ready && scope && row.enterpriseId === scope.enterpriseId
    && row.canSetStar === true && Number.isSafeInteger(row.assignedUserId) && row.assignedUserId > 0
    && row.starUserId === row.assignedUserId && data?.targets.some(target => target.userId === row.assignedUserId)
    && typeof row.isStarred === "boolean" && Number.isSafeInteger(row.starRevision) && row.starRevision! >= 0 && row.starRevision! < 2147483647);
  const rowCurrent = (command: Command) => {
    const row = rowsRef.current.get(command.customerId);
    return Boolean(row && row.enterpriseId === command.expectedEnterpriseId && row.assignedUserId === command.targetUserId
      && row.starUserId === command.targetUserId && row.canSetStar === true);
  };
  const send = async (frozen: WriteState) => {
    if (!currentRef.current.currentScope || !allowedRef.current.ready || frozen.key !== currentRef.current.requestKey
      || !allowedRef.current.data?.targets.some(target => target.userId === frozen.command.targetUserId) || !rowCurrent(frozen.command)) return;
    abortRef.current?.abort(); const abort = new AbortController(); abortRef.current = abort;
    const pending: WriteState = { ...frozen, status: "pending", message: "" };
    writeRef.current = pending; setWrite(pending); setNotice("");
    const current = () => alive.current && !abort.signal.aborted && currentRef.current.currentScope
      && currentRef.current.requestKey === frozen.key && writeRef.current?.command.requestId === frozen.command.requestId
      && allowedRef.current.ready && allowedRef.current.data?.targets.some(target => target.userId === frozen.command.targetUserId)
      && rowCurrent(frozen.command);
    try {
      const raw = await utils.client.customer.setStar.mutate(frozen.command, { signal: abort.signal });
      if (!current()) return;
      const result = customerSetStarResultSchema.parse(raw);
      if (result.customerId !== frozen.command.customerId || result.targetUserId !== frozen.command.targetUserId
        || result.requestId !== frozen.command.requestId || result.isStarred !== frozen.command.starred
        || result.starRevision !== frozen.command.expectedRevision + 1) throw new Error("重点客户回执无法核验");
      await saveRef.current(result.customerId);
      if (!current()) return;
      clearWrite(); setNotice(result.isStarred ? "已标记重点客户" : "已取消重点客户标记");
    } catch (error) {
      if (!current()) return;
      const value = error as { data?: { code?: string }; code?: string; message?: string };
      const code = value.data?.code ?? value.code;
      if (isUnknownContactOutcome(error)) {
        const unknown: WriteState = { ...frozen, status: "unknown", message: "重点客户标记结果未知，请重试原请求，不要重复切换。" };
        writeRef.current = unknown; setWrite(unknown); return;
      }
      clearWrite();
      if (code === "CONFLICT") {
        setNotice("重点客户标记已由其他人更改，请刷新后重新选择；未覆盖最新状态。");
        refresh(); void utils.customer.list.invalidate();
      } else {
        setNotice(`重点客户操作失败：${value.message || "请重新核验权限后再试"}`);
        if (["UNAUTHORIZED", "FORBIDDEN", "NOT_FOUND", "PRECONDITION_FAILED"].includes(String(code))) {
          setRead({ key: readKey, data: null, loading: false, failed: true });
          business.onAuthorizationError(error);
        }
      }
    }
  };
  const setStar = (row: StarRow, starred: boolean) => {
    if (writeRef.current || !canSet(row) || !scope || row.isStarred === starred) return;
    const command: Command = { customerId: row.id, targetUserId: row.assignedUserId, starred, starMode: "assignee",
      expectedRevision: row.starRevision!, requestId: makeCustomerRequestId(),
      expectedEnterpriseId: scope.enterpriseId, expectedActorUserId: scope.actorUserId };
    void send({ key: requestKey, command, status: "pending", message: "" });
  };
  const toggle = (row: StarRow) => setStar(row, !row.isStarred);
  const retry = () => { const frozen = writeRef.current; if (frozen?.status === "unknown") void send(frozen); };
  const observeRows = (rows: StarRow[]) => { rowsRef.current = new Map(rows.map(row => [row.id, row])); };
  // The page records its CURRENT projection after this hook returns. Read that ref
  // after every commit, not an earlier render-time snapshot of the old assignee.
  useEffect(() => {
    const frozen = writeRef.current;
    if (frozen && frozen.key === currentRef.current.requestKey && !rowCurrent(frozen.command)) {
      abortRef.current?.abort(); clearWrite(); setNotice("客户负责人或权限已变化，请重新读取重点状态。");
    }
  });
  return { actorUserId: scope?.actorUserId ?? 0, targets: data?.targets ?? [],
    ready, loading: currentScope && (read.key !== readKey || read.loading), failed: read.key === readKey && read.failed,
    invalidTarget: false, busy: activeWrite?.status === "pending", blocked: Boolean(activeWrite),
    pendingCustomerId: activeWrite?.command.customerId, unknown: activeWrite?.status === "unknown",
    notice: activeWrite?.message || notice, canSet, toggle, setStar, retry, refresh, observeRows, requestKey };
}
