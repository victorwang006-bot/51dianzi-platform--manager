import React, { useCallback, useEffect, useId, useRef, useState } from "react";
import type { inferRouterInputs, inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../../front-router-types/server/routers";
import { trpc } from "../../../../../api/business-trpc";

type SourceInput = inferRouterInputs<AppRouter>["channelInventory"]["getTeamMaterialSource"];
type SourceResult = inferRouterOutputs<AppRouter>["channelInventory"]["getTeamMaterialSource"];

type Props = {
  materialId: number;
  enterpriseId: number;
  actorUserId: number;
  /** Stable BFF-proven identity + effective authorization, never a polling state. */
  scopeKey: string;
  /** A same-identity background check masks data without destroying the dialog. */
  active?: boolean;
  isCurrent: () => boolean;
  onClose: () => void;
  /** Direct queries bypass QueryCache; report security failures to the session. */
  onAuthorizationError?: (error: unknown) => void;
};

type DetailState = { status: "loading" } | { status: "denied" } | { status: "error" } | { status: "ready"; name: string; subject: string };

/** No source data enters React Query or a remembered store. Each open/retry/focus
 * sends a direct read; the BFF and front procedure are the only authorizers. */
export function ChannelInventorySourcePanel({ materialId, enterpriseId, actorUserId, scopeKey, active = true, isCurrent, onClose, onAuthorizationError }: Props) {
  const utils = trpc.useUtils();
  const titleId = useId();
  const dialog = useRef<HTMLElement>(null);
  const subject = JSON.stringify([scopeKey, materialId, enterpriseId, actorUserId]);
  const scopeCurrent = isCurrent();
  const live = useRef({ subject, active, isCurrent, onClose, onAuthorizationError, utils });
  live.current = { subject, active, isCurrent, onClose, onAuthorizationError, utils };
  const mounted = useRef(false);
  const request = useRef(0);
  const abort = useRef<AbortController | null>(null);
  const pending = useRef<{ subject: string; generation: number } | null>(null);
  const [detail, setDetail] = useState<DetailState>({ status: "loading" });

  const read = useCallback(async () => {
    if (!mounted.current || !live.current.active || !live.current.isCurrent()) return;
    // Coalesce focus bursts, including a focus event during the opening read.
    if (pending.current?.subject === subject) return;
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    const generation = ++request.current;
    pending.current = { subject, generation };
    const current = () => mounted.current && !controller.signal.aborted
      && request.current === generation && live.current.subject === subject && live.current.active && live.current.isCurrent();
    // Never retain the last successful name during reauthorization or a failure.
    setDetail({ status: "loading" });
    try {
      const input: SourceInput = { materialId, expectedEnterpriseId: enterpriseId, expectedActorUserId: actorUserId };
      const result: SourceResult = await live.current.utils.client.channelInventory.getTeamMaterialSource.query(input, { signal: controller.signal });
      if (!current()) return;
      setDetail({ status: "ready", name: result.name, subject });
    } catch (error) {
      if (!current()) return;
      const data = error && typeof error === "object" && "data" in error
        ? error.data as { code?: string; httpStatus?: number; businessFailure?: string } | undefined : undefined;
      const sessionInvalid = data?.code === "UNAUTHORIZED" || data?.httpStatus === 401 || ["AUTH_SESSION_INVALID", "STAFF_BINDING_INVALID", "TENANT_ACCESS_REVOKED"].includes(data?.businessFailure ?? "");
      // The session owns real login/binding/tenant loss, including direct reads.
      live.current.onAuthorizationError?.(error);
      if (!current()) return;
      if (!sessionInvalid && (data?.businessFailure === "BUSINESS_RESOURCE_FORBIDDEN" || data?.code === "NOT_FOUND")) {
        setDetail({ status: "denied" });
      } else {
        // Unknown/security/transport failures do not invent resource permission.
        setDetail({ status: "error" });
      }
    } finally {
      if (pending.current?.generation === generation) pending.current = null;
    }
  }, [materialId, enterpriseId, actorUserId, subject]);

  useEffect(() => {
    mounted.current = true;
    const trigger = document.activeElement as HTMLElement | null;
    dialog.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      live.current.onClose();
    };
    const refresh = () => { void read(); };
    document.addEventListener("keydown", escape);
    window.addEventListener("focus", refresh);
    return () => {
      mounted.current = false;
      request.current += 1;
      abort.current?.abort();
      pending.current = null;
      document.removeEventListener("keydown", escape);
      window.removeEventListener("focus", refresh);
      if (trigger?.isConnected) trigger.focus({ preventScroll: true });
    };
  }, [read]);

  useEffect(() => {
    // Revalidation is a pause, not revocation. Clear/abort immediately, then
    // authorize afresh once the same identity has been verified again.
    request.current += 1;
    abort.current?.abort();
    pending.current = null;
    setDetail({ status: "loading" });
    if (!scopeCurrent) live.current.onClose();
    else if (active) void read();
    return () => { request.current += 1; abort.current?.abort(); pending.current = null; };
  }, [read, active, scopeCurrent]);

  if (!scopeCurrent) return null;
  const shown: DetailState = active ? detail : { status: "loading" };
  return <div className="ci-modal-backdrop" role="presentation" onPointerDown={event => { if (event.target === event.currentTarget) onClose(); }} onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section ref={dialog} className="ci-host-dialog ci-source-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} onKeyDown={event => {
      if (event.key !== "Tab") return;
      const controls = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"));
      const first = controls[0]; const last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }}>
      <header><h2 id={titleId}>渠道来源</h2><button type="button" className="ci-icon-close" aria-label="关闭渠道来源" onClick={onClose}>×</button></header>
      <div className="ci-source-content" aria-live="polite" aria-busy={shown.status === "loading"}>
        {shown.status === "loading" ? <p className="ci-readonly">正在核验来源查看权限…</p> : null}
        {shown.status === "ready" && shown.subject === subject ? <><p className="ci-source-name">{shown.name}</p><p className="ci-readonly">仅显示渠道名称，不包含联系人、电话或私人备注。</p></> : null}
        {shown.status === "denied" ? <p className="ci-readonly">暂无权限查看</p> : null}
        {shown.status === "error" ? <><p className="ci-error" role="alert">来源读取暂时失败，请重试。</p><button type="button" className="ci-button" onClick={() => void read()}>重试读取来源</button></> : null}
      </div>
      <footer><button type="button" className="ci-button" onClick={onClose}>关闭</button></footer>
    </section>
  </div>;
}
