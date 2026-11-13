import { useEffect, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  errorMessage,
  officialRequestId,
  type OfficialStock,
  type OfficialTeamsOverview,
} from "@/lib/officialChannelInventoryUi";

export function officialReceptionDescription(
  value:
    | { status?: string; recipientName?: string | null; reason?: string | null }
    | null
    | undefined
) {
  return value?.status === "ready" && value.recipientName
    ? `前台以51电子网工厂渠道接待展示，实际由${value.recipientName}接待`
    : "接待待配置：尚未核验可信卖方企业、真实员工绑定及询价接待权限";
}
/** Native management only. Queries never create an inquiry or grant permissions. */
export default function OfficialInventoryReception({
  stock,
  isRealSuperAdmin,
  teamsOverview,
}: {
  stock: OfficialStock;
  isRealSuperAdmin: boolean;
  teamsOverview: OfficialTeamsOverview;
}) {
  const utils = trpc.useUtils();
  const query = trpc.officialChannelInventory.getReception.useQuery(
    { stockId: stock.id },
    { retry: false, refetchOnWindowFocus: false }
  );
  const mutation =
    trpc.officialChannelInventory.configureReception.useMutation();
  const [merchantId, setMerchantId] = useState("");
  const [mode, setMode] = useState<"owner" | "explicit">("owner");
  const [recipientId, setRecipientId] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [frozen, setFrozen] = useState<
    Parameters<typeof mutation.mutateAsync>[0] | null
  >(null);
  useEffect(() => {
    setFrozen(null);
    setConfirmed(false);
    setError("");
    setReason("");
  }, [stock.id]);
  useEffect(() => {
    if (!query.data || frozen) return;
    setMerchantId(query.data.merchantId ? String(query.data.merchantId) : "");
    setMode(query.data.reception.routingMode);
    setRecipientId(
      query.data.reception.recipientAdminUserId
        ? String(query.data.reception.recipientAdminUserId)
        : ""
    );
  }, [query.data, frozen]);
  const candidates = teamsOverview.members.filter(
    member => member.teamId === stock.teamId
  );
  const save = async () => {
    if (!isRealSuperAdmin || !query.data || !confirmed || mutation.isPending)
      return;
    const merchant = Number(merchantId),
      recipient = Number(recipientId);
    if (
      !Number.isSafeInteger(merchant) ||
      merchant <= 0 ||
      (mode === "explicit" &&
        !candidates.some(member => member.adminUserId === recipient))
    ) {
      setError("请选择可信商户ID及同一官方团队的接待员工");
      return;
    }
    const payload = frozen ?? {
      stockId: stock.id,
      merchantId: merchant,
      routingMode: mode,
      ...(mode === "explicit" ? { recipientAdminUserId: recipient } : {}),
      expectedRevision: query.data.stockRevision,
      expectedResponsibilityVersion: query.data.expectedResponsibilityVersion,
      reason: reason.trim(),
      requestId: officialRequestId("official_reception"),
    };
    if (!payload.reason) {
      setError("请说明配置依据");
      return;
    }
    setFrozen(payload);
    setError("");
    try {
      await mutation.mutateAsync(payload);
      setFrozen(null);
      setConfirmed(false);
      setReason("");
      await Promise.all([
        query.refetch(),
        utils.officialChannelInventory.listStocks.invalidate(),
        utils.officialChannelInventory.getStock.invalidate({
          stockId: stock.id,
        }),
      ]);
    } catch (caught) {
      setError(
        errorMessage(caught, "接待配置结果待确认，请按原请求重试或刷新核对")
      );
    }
  };
  return (
    <section
      className="rounded-md border p-3 text-sm space-y-2"
      aria-label="工厂库存询价接待配置"
    >
      <strong>前台询价接待</strong>
      <p role="status">
        {query.isPending
          ? "正在核验实际接待…"
          : query.isError
            ? "接待待配置：接待状态暂时无法核验"
            : officialReceptionDescription(query.data?.reception)}
      </p>
      {query.data ? (
        <p className="text-xs text-muted-foreground">
          责任版本 {query.data.expectedResponsibilityVersion} ·{" "}
          {query.data.reception.routingMode === "explicit"
            ? "已有明确分工（交接库存不会覆盖）"
            : "当前业务负责人接待"}
        </p>
      ) : null}
      <p className="text-xs text-muted-foreground">
        品牌展示不改变真实卖方企业。管理员代发布不是接待分配；未来分工与已有询价交接相互独立。
      </p>
      {isRealSuperAdmin && query.data ? (
        <div className="grid gap-2">
          <label>
            可信卖方商户ID
            <Input
              inputMode="numeric"
              value={merchantId}
              disabled={Boolean(frozen) || mutation.isPending}
              onChange={event => setMerchantId(event.target.value)}
            />
          </label>
          <p className="text-xs text-muted-foreground">
            使用已核对的后台商户ID；服务器按正式企业登记与所有者绑定核验，不按工厂名称匹配。
          </p>
          <label>
            未来询价分工
            <select
              value={mode}
              disabled={Boolean(frozen) || mutation.isPending}
              onChange={event =>
                setMode(event.target.value as "owner" | "explicit")
              }
            >
              <option value="owner">由当前库存业务负责人接待</option>
              <option value="explicit">
                明确指定同企业接待员工（保留分工）
              </option>
            </select>
          </label>
          {mode === "explicit" ? (
            <label>
              实际接待员工
              <select
                value={recipientId}
                disabled={Boolean(frozen) || mutation.isPending}
                onChange={event => setRecipientId(event.target.value)}
              >
                <option value="">请选择</option>
                {candidates.map(member => (
                  <option key={member.adminUserId} value={member.adminUserId}>
                    {member.displayName}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <label>
            配置依据
            <Input
              value={reason}
              maxLength={1000}
              disabled={Boolean(frozen) || mutation.isPending}
              onChange={event => setReason(event.target.value)}
            />
          </label>
          <label className="flex gap-2">
            <input
              type="checkbox"
              checked={confirmed}
              disabled={Boolean(frozen) || mutation.isPending}
              onChange={event => setConfirmed(event.target.checked)}
            />
            我确认此配置仅影响未来询价，不改派已有询价；修改已有明确分工是本次显式决定。
          </label>
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              disabled={!confirmed || mutation.isPending || !reason.trim()}
              onClick={() => void save()}
            >
              {frozen ? "按原请求重试配置" : "明确确认接待配置"}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={mutation.isPending}
              onClick={() => {
                setFrozen(null);
                setConfirmed(false);
                void query.refetch();
              }}
            >
              刷新核对
            </Button>
          </div>
        </div>
      ) : null}
      {error ? (
        <p className="text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
