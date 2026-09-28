import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { formatBeijingDateTimeWithSeconds } from "@shared/beijingTime";
import { BadgeCheck, Loader2, ShieldX } from "lucide-react";
import { toast } from "sonner";

const MARKING_LABEL: Record<string, string> = {
  printed: "印刷标签",
  laser: "激光丝印",
  handwritten: "手写",
  screen: "截图",
  unknown: "未知",
};

export default function MerchantSpotVerificationPanel({
  merchantId,
  canManage,
}: {
  merchantId: number;
  canManage: boolean;
}) {
  const utils = trpc.useUtils();
  const reviewsQuery = trpc.merchant.spotVerificationReviews.useQuery({ merchantId, status: "pending" });
  const activeQuery = trpc.merchant.activeSpotVerifications.useQuery({ merchantId });
  const approveMutation = trpc.merchant.approveSpotVerification.useMutation({
    onSuccess: () => {
      toast.success("已通过");
      void utils.merchant.spotVerificationReviews.invalidate();
      void utils.merchant.activeSpotVerifications.invalidate();
    },
    onError: (error) => toast.error(error.message || "通过失败"),
  });
  const rejectMutation = trpc.merchant.rejectSpotVerification.useMutation({
    onSuccess: () => {
      toast.success("已拒绝");
      void utils.merchant.spotVerificationReviews.invalidate();
    },
    onError: (error) => toast.error(error.message || "拒绝失败"),
  });
  const cancelMutation = trpc.merchant.cancelSpotVerification.useMutation({
    onSuccess: () => {
      toast.success("已取消绿标");
      void utils.merchant.activeSpotVerifications.invalidate();
    },
    onError: (error) => toast.error(error.message || "取消失败"),
  });

  const pending = (reviewsQuery.data as { items?: Array<Record<string, unknown>> } | undefined)?.items ?? [];
  const active = (activeQuery.data as { items?: Array<Record<string, unknown>> } | undefined)?.items ?? [];
  const busyId = approveMutation.isPending || rejectMutation.isPending || cancelMutation.isPending;

  return (
    <div className="space-y-3" data-merchant-spot-verification-panel>
      <section className="overflow-hidden rounded-lg border bg-white text-[13px]">
        <div className="border-b px-4 py-3">
          <h2 className="text-[15px] font-semibold">待人工核验</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">手写、截图或无法确认的照片。通过后挂绿标；拒绝后由 51小电通知商家。</p>
        </div>
        {reviewsQuery.isLoading ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground"><Loader2 className="mr-2 h-4 w-4 animate-spin" />加载中…</div>
        ) : pending.length === 0 ? (
          <div className="py-10 text-center text-muted-foreground">暂无待核验</div>
        ) : (
          <div className="divide-y">
            {pending.map(item => {
              const id = Number(item.id);
              const part = String(item.inventoryPartNumber || item.recognizedPartNumber || "");
              return (
                <div key={id} className="flex flex-wrap items-start gap-4 px-4 py-3">
                  {item.photoUrl ? (
                    <a href={String(item.photoUrl)} target="_blank" rel="noreferrer" className="block h-24 w-24 overflow-hidden rounded border bg-muted">
                      <img src={String(item.photoUrl)} alt={part} className="h-full w-full object-cover" />
                    </a>
                  ) : <div className="h-24 w-24 rounded border bg-muted" />}
                  <div className="min-w-[180px] flex-1">
                    <div className="font-medium">{part || "未识别料号"}</div>
                    <div className="mt-1 text-xs text-muted-foreground">识别料号 {String(item.recognizedPartNumber || "—")} · {MARKING_LABEL[String(item.markingSource)] || "未知"}</div>
                    <div className="mt-1 text-xs text-muted-foreground">{item.createdAt ? formatBeijingDateTimeWithSeconds(String(item.createdAt)) : ""}</div>
                  </div>
                  {canManage ? (
                    <div className="flex gap-2">
                      <Button size="sm" className="h-8 text-xs" disabled={busyId} onClick={() => approveMutation.mutate({ merchantId, reviewId: id })}>
                        <BadgeCheck className="mr-1 h-3.5 w-3.5" />通过
                      </Button>
                      <Button size="sm" variant="destructive" className="h-8 text-xs" disabled={busyId} onClick={() => rejectMutation.mutate({ merchantId, reviewId: id })}>
                        <ShieldX className="mr-1 h-3.5 w-3.5" />拒绝
                      </Button>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="overflow-hidden rounded-lg border bg-white text-[13px]">
        <div className="border-b px-4 py-3">
          <h2 className="text-[15px] font-semibold">已挂绿标</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">取消后立即下绿标，并由 51小电通知商家重拍。</p>
        </div>
        {activeQuery.isLoading ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground"><Loader2 className="mr-2 h-4 w-4 animate-spin" />加载中…</div>
        ) : active.length === 0 ? (
          <div className="py-10 text-center text-muted-foreground">暂无有效绿标</div>
        ) : (
          <div className="divide-y">
            {active.map(item => {
              const id = Number(item.id);
              const part = String(item.partNumber || item.recognizedPartNumber || "");
              return (
                <div key={id} className="flex flex-wrap items-start gap-4 px-4 py-3">
                  {item.photoUrl ? (
                    <a href={String(item.photoUrl)} target="_blank" rel="noreferrer" className="block h-24 w-24 overflow-hidden rounded border bg-muted">
                      <img src={String(item.photoUrl)} alt={part} className="h-full w-full object-cover" />
                    </a>
                  ) : <div className="h-24 w-24 rounded border bg-muted" />}
                  <div className="min-w-[180px] flex-1">
                    <div className="font-medium">{part}</div>
                    <div className="mt-1 text-xs text-muted-foreground">有效至 {item.expiresAt ? formatBeijingDateTimeWithSeconds(String(item.expiresAt)) : "—"}</div>
                  </div>
                  {canManage ? (
                    <Button size="sm" variant="outline" className="h-8 text-xs" disabled={busyId} onClick={() => cancelMutation.mutate({ merchantId, verificationId: id })}>
                      取消
                    </Button>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
