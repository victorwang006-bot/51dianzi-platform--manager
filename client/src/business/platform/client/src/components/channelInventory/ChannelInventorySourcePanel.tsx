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
  /** Includes the real admin/staff/merchant/binding and current read/team/role scope. */
  scopeKey: string;
  isCurrent: () => boolean;
  onClose: () => void;
  onDenied: (unauthorized: boolean) => void;
};

type DetailState = { status: "loading" } | { status: "error" } | { status: "ready"; name: string; subject: string };

/** No source data enters React Query or a remembered store. Each open/retry/focus
 * sends a direct read; the BFF and front procedure are the only authorizers. */
export function ChannelInventorySourcePanel({ materialId, enterpriseId, actorUserId, scopeKey, isCurrent, onClose, onDenied }: Props) {
  const utils = trpc.useUtils();
  const titleId = useId();
  const dialog = useRef<HTMLElement>(null);
  const subject = JSON.stringify([scopeKey, materialId, enterpriseId, actorUserId]);
  const scopeCurrent = isCurrent();
  const live = useRef({ subject, isCurrent, onClose, onDenied });
  live.current = { subject, isCurrent, onClose, onDenied };
  const mounted = useRef(false);
  const request = useRef(0);
  const abort = useRef<AbortController | null>(null);
  const [detail, setDetail] = useState<DetailState>({ status: "loading" });

  const read = useCallback(async () => {
    if (!mounted.current || !live.current.isCurrent()) return;
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    const generation = ++request.current;
    const current = () => mounted.current && !controller.signal.aborted
      && request.current === generation && live.current.subject === subject && live.current.isCurrent();
    // Never retain the last successful name during reauthorization or a failure.
    setDetail({ status: "loading" });
    try {
      const input: SourceInput = { materialId, expectedEnterpriseId: enterpriseId, expectedActorUserId: actorUserId };
      const result: SourceResult = await utils.client.channelInventory.getTeamMaterialSource.query(input, { signal: controller.signal });
      if (!current()) return;
      setDetail({ status: "ready", name: result.name, subject });
    } catch (error) {
      if (!current()) return;
      const code = error && typeof error === "object" && "data" in error
        ? (error.data as { code?: string } | undefined)?.code : undefined;
      if (code === "FORBIDDEN" || code === "UNAUTHORIZED") {
        setDetail({ status: "loading" });
        live.current.onDenied(code === "UNAUTHORIZED");
      } else {
        // A transport failure does not mean permission was denied.
        setDetail({ status: "error" });
      }
    }
  }, [utils, materialId, enterpriseId, actorUserId, subject]);

  useEffect(() => {
    mounted.current = true;
    if (!scopeCurrent) {
      setDetail({ status: "loading" });
      live.current.onClose();
      return () => { mounted.current = false; request.current += 1; abort.current?.abort(); };
    }
    const trigger = document.activeElement as HTMLElement | null;
    dialog.current?.querySelector<HTMLButtonElement>("button")?.focus();
    void read();
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
      document.removeEventListener("keydown", escape);
      window.removeEventListener("focus", refresh);
      if (trigger?.isConnected) trigger.focus({ preventScroll: true });
    };
  }, [read, scopeCurrent]);

  if (!scopeCurrent) return null;
  return <div className="ci-modal-backdrop" role="presentation" onPointerDown={event => { if (event.target === event.currentTarget) onClose(); }} onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section ref={dialog} className="ci-host-dialog ci-source-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} onKeyDown={event => {
      if (event.key !== "Tab") return;
      const controls = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"));
      const first = controls[0]; const last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }}>
      <header><h2 id={titleId}>渠道来源</h2><button type="button" className="ci-icon-close" aria-label="关闭渠道来源" onClick={onClose}>×</button></header>
      <div className="ci-source-content" aria-live="polite" aria-busy={detail.status === "loading"}>
        {detail.status === "loading" ? <p className="ci-readonly">正在核验来源查看权限…</p> : null}
        {detail.status === "ready" && detail.subject === subject ? <><p className="ci-source-name">{detail.name}</p><p className="ci-readonly">仅显示渠道名称，不包含联系人、电话或私人备注。</p></> : null}
        {detail.status === "error" ? <><p className="ci-error" role="alert">来源读取暂时失败，请重试。</p><button type="button" className="ci-button" onClick={() => void read()}>重试读取来源</button></> : null}
      </div>
      <footer><button type="button" className="ci-button" onClick={onClose}>关闭</button></footer>
    </section>
  </div>;
}
