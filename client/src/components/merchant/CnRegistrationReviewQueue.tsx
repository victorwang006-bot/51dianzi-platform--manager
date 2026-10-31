import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { trpc } from "@/lib/trpc";
import { formatDateTime } from "@/components/admin/shared";

type CnRegistrationReviewQueueProps = {
  onOpenDetail: (merchantId: number) => void;
};

/**
 * Source contract: original patch/test assets define the existing CN queue as a
 * read-only list. The write action remains in CnRegistrationReviewDetail and
 * is independently limited by both `canReview` and merchants.write.
 */
export default function CnRegistrationReviewQueue({
  onOpenDetail,
}: CnRegistrationReviewQueueProps) {
  const queueQuery = trpc.merchant.listCnRegistrationReviewQueue.useQuery(
    { page: 1, pageSize: 100 },
    { staleTime: 0, refetchOnMount: "always", refetchOnWindowFocus: true },
  );
  const items = queueQuery.data?.items ?? [];
  const total = queueQuery.data?.total ?? items.length;

  if (queueQuery.isLoading) {
    return (
      <Card className="mb-4" data-cn-registration-review-queue>
        <CardContent className="space-y-2 py-4">
          <Skeleton className="h-5 w-28" />
          <Skeleton className="h-10 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (queueQuery.isError) {
    return (
      <Card className="mb-4" data-cn-registration-review-queue>
        <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
          <p role="alert" className="text-sm text-destructive">资料加载失败，请刷新后重试。</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={queueQuery.isFetching}
            onClick={() => void queueQuery.refetch()}
            data-review-refresh
          >
            {queueQuery.isFetching ? "刷新中…" : "刷新资料"}
          </Button>
        </CardContent>
      </Card>
    );
  }

  // The original queue intentionally disappears when there are no pending CN
  // candidates; it must not manufacture a review state from effective data.
  if (items.length === 0) return null;

  return (
    <Card className="mb-4" data-cn-registration-review-queue>
      <CardContent className="p-0">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold">待审企业</h2>
            <span className="text-xs text-muted-foreground">{total} 条待审</span>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={queueQuery.isFetching}
            onClick={() => void queueQuery.refetch()}
            data-review-refresh
          >
            {queueQuery.isFetching ? "刷新中…" : "刷新资料"}
          </Button>
        </div>
        <div className="divide-y">
          {items.map(item => (
            <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3" key={item.merchantId}>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{item.companyName || "—"}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {item.merchantNo || "—"}
                  {item.submittedAt ? ` · ${formatDateTime(item.submittedAt)}` : ""}
                </p>
              </div>
              <Button
                type="button"
                size="sm"
                onClick={() => onOpenDetail(item.merchantId)}
                data-cn-registration-review-open={item.merchantId}
              >
                审核操作
              </Button>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
