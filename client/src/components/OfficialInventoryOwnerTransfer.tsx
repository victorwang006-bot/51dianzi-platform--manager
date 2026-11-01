import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import {
  errorMessage,
  officialRequestId,
  type OfficialStock,
  type OfficialTeamsOverview,
} from "@/lib/officialChannelInventoryUi";
import { trpc } from "@/lib/trpc";
import { useMemo, useState } from "react";
import { toast } from "sonner";

type OwnerTransferProps = {
  /** Derived in the page only from the native source/stock serverScope. */
  isRealSuperAdmin: boolean;
  stock: OfficialStock | null;
  /** Parsed only from officialTeams.overview; it is never a merchant member list. */
  teamsOverview: OfficialTeamsOverview;
};

function hasCurrentRevision(revision: number): boolean {
  return Number.isSafeInteger(revision) && revision >= 1;
}

/**
 * A stock owner transfer never accepts a team, creator or member source from the
 * caller. Targets are constrained to current native members of this stock's team.
 */
export default function OfficialInventoryOwnerTransfer({
  isRealSuperAdmin,
  stock,
  teamsOverview,
}: OwnerTransferProps) {
  const utils = trpc.useUtils();
  const [open, setOpen] = useState(false);
  const [targetAdminUserId, setTargetAdminUserId] = useState<number | null>(
    null
  );
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const transferOwner =
    trpc.officialChannelInventory.transferOwner.useMutation();

  const teamIsActive = useMemo(
    () =>
      stock?.teamId !== null &&
      stock?.teamId !== undefined &&
      teamsOverview.available &&
      teamsOverview.teams.some(
        team => team.id === stock.teamId && team.status === "active"
      ),
    [stock?.teamId, teamsOverview.available, teamsOverview.teams]
  );
  const candidates = useMemo(() => {
    if (!stock?.teamId || !teamIsActive || !teamsOverview.available) return [];
    // officialTeams.overview members are native active members. Do not use a
    // browser role, merchant team, or a separately projected staff list here.
    return teamsOverview.members.filter(
      member => member.teamId === stock.teamId
    );
  }, [
    stock?.teamId,
    teamIsActive,
    teamsOverview.available,
    teamsOverview.members,
  ]);
  const validRevision = stock ? hasCurrentRevision(stock.revision) : false;

  if (!isRealSuperAdmin || !stock) return null;

  const openTransferDialog = () => {
    setTargetAdminUserId(null);
    setReason("");
    setConfirmed(false);
    setRequestId(officialRequestId("official_stock_transfer_owner"));
    setSubmitError(null);
    setOpen(true);
  };

  const submitTransfer = async () => {
    if (!isRealSuperAdmin || transferOwner.isPending) return;
    if (!teamIsActive || candidates.length === 0) {
      setSubmitError("未返回该库存所属团队的可核验活跃成员，交接保持关闭。");
      return;
    }
    if (
      !targetAdminUserId ||
      !candidates.some(member => member.adminUserId === targetAdminUserId)
    ) {
      setSubmitError("请选择该库存所属官方团队中的活跃成员。");
      return;
    }
    const trimmedReason = reason.trim();
    if (!trimmedReason) {
      setSubmitError("请填写交接原因。");
      return;
    }
    if (!validRevision) {
      setSubmitError("库存版本号无效，请刷新详情后重试。");
      return;
    }
    if (!confirmed) {
      setSubmitError("请确认本操作不会转移团队或修改创建人。");
      return;
    }
    if (!requestId) {
      setSubmitError("请求号未就绪，请关闭后重新打开交接窗口。");
      return;
    }

    setSubmitError(null);
    try {
      await transferOwner.mutateAsync({
        stockId: stock.id,
        targetAdminUserId,
        reason: trimmedReason,
        expectedRevision: stock.revision,
        requestId,
      });
      toast.success("库存负责人已交接");
      await Promise.all([
        utils.officialChannelInventory.listStocks.invalidate(),
        utils.officialChannelInventory.getStock.invalidate({
          stockId: stock.id,
        }),
      ]);
      setOpen(false);
    } catch (error) {
      const message = errorMessage(
        error,
        "负责人交接失败，请保留本窗口后重试。"
      );
      setSubmitError(message);
      toast.error("负责人未交接", { description: message });
    }
  };

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={
          !teamsOverview.available ||
          !teamIsActive ||
          candidates.length === 0 ||
          !validRevision ||
          transferOwner.isPending
        }
        title={
          !teamsOverview.available
            ? "正在读取可核验的官方团队成员"
            : !teamIsActive
              ? "库存所属官方团队不可用或已归档"
              : candidates.length === 0
                ? "该团队没有可交接的活跃成员"
                : !validRevision
                  ? "库存版本号无效，请刷新详情后重试"
                  : undefined
        }
        onClick={openTransferDialog}
      >
        交接负责人
      </Button>
      <Dialog
        open={open}
        onOpenChange={nextOpen => {
          if (!nextOpen && !transferOwner.isPending) setOpen(false);
        }}
      >
        <DialogContent
          className="official-channel-inventory__dialog max-w-[560px]"
          onPointerDownOutside={event => {
            if (transferOwner.isPending) event.preventDefault();
          }}
        >
          <DialogHeader>
            <DialogTitle>交接负责人</DialogTitle>
            <DialogDescription>
              {stock.partNumber} · {stock.sourceName}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <label className="grid gap-1.5 text-xs text-muted-foreground">
              <span>新负责人 *</span>
              <select
                value={targetAdminUserId ?? ""}
                disabled={transferOwner.isPending}
                onChange={event => {
                  setTargetAdminUserId(Number(event.target.value) || null);
                  setSubmitError(null);
                }}
              >
                <option value="">请选择同一官方团队的活跃成员</option>
                {candidates.map(member => (
                  <option key={member.adminUserId} value={member.adminUserId}>
                    {member.displayName}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1.5 text-xs text-muted-foreground">
              <span>交接原因 *</span>
              <Textarea
                value={reason}
                maxLength={1000}
                rows={3}
                disabled={transferOwner.isPending}
                placeholder="说明负责人交接依据"
                onChange={event => {
                  setReason(event.target.value);
                  setSubmitError(null);
                }}
              />
            </label>
            <div className="rounded-md border bg-muted/30 p-3 text-xs leading-5 text-muted-foreground">
              候选人仅来自该库存所属官方团队的当前活跃成员。交接只更新单一负责人；不会变更团队快照，也不会变更创建人。
            </div>
            <label className="flex items-start gap-2 text-xs leading-5">
              <input
                type="checkbox"
                checked={confirmed}
                disabled={transferOwner.isPending}
                onChange={event => {
                  setConfirmed(event.target.checked);
                  setSubmitError(null);
                }}
              />
              <span>我确认已核对目标成员与交接原因。</span>
            </label>
          </div>
          {submitError ? (
            <p className="text-sm text-destructive" role="alert">
              {submitError}
            </p>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={transferOwner.isPending}
              onClick={() => setOpen(false)}
            >
              取消
            </Button>
            <Button
              type="button"
              disabled={
                !teamIsActive ||
                !targetAdminUserId ||
                !reason.trim() ||
                !confirmed ||
                !requestId ||
                !validRevision ||
                transferOwner.isPending
              }
              onClick={() => void submitTransfer()}
            >
              {transferOwner.isPending ? "交接中…" : "确认交接负责人"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
