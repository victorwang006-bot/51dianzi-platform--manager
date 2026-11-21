import { useCallback, useEffect, useRef, useState } from "react";
import { trpc } from "../../../../api/business-trpc";
import { useBusinessScope } from "../../../../BusinessScope";
import { useCompanyStockScope } from "../components/companyStock/useCompanyStockSession";
import {
  salesOrderDraftPayloadSchema,
  type SalesOrderDraftPayload,
} from "../../../shared/crmSalesOrderDrafts";
import {
  backupSalesOrderDraft,
  chooseSalesOrderDraft,
  clearSalesOrderDraft,
  draftPayloadEqual,
  loadSalesOrderDraft,
  pendingSalesOrderRequest,
  saveSalesOrderDraft,
  validatePendingSalesOrderRequest,
  type StoredSalesOrderDraft,
} from "../lib/salesOrderDraftStore";
import {
  listPreservedSalesOrderDrafts,
  loadPreservedSalesOrderDraft,
  preserveSalesOrderDraft,
  type PreservedSalesOrderDraft,
} from "../lib/salesOrderDraftArchive";
import { hasLockedSalesOrderDraft, isUnstartedSalesOrderDraft } from "../lib/salesOrderDraftRecovery";

export function useSalesOrderDraft() {
  const business = useBusinessScope();
  const scope = useCompanyStockScope();
  // Excludes session/auth revisions so a real relogin restores only this account's company draft.
  const identity = JSON.stringify([
    business.frontUser.id,
    business.staffPrincipal.adminAccountId ?? "native",
    business.staffPrincipal.enterpriseId ?? scope.storageScope,
  ]);
  const utils = trpc.useUtils();
  const saveMutation = trpc.crmSalesOrder.orderDraftSave.useMutation();
  const deleteMutation = trpc.crmSalesOrder.orderDraftDelete.useMutation();
  const live = useRef({ identity, ready: scope.ready });
  live.current = { identity, ready: scope.ready };
  const owner = useRef(identity);
  const revision = useRef(0);
  const stored = useRef<StoredSalesOrderDraft | null>(null);
  const latest = useRef<SalesOrderDraftPayload | null>(null);
  const serial = useRef<Promise<unknown>>(Promise.resolve());
  const blocked = useRef(false);
  const initialized = useRef(false);
  const preferServerOnRestore = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const generation = useRef(0);
  const [stateIdentity, setStateIdentity] = useState(identity);
  const [initialPayload, setInitialPayload] =
    useState<SalesOrderDraftPayload | null>(null);
  const [restored, setRestored] = useState(false);
  const [notice, setNotice] = useState("");
  const [restoreAttempt, setRestoreAttempt] = useState(0);
  const [conflict, setConflict] = useState(false);
  const [canVerifyPending, setCanVerifyPending] = useState(false);
  const [preservedDrafts, setPreservedDrafts] = useState<PreservedSalesOrderDraft[]>([]);
  const replacementBusy = useRef(false);
  const setBlocked = useCallback((value: boolean) => {
    blocked.current = value;
    setConflict(value);
    setCanVerifyPending(
      Boolean(
        value &&
          latest.current &&
          latest.current.form?.completed !== true &&
          validatePendingSalesOrderRequest(latest.current)
      )
    );
  }, []);
  const api = useRef({ utils, saveMutation, deleteMutation });
  api.current = { utils, saveMutation, deleteMutation };
  const isCurrent = useCallback(
    (account: string, token: number) =>
      token === generation.current &&
      live.current.identity === account &&
      owner.current === account &&
      live.current.ready,
    []
  );
  const identityError = () => new Error("登录或公司身份已变化，草稿已保留。");
  const readServer = useCallback(
    async () =>
      api.current.utils.crmSalesOrder.orderDraftGet.fetch({}, { staleTime: 0 }),
    []
  );
  useEffect(() => {
    // Page keys also isolate sessions, but the hook must remain safe when reused without a key.
    if (owner.current === identity) return;
    owner.current = identity;
    generation.current++;
    if (timer.current) clearTimeout(timer.current);
    timer.current = undefined;
    initialized.current = false;
    preferServerOnRestore.current = false;
    revision.current = 0;
    stored.current = null;
    latest.current = null;
    serial.current = Promise.resolve();
    setBlocked(false);
    setStateIdentity(identity);
    setInitialPayload(null);
    setRestored(false);
    setNotice("");
    setPreservedDrafts([]);
  }, [identity, setBlocked]);
  useEffect(() => {
    if (!scope.ready || initialized.current) return;
    const token = ++generation.current;
    const account = identity;
    setPreservedDrafts(listPreservedSalesOrderDrafts(account));
    void readServer()
      .then(server => {
        if (!isCurrent(account, token)) return;
        const remote: StoredSalesOrderDraft | null =
          server?.payload != null
            ? {
                payload: server.payload,
                revision: server.revision,
                savedAt: Date.now(),
                dirty: false,
              }
            : null;
        // Re-read after transport: another tab may have frozen or completed a request meanwhile.
        const currentLocal = loadSalesOrderDraft(account);
        const frozenInMemory = pendingSalesOrderRequest(latest.current) ? stored.current : null;
        const preserveFrozenMemory = frozenInMemory && (!currentLocal || currentLocal.payload.form?.completed !== true);
        // A stale ordinary edit may replace the primary key while an original create
        // is being verified. Preserve both: archive the edit before restoring the frozen request.
        if (preserveFrozenMemory && currentLocal && !draftPayloadEqual(currentLocal.payload, frozenInMemory.payload) && !backupSalesOrderDraft(account, currentLocal)) {
          preferServerOnRestore.current = false;
          initialized.current = true;
          setBlocked(true);
          setInitialPayload(frozenInMemory.payload);
          setNotice("原请求仍已锁定，无法备份另一页面草稿，请启用本地存储后重试。");
          setRestored(true);
          return;
        }
        const local = preserveFrozenMemory ? frozenInMemory : currentLocal;
        const useServerAfterConflict = preferServerOnRestore.current && !pendingSalesOrderRequest(local?.payload) && !pendingSalesOrderRequest(latest.current);
        preferServerOnRestore.current = false;
        // This is an explicit user re-read, not an automatic rebase of stale work.
        // Preserve the old editable form first; a newly frozen request from another tab always wins.
        if (useServerAfterConflict && local && !backupSalesOrderDraft(account, local)) {
          initialized.current = true;
          setBlocked(true);
          setNotice("无法备份本地草稿，请启用本地存储后重试。");
          setRestored(true);
          return;
        }
        const choice = useServerAfterConflict
          ? { draft: remote, conflict: false }
          : chooseSalesOrderDraft(remote, local, remote ? undefined : (server?.revision ?? 0));
        revision.current = server?.revision ?? 0;
        stored.current = choice.draft;
        latest.current = choice.draft?.payload ?? null;
        setBlocked(choice.conflict);
        initialized.current = true;
        if (choice.draft) saveSalesOrderDraft(account, choice.draft);
        else if (useServerAfterConflict || (!remote && local?.payload.form?.completed === true))
          clearSalesOrderDraft(account);
        setInitialPayload(choice.draft?.payload ?? null);
        setNotice(
          choice.conflict
            ? "另一页面草稿已更新；本地原请求已保留，请先核验保存结果。"
            : useServerAfterConflict && local ? "本地旧草稿已备份，已读取最新草稿。" : ""
        );
        setRestored(true);
      })
      .catch(error => {
        if (!isCurrent(account, token)) return;
        const currentLocal = loadSalesOrderDraft(account);
        const frozenInMemory = pendingSalesOrderRequest(latest.current) ? stored.current : null;
        const preserveFrozenMemory = frozenInMemory && (!currentLocal || currentLocal.payload.form?.completed !== true);
        if (preserveFrozenMemory) {
          // A failed read cannot prove that an original create was absent or superseded.
          // Keep its original revision/request; archive the other ordinary edit first.
          if (currentLocal && !draftPayloadEqual(currentLocal.payload, frozenInMemory.payload) && !backupSalesOrderDraft(account, currentLocal)) {
            initialized.current = true;
            setBlocked(true);
            setInitialPayload(frozenInMemory.payload);
            setNotice("原请求仍已锁定，无法备份另一页面草稿，请启用本地存储后重试。");
            setRestored(true);
            return;
          }
          stored.current = frozenInMemory;
          latest.current = frozenInMemory.payload;
          revision.current = frozenInMemory.revision;
          saveSalesOrderDraft(account, frozenInMemory);
          initialized.current = true;
          setBlocked(true);
          setInitialPayload(frozenInMemory.payload);
          setRestored(true);
          setNotice("草稿同步暂不可用，原请求已保留，请先核验保存结果。");
          return;
        }
        const local = currentLocal;
        const choice = chooseSalesOrderDraft(null, local);
        stored.current = choice.draft;
        latest.current = choice.draft?.payload ?? null;
        setBlocked(choice.conflict);
        revision.current = local?.revision ?? 0;
        initialized.current = Boolean(local);
        setInitialPayload(choice.draft?.payload ?? null);
        setRestored(Boolean(local));
        setNotice(
          local
            ? "草稿同步暂不可用，已恢复本地草稿。"
            : error instanceof Error
              ? error.message
              : "草稿读取失败，请重试。"
        );
      });
    return () => {
      // Invalidate an unfinished read when identity/readiness/retry changes.
      if (!initialized.current && token === generation.current)
        generation.current++;
    };
  }, [
    identity,
    scope.ready,
    readServer,
    restoreAttempt,
    isCurrent,
    setBlocked,
  ]);
  useEffect(
    () => () => {
      generation.current++;
      if (timer.current) clearTimeout(timer.current);
    },
    []
  );

  const sync = useCallback(
    (payload: SalesOrderDraftPayload, account: string, token: number) => {
      const accept = (savedRevision: number) => {
        if (!isCurrent(account, token)) throw identityError();
        revision.current = savedRevision;
        if (latest.current && draftPayloadEqual(latest.current, payload)) {
          stored.current = {
            payload,
            revision: savedRevision,
            savedAt: Date.now(),
            dirty: false,
          };
          const current = loadSalesOrderDraft(account);
          if (current && draftPayloadEqual(current.payload, payload))
            saveSalesOrderDraft(account, stored.current);
        }
        setNotice("");
      };
      const work = serial.current
        .catch(() => undefined)
        .then(async () => {
          if (!isCurrent(account, token)) throw identityError();
          if (blocked.current)
            throw new Error("草稿版本冲突，请先核验原请求或重新读取草稿。");
          try {
            const result = await api.current.saveMutation.mutateAsync({
              expectedRevision: revision.current,
              payload,
            });
            accept(result.revision);
          } catch (error) {
            // Never reconcile an old save using the new account's transport or update its state.
            if (!isCurrent(account, token)) throw identityError();
            const code = (error as { data?: { code?: string } })?.data?.code;
            if (
              code === "CONFLICT" ||
              ![
                "BAD_REQUEST",
                "FORBIDDEN",
                "UNAUTHORIZED",
                "NOT_FOUND",
              ].includes(code ?? "")
            ) {
              // A timed-out save might have committed. Accept only an exact replay.
              const server = await readServer().catch(() => undefined);
              if (!isCurrent(account, token)) throw identityError();
              if (
                server?.payload != null &&
                draftPayloadEqual(server.payload, payload)
              ) {
                accept(server.revision);
                return;
              }
              if (server || code === "CONFLICT") {
                setBlocked(true);
                setNotice("草稿已在另一页面更新，当前内容已保留，请重新读取。");
              } else setNotice("草稿同步失败，当前内容已保留在本机。");
            } else setNotice("草稿同步失败，当前内容已保留在本机。");
            throw error;
          }
        });
      serial.current = work;
      return work.then(() => undefined);
    },
    [readServer, isCurrent, setBlocked]
  );

  const persist = useCallback(
    (raw: SalesOrderDraftPayload, critical = false): Promise<void> => {
      const payload = salesOrderDraftPayloadSchema.parse(raw);
      const account = live.current.identity;
      if (
        !live.current.ready ||
        owner.current !== account ||
        !initialized.current
      )
        return Promise.reject(new Error("请先核验账号与公司草稿。"));
      const current = loadSalesOrderDraft(account);
      if (
        current?.payload.form?.completed === true &&
        pendingSalesOrderRequest(payload)
      ) {
        const { completed: _completed, ...form } = current.payload.form;
        if (draftPayloadEqual({ ...current.payload, form }, payload))
          return Promise.reject(
            new Error("订单已保存，请重新读取草稿，不能再次发送原请求。")
          );
      }
      if (blocked.current) {
        // Only a byte-equivalent frozen request may be verified by its original
        // idempotency key. This is local durability, not permission to overwrite
        // the newer remote draft/tombstone or adopt its CAS revision.
        if (
          critical &&
          current &&
          latest.current &&
          stored.current &&
          current.payload.form?.completed !== true &&
          validatePendingSalesOrderRequest(payload) &&
          draftPayloadEqual(current.payload, payload) &&
          draftPayloadEqual(latest.current, payload) &&
          draftPayloadEqual(stored.current.payload, payload)
        ) {
          if (!saveSalesOrderDraft(account, current))
            return Promise.reject(
              new Error("无法保留原请求，请启用本地存储后重试。")
            );
          return Promise.resolve();
        }
        return Promise.reject(new Error("草稿版本冲突，当前内容已保留。"));
      }
      // Never replace a different in-flight create from another tab with an editable draft.
      if (
        current &&
        current.payload.form?.completed !== true &&
        pendingSalesOrderRequest(current.payload) &&
        (!latest.current ||
          !draftPayloadEqual(current.payload, latest.current)) &&
        !draftPayloadEqual(current.payload, payload)
      ) {
        setBlocked(true);
        setNotice("另一页面已有待确认请求，已停止覆盖草稿。");
        return Promise.reject(new Error("另一页面已有待确认请求。"));
      }
      if (
        !critical &&
        latest.current &&
        !stored.current?.dirty &&
        draftPayloadEqual(latest.current, payload)
      )
        return Promise.resolve();
      latest.current = payload;
      stored.current = {
        payload,
        revision: revision.current,
        savedAt: Date.now(),
        dirty: true,
      };
      const localSaved = saveSalesOrderDraft(account, stored.current);
      if (timer.current) clearTimeout(timer.current);
      if (critical && !localSaved)
        return Promise.reject(
          new Error("无法保留原请求，请启用本地存储后重试。")
        );
      const token = generation.current;
      if (critical) return sync(payload, account, token);
      timer.current = setTimeout(() => {
        void sync(payload, account, token).catch(() => undefined);
      });
      return Promise.resolve();
    },
    [sync, setBlocked]
  );

  // This is an explicit user operation, not automatic conflict reconciliation.
  // Keep the full old editable payload first; original sync still owns the exact CAS token.
  const replaceOrdinary = useCallback(
    async (expected: SalesOrderDraftPayload | null, next: SalesOrderDraftPayload) => {
      if (replacementBusy.current) throw new Error("草稿正在处理，请稍候。");
      const account = live.current.identity;
      const token = generation.current;
      const parsed = salesOrderDraftPayloadSchema.parse(next);
      if (hasLockedSalesOrderDraft(parsed)) throw new Error("不能用备份替换待确认请求。");
      replacementBusy.current = true;
      try {
        if (timer.current) clearTimeout(timer.current);
        timer.current = undefined;
        await serial.current.catch(() => undefined);
        if (!isCurrent(account, token) || !initialized.current) throw identityError();
        if (blocked.current) throw new Error("草稿版本冲突，请先重新读取，不能开始新单。");
        const same = (value: SalesOrderDraftPayload | null) =>
          expected === null ? value === null : value !== null && draftPayloadEqual(value, expected);
        const local = loadSalesOrderDraft(account);
        if (!same(latest.current) || (local && !same(local.payload)) ||
            (expected && hasLockedSalesOrderDraft(expected)) ||
            (local && hasLockedSalesOrderDraft(local.payload)))
          throw new Error("草稿或原请求已变化，原内容已保留，请重新读取后处理。");
        if (expected && !isUnstartedSalesOrderDraft(expected)) {
          const original = stored.current;
          if (!original || !draftPayloadEqual(original.payload, expected))
            throw new Error("无法核验原草稿，请重新读取。");
          const preserved = preserveSalesOrderDraft(account, original);
          if (!preserved) throw new Error("无法完整保留原草稿，未开始新单。请启用本地存储或继续原草稿。");
          setPreservedDrafts(listPreservedSalesOrderDrafts(account));
        }
        // No await between the local identity/content check and persist's local write.
        await persist(parsed, true);
        if (!isCurrent(account, token)) throw identityError();
        const after = loadSalesOrderDraft(account);
        if (!after || !draftPayloadEqual(after.payload, parsed)) {
          setBlocked(true);
          setNotice("另一页面草稿已变化，已停止恢复或新建；原草稿备份仍保留。");
          throw new Error("另一页面草稿已变化，请重新读取后处理。");
        }
        setInitialPayload(parsed);
        setNotice("原草稿已保留在本浏览器，可在业务订单的“已保留草稿”中恢复。");
      } finally {
        replacementBusy.current = false;
      }
    },
    [isCurrent, persist, setBlocked]
  );
  const restorePreserved = useCallback(
    async (archiveId: string) => {
      const saved = loadPreservedSalesOrderDraft(live.current.identity, archiveId);
      if (!saved) throw new Error("保留草稿无法完整读取，未替换当前草稿。");
      await replaceOrdinary(latest.current, saved.payload);
    },
    [replaceOrdinary]
  );

  const clear = useCallback(
    async (completedPayload?: SalesOrderDraftPayload) => {
      const account = live.current.identity;
      const token = generation.current;
      const payload = completedPayload ?? latest.current;
      if (timer.current) clearTimeout(timer.current);
      await serial.current.catch(() => undefined);
      if (!payload || !isCurrent(account, token)) return;
      // Clear only this exact request/form, never another tab's newer draft.
      const current = loadSalesOrderDraft(account);
      if (current && !draftPayloadEqual(current.payload, payload)) return;
      try {
        // A conflicted original request may be verified locally, but the remote
        // revision belongs to newer work. Completing it must not delete that work.
        if (blocked.current)
          throw new Error("原请求已完成，请核验草稿清理状态。");
        const result =
          revision.current > 0
            ? await api.current.deleteMutation.mutateAsync({
                expectedRevision: revision.current,
              })
            : null;
        if (!isCurrent(account, token)) return;
        const after = loadSalesOrderDraft(account);
        // Deletion retains a row: its returned revision is the next new draft's CAS token.
        if (result) revision.current = result.revision;
        if (after && !draftPayloadEqual(after.payload, payload)) return;
        clearSalesOrderDraft(account);
        latest.current = null;
        stored.current = null;
        setBlocked(false);
        setNotice("");
      } catch {
        if (!isCurrent(account, token)) return;
        // Re-check *after* the failed delete: another tab may have started a new draft.
        const after = loadSalesOrderDraft(account);
        if (!after || !draftPayloadEqual(after.payload, payload)) return;
        const completed = {
          ...payload,
          form: { ...payload.form, completed: true },
        };
        stored.current = {
          payload: completed,
          revision: revision.current,
          savedAt: Date.now(),
          dirty: true,
        };
        saveSalesOrderDraft(account, stored.current);
        latest.current = null;
        setBlocked(true);
        setNotice("订单已保存，草稿清理待同步。");
        // A delete timeout may already have committed. Rebase only on proved absence
        // or the identical original payload, never on another tab's newer server work.
        const server = await readServer().catch(() => undefined);
        if (!isCurrent(account, token)) return;
        if (server === null || server?.payload === null) {
          revision.current = server?.revision ?? 0;
          const current = loadSalesOrderDraft(account);
          if (current && draftPayloadEqual(current.payload, completed)) {
            clearSalesOrderDraft(account);
            stored.current = null;
          }
          setBlocked(false);
          setNotice("");
        } else if (
          server?.payload != null &&
          draftPayloadEqual(server.payload, payload)
        ) {
          revision.current = server.revision;
          setBlocked(false);
        } else if (server) {
          setBlocked(true);
          setNotice("另一页面草稿已更新，请重新读取后开始新单。");
        }
      }
    },
    [isCurrent, readServer, setBlocked]
  );
  const retryRestore = useCallback(() => {
    preferServerOnRestore.current = blocked.current;
    generation.current++;
    if (timer.current) clearTimeout(timer.current);
    initialized.current = false;
    setRestored(false);
    setRestoreAttempt(value => value + 1);
  }, []);
  return {
    identity,
    initialPayload: stateIdentity === identity ? initialPayload : null,
    restored: stateIdentity === identity && restored,
    writable:
      stateIdentity === identity && restored && scope.ready && !conflict,
    canVerifyPending:
      stateIdentity === identity && restored && scope.ready && canVerifyPending,
    notice: stateIdentity === identity ? notice : "",
    persist,
    clear,
    retryRestore,
    replaceOrdinary,
    restorePreserved,
    preservedDrafts: stateIdentity === identity ? preservedDrafts : [],
  };
}
