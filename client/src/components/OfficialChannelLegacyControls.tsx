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
  type OfficialSource,
  type OfficialTeam,
} from "@/lib/officialChannelInventoryUi";
import { trpc } from "@/lib/trpc";
import { useState } from "react";
import { toast } from "sonner";

type LegacyControlsProps = {
  /** Derived in the page only from a complete native source/stock serverScope. */
  isRealSuperAdmin: boolean;
};

type LegacySourceClassificationProps = LegacyControlsProps & {
  source: OfficialSource;
  /** Parsed only from the real officialTeams.overview response. */
  activeTeams: readonly OfficialTeam[];
  teamsAvailable: boolean;
};

function hasCurrentRevision(revision: number): boolean {
  return Number.isSafeInteger(revision) && revision >= 1;
}

async function invalidateLegacyAffectedQueries(
  utils: ReturnType<typeof trpc.useUtils>
) {
  await Promise.all([
    utils.officialChannelInventory.listSources.invalidate(),
    utils.officialChannelInventory.listStocks.invalidate(),
    utils.officialChannelLegacy.overviewLegacy.invalidate(),
  ]);
}

function overviewStateText(state: string): string {
  return (
    {
      ready: "可接入",
      nothing_to_import: "没有可接入的旧资料",
      legacy_tables_missing: "旧资料表不可用",
      official_owner_missing_or_invalid: "历史官方归属未通过核验",
      already_imported_or_conflicted: "已接入或存在冲突",
    }[state] ?? "状态未识别"
  );
}

/**
 * Super-admin-only legacy preflight and explicit import. No mutation is ever
 * started by mounting this component, by loading the overview, or by closing a dialog.
 */
