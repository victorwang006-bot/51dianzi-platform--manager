import { Skeleton } from "./ui/skeleton";

export function DashboardLayoutSkeleton() {
  return (
    <div
      className="min-h-screen min-w-0 bg-background"
      aria-busy="true"
      aria-label="正在加载后台"
    >
      <div className="border-b border-border bg-card">
        <div className="flex h-16 items-center gap-4 px-4 sm:px-6">
          <Skeleton className="h-9 w-9 shrink-0 rounded-md" />
          <Skeleton className="h-4 w-24" />
          <div className="ml-4 hidden items-center gap-6 sm:flex">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-4 w-24" />
          </div>
          <Skeleton className="ml-auto h-8 w-8 shrink-0 rounded-full" />
        </div>
        <div className="flex h-11 items-center gap-5 overflow-hidden border-t border-border px-4 sm:px-6">
          <Skeleton className="h-3 w-16 shrink-0" />
          <Skeleton className="h-3 w-20 shrink-0" />
          <Skeleton className="h-3 w-16 shrink-0" />
        </div>
      </div>
      <main className="min-w-0 space-y-4 p-4 sm:p-6">
        <Skeleton className="h-8 w-40 rounded-lg" />
        <Skeleton className="h-12 w-full rounded-lg" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </main>
    </div>
  );
}
