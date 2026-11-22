import { useLocation } from "wouter";
import { useBusinessScope } from "../../../../../BusinessScope";
import { trpc } from "../../../../../api/business-trpc";
import { usePageMemory } from "../../hooks/usePageMemory";
import { CustomerDemandDialog } from "./CustomerDemandDialog";
import {
  demandFreshReadOptions,
  useDemandServerRead,
} from "./useDemandReadSession";

/** One unambiguous server-issued ID; malformed/duplicate intents never fall back to keyword search. */
export function customerDemandExactId(search: string): number | null {
  const values = new URLSearchParams(search).getAll("demandId");
  if (values.length !== 1 || !/^[1-9]\d*$/.test(values[0])) return null;
  const value = Number(values[0]);
  return Number.isSafeInteger(value) && value <= 2147483647 ? value : null;
}

export function CustomerDemandExactEntry({ id }: { id: number | null }) {
  const scope = useBusinessScope();
  return (
    <CustomerDemandExactSession
      key={`${scope.storageScope}|${scope.contextVerification.authorizationVersion}|${id}`}
      id={id}
    />
  );
}

function CustomerDemandExactSession({ id }: { id: number | null }) {
  const ready = usePageMemory();
  const [, navigate] = useLocation();
  const query = trpc.customerDemand.get.useQuery(
    { id: id ?? 0 },
    { ...demandFreshReadOptions, enabled: ready && id !== null }
  );
  const read = useDemandServerRead(
    query,
    String(id),
    Boolean(query.data && query.data.id !== id)
  );
  const detail = ready ? read.data : undefined;
  const back = () => navigate("/customer-demands", { replace: true });
  if (id === null)
    return (
      <section role="alert">
        需求定位参数无效，请从提交成功入口重新打开。
        <button type="button" onClick={back}>
          返回客户需求
        </button>
      </section>
    );
  if (read.failed)
    return (
      <section role="alert">
        {query.error?.message || "无法查看此需求，请核验当前账号权限"}
        <button type="button" onClick={() => void query.refetch()}>
          重试
        </button>
        <button type="button" onClick={back}>
          返回客户需求
        </button>
      </section>
    );
  if (!detail) return <section aria-live="polite">正在核验此需求…</section>;
  // The customer binding is from an authorized get, never URL customer IDs or another staff identity.
  return (
    <CustomerDemandDialog
      customer={{ id: detail.customerId, name: detail.customerName }}
      demandId={detail.id}
      mode="view"
      readOnly
      onClose={back}
    />
  );
}