export function OfficialChannelLegacyControls({
  isRealSuperAdmin,
}: LegacyControlsProps) {
  const utils = trpc.useUtils();
  const [open, setOpen] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const overviewQuery = trpc.officialChannelLegacy.overviewLegacy.useQuery(
    undefined,
    {
      // This component is mounted by the page only for a complete native
      // super-admin scope. Keep the query equally fail-closed in case props change.
      enabled: isRealSuperAdmin,
      retry: false,
      refetchOnWindowFocus: false,
    }
  );
  const importLegacy = trpc.officialChannelLegacy.importLegacy.useMutation();

  if (!isRealSuperAdmin) return null;

  const overview = overviewQuery.data;
  const canImport = overview?.canImport === true;

  const openImportDialog = () => {
    setRequestId(officialRequestId("official_legacy_import"));
    setConfirmed(false);
    setSubmitError(null);
    setOpen(true);
  };

  const submitImport = async () => {
    if (!isRealSuperAdmin || importLegacy.isPending) return;
    if (!canImport) {
      setSubmitError("当前旧资料预检不允许接入；请刷新预检结果后重试。");
      return;
    }
    if (!confirmed) {
      setSubmitError("请确认旧表不会被修改以及接入后的初始状态。");
      return;
    }
    if (!requestId) {
      setSubmitError("请求号未就绪，请关闭后重新打开确认窗口。");
      return;
    }

    setSubmitError(null);
    try {
      const result = await importLegacy.mutateAsync({ requestId });
      toast.success(
        `旧资料已接入：${result.importedSources.length} 个来源，${result.importedStocks.length} 条库存。`
      );
      await invalidateLegacyAffectedQueries(utils);
      setOpen(false);
    } catch (error) {
      const message = errorMessage(
        error,
        "旧资料接入失败，请保留本窗口后重试。"
      );
      setSubmitError(message);
      toast.error("旧资料未接入", { description: message });
    }
  };

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-8 text-xs"
        disabled={importLegacy.isPending}
        onClick={openImportDialog}
      >
        接入旧资料
        {overview
          ? `（${overview.legacySourceCount}/${overview.legacyStockCount}）`
          : ""}
      </Button>
      <Dialog
        open={open}
        onOpenChange={nextOpen => {
          if (!nextOpen && !importLegacy.isPending) setOpen(false);
        }}
      >
        <DialogContent
          className="official-channel-inventory__dialog max-w-[560px]"
          onPointerDownOutside={event => {
            if (importLegacy.isPending) event.preventDefault();
          }}
        >
          <DialogHeader>
            <DialogTitle>接入旧资料</DialogTitle>
            <DialogDescription>
              此操作只能由真实后台超级管理员显式确认后执行。
            </DialogDescription>
          </DialogHeader>
          {overviewQuery.isPending ? (
            <p className="text-sm text-muted-foreground">正在进行旧资料预检…</p>
          ) : overviewQuery.isError ? (
            <p className="text-sm text-destructive" role="alert">
              旧资料预检失败：
              {errorMessage(overviewQuery.error, "请刷新后重试。")}
            </p>
          ) : overview ? (
            <div className="space-y-3 text-sm">
              <p>
                预检结果：旧来源 <strong>{overview.legacySourceCount}</strong>{" "}
                条，旧库存 <strong>{overview.legacyStockCount}</strong>{" "}
                条；已接入来源 <strong>{overview.importedSourceCount}</strong>{" "}
                条，已接入库存 <strong>{overview.importedStockCount}</strong>{" "}
                条。
              </p>
              <p
                className={
                  canImport ? "text-muted-foreground" : "text-destructive"
                }
              >
                当前状态：{overviewStateText(overview.state)}。
              </p>
              <div className="rounded-md border bg-muted/30 p-3 text-xs leading-5 text-muted-foreground">
                <p>旧资料表保持不变，不会被本操作写入。</p>
                <p>新建来源和库存先保持未归类；库存全部为草稿。</p>
                <p>不会自动发布，也不会自动转移负责人。</p>
              </div>
              <label className="flex items-start gap-2 text-xs leading-5">
                <input
                  type="checkbox"
                  checked={confirmed}
                  disabled={!canImport || importLegacy.isPending}
                  onChange={event => {
                    setConfirmed(event.target.checked);
                    setSubmitError(null);
                  }}
                />
                <span>
                  我已确认上述不可逆接入范围，并明确开始本次旧资料接入。
                </span>
              </label>
            </div>
          ) : (
            <p className="text-sm text-destructive" role="alert">
              旧资料预检未返回可核验结果，接入操作保持关闭。
            </p>
          )}
          {submitError ? (
            <p className="text-sm text-destructive" role="alert">
              {submitError}
            </p>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={importLegacy.isPending}
              onClick={() => setOpen(false)}
            >
              取消
            </Button>
            <Button
              type="button"
              disabled={
                !canImport || !confirmed || !requestId || importLegacy.isPending
              }
              onClick={() => void submitImport()}
            >
              {importLegacy.isPending ? "接入中…" : "确认接入旧资料"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** A one-time, per-source team initialization; it is not a generic reassignment control. */
export function OfficialLegacySourceClassification({
  isRealSuperAdmin,
  source,
  activeTeams,
  teamsAvailable,
}: LegacySourceClassificationProps) {
  const utils = trpc.useUtils();
  const [open, setOpen] = useState(false);
  const [teamId, setTeamId] = useState<number | null>(null);
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const classifyLegacySource =
    trpc.officialChannelLegacy.classifyLegacySource.useMutation();

  const eligibleSource =
    source.legacySourceId !== null && source.teamId === null;
  const validRevision = hasCurrentRevision(source.revision);

  if (!isRealSuperAdmin || !eligibleSource) return null;

  const openClassificationDialog = () => {
    setTeamId(activeTeams.length === 1 ? activeTeams[0].id : null);
    setReason("");
    setConfirmed(false);
    setRequestId(officialRequestId("official_legacy_classify"));
    setSubmitError(null);
    setOpen(true);
  };

  const submitClassification = async () => {
    if (!isRealSuperAdmin || classifyLegacySource.isPending) return;
    if (!teamsAvailable || activeTeams.length === 0) {
      setSubmitError("未返回可核验的启用官方团队，归类保持关闭。");
      return;
    }
    if (!teamId || !activeTeams.some(team => team.id === teamId)) {
      setSubmitError("请选择启用的官方团队。");
      return;
    }
    const trimmedReason = reason.trim();
    if (!trimmedReason) {
      setSubmitError("请填写归类原因。");
      return;
    }
    if (!validRevision) {
      setSubmitError("来源版本号无效，请刷新来源后重试。");
      return;
    }
    if (!confirmed) {
      setSubmitError("请确认归类不会替代负责人核验或自动改派负责人。");
      return;
    }
    if (!requestId) {
      setSubmitError("请求号未就绪，请关闭后重新打开归类窗口。");
      return;
    }

    setSubmitError(null);
    try {
      const result = await classifyLegacySource.mutateAsync({
        sourceId: source.id,
        teamId,
        expectedRevision: source.revision,
        requestId,
        reason: trimmedReason,
      });
      toast.success(
        `旧来源已首次归类，已初始化 ${result.stocks.length} 条库存。`
      );
      await invalidateLegacyAffectedQueries(utils);
      setOpen(false);
    } catch (error) {
      const message = errorMessage(
        error,
        "旧来源归类失败，请保留本窗口后重试。"
      );
      setSubmitError(message);
      toast.error("旧来源未归类", { description: message });
    }
  };

  return (
    <>
      <button
        type="button"
        className="ci-inline-link"
        disabled={
          !teamsAvailable ||
          activeTeams.length === 0 ||
          !validRevision ||
          classifyLegacySource.isPending
        }
        title={
          !teamsAvailable
            ? "正在读取可核验的官方团队"
            : activeTeams.length === 0
              ? "没有启用的官方团队可供归类"
              : !validRevision
                ? "来源版本号无效，请刷新后重试"
                : undefined
        }
        onClick={openClassificationDialog}
      >
        归类
      </button>
      <Dialog
        open={open}
        onOpenChange={nextOpen => {
          if (!nextOpen && !classifyLegacySource.isPending) setOpen(false);
        }}
      >
        <DialogContent
          className="official-channel-inventory__dialog max-w-[560px]"
          onPointerDownOutside={event => {
            if (classifyLegacySource.isPending) event.preventDefault();
          }}
        >
          <DialogHeader>
            <DialogTitle>首次归类旧来源</DialogTitle>
            <DialogDescription>
              {source.name}（旧来源标识 {source.legacySourceId}）
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <label className="grid gap-1.5 text-xs text-muted-foreground">
              <span>目标官方团队 *</span>
              <select
                value={teamId ?? ""}
                disabled={!teamsAvailable || classifyLegacySource.isPending}
                onChange={event => {
                  setTeamId(Number(event.target.value) || null);
                  setSubmitError(null);
                }}
              >
                <option value="">请选择启用官方团队</option>
                {activeTeams.map(team => (
                  <option key={team.id} value={team.id}>
                    {team.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1.5 text-xs text-muted-foreground">
              <span>归类原因 *</span>
              <Textarea
                value={reason}
                maxLength={1000}
                rows={3}
                disabled={classifyLegacySource.isPending}
                placeholder="说明本次首次初始化的依据"
                onChange={event => {
                  setReason(event.target.value);
                  setSubmitError(null);
                }}
              />
            </label>
            <div className="rounded-md border bg-muted/30 p-3 text-xs leading-5 text-muted-foreground">
              这只会首次初始化该来源及其未归类库存的团队快照。它不会替您分组、变更负责人或创建人；服务端会重新核验所有现负责人均已是目标官方团队的活跃成员。
            </div>
            <label className="flex items-start gap-2 text-xs leading-5">
              <input
                type="checkbox"
                checked={confirmed}
                disabled={classifyLegacySource.isPending}
                onChange={event => {
                  setConfirmed(event.target.checked);
                  setSubmitError(null);
                }}
              />
              <span>我确认这是不可逆的首次归类，且不以此操作改派负责人。</span>
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
              disabled={classifyLegacySource.isPending}
              onClick={() => setOpen(false)}
            >
              取消
            </Button>
            <Button
              type="button"
              disabled={
                !teamsAvailable ||
                !teamId ||
                !reason.trim() ||
                !confirmed ||
                !requestId ||
                !validRevision ||
                classifyLegacySource.isPending
              }
              onClick={() => void submitClassification()}
            >
              {classifyLegacySource.isPending ? "归类中…" : "确认首次归类"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
