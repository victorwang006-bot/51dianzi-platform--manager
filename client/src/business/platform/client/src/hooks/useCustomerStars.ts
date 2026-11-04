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
export type StarRow = { id: number; isStarred?: boolean; starRevision?: number; starUserId?: number; canSetStar?: boolean };
type ReadState = { key: string; data: Context | null; loading: boolean; failed: boolean };
type WriteState = { key: string; command: Command; status: "pending" | "unknown"; message: string };

/** Personal preferences are never persisted locally or inferred from canManageAll.
 * A fresh fixed read proves eligible targets; each command repeats server policy.
 * An uncertain write retains its complete command, including its original requestId. */
export function useCustomerStars(scope: CustomerContactScope | null, contextCurrent: boolean, onSaved: (customerId: number) => Promise<void>) {
  const business = useBusinessScope();
  const utils = trpc.useUtils();
  const verification = business.contextVerification;
  const identity = `${business.storageScope}:${scope?.enterpriseId ?? 0}:${scope?.actorUserId ?? 0}`;
  const readKey = `${identity}:${verification.authorizationVersion}`;
  const currentScope = Boolean(scope && contextCurrent && verification.state !== "revalidating");
  const [read, setRead] = useState<ReadState>({ key: "", data: null, loading: true, failed: false });
  const [revision, setRevision] = useState(0);
  const [selection, setSelection] = useState<{ identity: string; userId: number } | null>(null);
  const [write, setWrite] = useState<WriteState | null>(null);
  const [notice, setNotice] = useState("");
  const writeRef = useRef<WriteState | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const alive = useRef(true);
  const saveRef = useRef(onSaved); saveRef.current = onSaved;
  const targetUserId = selection?.identity === identity ? selection.userId : scope?.actorUserId ?? 0;
  const requestKey = `${readKey}:${targetUserId}`;
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
    // Partially deployed/missing APIs fail only this feature, including a missing
    // client method; never infer a self-write grant from an error fallback.
    void Promise.resolve().then(() => utils.client.customer.starContext.query(undefined, { signal: abort.signal })).then(raw => {
      if (!active || abort.signal.aborted || currentRef.current.readKey !== readKey) return;
      const data = customerStarContextSchema.parse(raw);
      if (data.enterpriseId !== scope.enterpriseId || data.actorUserId !== scope.actorUserId
        || !Array.isArray(data.targets) || !data.targets.some(target => target.userId === scope.actorUserId)) {
        throw new Error("星标身份核验失败");
      }
      setRead({ key: readKey, data, loading: false, failed: false });
    }).catch(error => {
      if (!active || abort.signal.aborted || currentRef.current.readKey !== readKey) return;
      business.onAuthorizationError(error);
      setRead({ key: readKey, data: null, loading: false, failed: true });
    });
    return () => { active = false; abort.abort(); };
  }, [readKey, currentScope, revision, utils]);

  const data = currentScope && read.key === readKey && !read.failed && !read.loading ? read.data : null;
  const target = data?.targets.find(item => item.userId === targetUserId);
  const ready = Boolean(data && target);
  const activeWrite = write?.key === requestKey && currentScope ? write : null;
  const allowedRef = useRef({ ready, targetUserId }); allowedRef.current = { ready, targetUserId };
  const clearWrite = () => { writeRef.current = null; setWrite(null); };
  const refresh = () => { setRevision(value => value + 1); };
  const changeTarget = (userId: number) => {
    if (writeRef.current?.status === "pending" || !data?.targets.some(item => item.userId === userId)) return;
    abortRef.current?.abort(); clearWrite(); setNotice("");
    setSelection({ identity, userId });
  };
  const canSet = (row: StarRow) => Boolean(ready && row.canSetStar === true
    && row.starUserId === targetUserId && typeof row.isStarred === "boolean"
    && Number.isSafeInteger(row.starRevision) && row.starRevision! >= 0);

  const send = async (frozen: WriteState) => {
    if (!currentRef.current.currentScope || !allowedRef.current.ready || frozen.key !== currentRef.current.requestKey) return;
    abortRef.current?.abort(); const abort = new AbortController(); abortRef.current = abort;
    const pending: WriteState = { ...frozen, status: "pending", message: "" };
    writeRef.current = pending; setWrite(pending); setNotice("");
    const current = () => alive.current && !abort.signal.aborted && currentRef.current.currentScope
      && currentRef.current.requestKey === frozen.key && writeRef.current?.command.requestId === frozen.command.requestId;
    try {
      const raw = await utils.client.customer.setStar.mutate(frozen.command, { signal: abort.signal });
      if (!current()) return;
      const result = customerSetStarResultSchema.parse(raw);
      // A mismatched receipt is an unknown outcome, not permission to toggle again.
      if (result.customerId !== frozen.command.customerId || result.targetUserId !== frozen.command.targetUserId
        || result.requestId !== frozen.command.requestId || result.isStarred !== frozen.command.starred
        || !Number.isSafeInteger(result.starRevision) || result.starRevision < 0) throw new Error("星标回执无法核验");
      await saveRef.current(result.customerId);
      if (!current()) return;
      clearWrite(); setNotice(result.isStarred ? "已标星，列表已重新读取" : "已取消星标，列表已重新读取");
    } catch (error) {
      if (!current()) return;
      const value = error as { data?: { code?: string }; code?: string; message?: string };
      const code = value.data?.code ?? value.code;
      if (isUnknownContactOutcome(error)) {
        const unknown: WriteState = { ...frozen, status: "unknown", message: "星标结果未知，请重试原请求，不要重复切换。" };
        writeRef.current = unknown; setWrite(unknown); return;
      }
      clearWrite();
      if (code === "CONFLICT") {
        setNotice("星标已由其他人更改，请刷新后重新选择；未覆盖最新状态。");
        refresh(); void utils.customer.list.invalidate();
      } else {
        setNotice(`星标操作失败：${value.message || "请重新核验权限后再试"}`);
        if (["UNAUTHORIZED", "FORBIDDEN", "NOT_FOUND", "PRECONDITION_FAILED"].includes(String(code))) {
          setRead({ key: readKey, data: null, loading: false, failed: true });
          business.onAuthorizationError(error);
        }
      }
    }
  };
  const toggle = (row: StarRow) => {
    if (writeRef.current || !canSet(row) || !scope) return;
    const command: Command = { customerId: row.id, targetUserId, starred: !row.isStarred,
      expectedRevision: row.starRevision!, requestId: makeCustomerRequestId(),
      expectedEnterpriseId: scope.enterpriseId, expectedActorUserId: scope.actorUserId };
    void send({ key: requestKey, command, status: "pending", message: "" });
  };
  const retry = () => {
    const frozen = writeRef.current;
    if (frozen?.status === "unknown") void send(frozen);
  };
  return { targetUserId, actorUserId: scope?.actorUserId ?? 0, target, targets: data?.targets ?? [],
    ready, loading: currentScope && (read.key !== readKey || read.loading), failed: read.key === readKey && read.failed,
    invalidTarget: Boolean(data && !target), busy: activeWrite?.status === "pending", blocked: Boolean(activeWrite),
    pendingCustomerId: activeWrite?.command.customerId, unknown: activeWrite?.status === "unknown",
    notice: activeWrite?.message || notice, canSet, toggle, retry, refresh, changeTarget };
}
