import { useEffect, useState } from "react";
import {
  BriefcaseBusiness,
  Copy,
  ExternalLink,
  Flag,
  Loader2,
  PackageSearch,
  Search,
  ShieldOff,
  ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";
import UserAvatar from "./UserAvatar";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Input } from "./ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "./ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";
import { openInNewTab } from "../lib/openInNewTab";
import { trpc } from "../../../../api/business-trpc";
import { formatBeijingRelativeTime } from "../../../shared/beijingTime";

export type ContactProfileTarget = {
  conversationId: number;
  contactUserId: number;
  name: string;
  avatarUrl?: string | null;
  companySupplierId?: number | null;
};

export type ContactBlockState = {
  conversationId: number;
  blockedByMe: boolean;
  blockedByContact: boolean;
};

type ContactInventoryItem = {
  id: number;
  partNumber: string;
  brand: string;
  category: string;
  package: string | null;
  dateCode: string | null;
  productionYear: string | null;
  quantity: number;
  price: number | null;
  taxIncluded: boolean;
  moq: number | null;
  leadTime: string | null;
  invoice: boolean;
  imageUrl: string | null;
  publishedAt: Date | string | null;
  refreshedAt: Date | string | null;
};

const REPORT_REASONS = [
  { value: "fraud", label: "涉嫌欺诈" },
  { value: "harassment", label: "骚扰信息" },
  { value: "false_inventory", label: "虚假库存" },
  { value: "illegal", label: "违法违规" },
  { value: "other", label: "其他问题" },
] as const;

type ReportReason = (typeof REPORT_REASONS)[number]["value"];

function formatPrice(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "询价";
  return `¥${value.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;
}

async function copyText(value: string, label: string) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
    } else {
      const textarea = document.createElement("textarea");
      textarea.value = value;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      textarea.remove();
    }
    toast.success(`${label}已复制`);
  } catch {
    toast.error(`${label}复制失败，请手动复制`);
  }
}

function ContactRow({
  label,
  value,
}: {
  label: string;
  value: string | null | undefined;
}) {
  return (
    <div className="flex items-center gap-3 border-b border-gray-100 py-3 last:border-b-0">
      <div className="w-16 shrink-0 text-xs text-gray-500">{label}</div>
      <div
        className={`min-w-0 flex-1 break-all text-sm ${value ? "text-gray-900" : "text-gray-400"}`}
      >
        {value || "未填写"}
      </div>
      {value && (
        <button
          type="button"
          onClick={() => void copyText(value, label)}
          className="inline-flex h-8 items-center gap-1 rounded-md border border-gray-200 px-2 text-xs text-gray-600 hover:border-[#b9d1e8] hover:bg-[#f1f7fc] hover:text-[#185FA5]"
          aria-label={`复制${label}`}
        >
          <Copy className="h-3.5 w-3.5" />
          复制
        </button>
      )}
    </div>
  );
}

export default function ContactProfileSheet({
  target,
  open,
  onOpenChange,
  onBlockStateChange,
}: {
  target: ContactProfileTarget | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onBlockStateChange?: (state: ContactBlockState) => void;
}) {
  const utils = trpc.useUtils();
  const [tab, setTab] = useState<"profile" | "inventory">("profile");
  const [searchInput, setSearchInput] = useState("");
  const [inventoryKeyword, setInventoryKeyword] = useState("");
  const [inventoryPage, setInventoryPage] = useState(1);
  const [inventoryItems, setInventoryItems] = useState<ContactInventoryItem[]>(
    []
  );
  const [reportOpen, setReportOpen] = useState(false);
  const [reportReason, setReportReason] = useState<ReportReason>("fraud");
  const [reportDetail, setReportDetail] = useState("");

  const conversationId = target?.conversationId ?? 0;
  const contactUserId = target?.contactUserId ?? 0;
  const queryEnabled = open && conversationId > 0 && contactUserId > 0;

  const profileQuery = trpc.chat.contactProfile.useQuery(
    { conversationId, contactUserId },
    { enabled: queryEnabled, staleTime: 30_000 }
  );
  const inventoryQuery = trpc.chat.contactInventory.useQuery(
    {
      conversationId,
      contactUserId,
      page: inventoryPage,
      pageSize: 20,
      keyword: inventoryKeyword || undefined,
    },
    { enabled: queryEnabled && tab === "inventory" }
  );

  const blockContact = trpc.chat.blockContact.useMutation();
  const unblockContact = trpc.chat.unblockContact.useMutation();
  const reportContact = trpc.chat.reportContact.useMutation();

  useEffect(() => {
    if (!open) return;
    setTab("profile");
    setSearchInput("");
    setInventoryKeyword("");
    setInventoryPage(1);
    setInventoryItems([]);
    setReportOpen(false);
    setReportReason("fraud");
    setReportDetail("");
  }, [open, conversationId, contactUserId]);

  useEffect(() => {
    const result = inventoryQuery.data;
    if (!result) return;
    const next: ContactInventoryItem[] = result.items;
    setInventoryItems(previous => {
      if (result.page === 1) return next;
      const existing = new Set(previous.map(item => item.id));
      return [...previous, ...next.filter(item => !existing.has(item.id))];
    });
  }, [inventoryQuery.data]);

  useEffect(() => {
    const blockState = profileQuery.data?.blockState;
    if (!blockState || !conversationId) return;
    onBlockStateChange?.({ conversationId, ...blockState });
  }, [conversationId, onBlockStateChange, profileQuery.data?.blockState]);

  const profile = profileQuery.data;
  const blockState = profile?.blockState ?? {
    blockedByMe: false,
    blockedByContact: false,
  };
  const isBlocked = blockState.blockedByMe || blockState.blockedByContact;
  const inventoryTotal =
    inventoryQuery.data?.total ?? profile?.inventoryCount ?? 0;
  const hasMore = Boolean(
    inventoryQuery.data &&
      inventoryQuery.data.page < inventoryQuery.data.totalPages
  );
  const safetyBusy =
    blockContact.isPending ||
    unblockContact.isPending ||
    reportContact.isPending;

  const submitInventorySearch = () => {
    setInventoryItems([]);
    setInventoryPage(1);
    setInventoryKeyword(searchInput.trim());
  };

  const handleToggleBlock = async () => {
    if (!target || safetyBusy) return;
    const shouldUnblock = blockState.blockedByMe;
    const confirmed = window.confirm(
      shouldUnblock
        ? "解除后双方可以继续发送消息，确定解除屏蔽吗？"
        : "屏蔽后双方均不能继续发送消息，该会话也会从你的列表中隐藏。确定屏蔽吗？"
    );
    if (!confirmed) return;
    try {
      const input = { conversationId, contactUserId };
      if (shouldUnblock) await unblockContact.mutateAsync(input);
      else await blockContact.mutateAsync(input);
      const next = {
        conversationId,
        blockedByMe: !shouldUnblock,
        blockedByContact: blockState.blockedByContact,
      };
      onBlockStateChange?.(next);
      await profileQuery.refetch();
      void utils.chat.listConversations.invalidate();
      toast.success(shouldUnblock ? "已解除屏蔽" : "已屏蔽对方");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "操作失败，请稍后重试"
      );
    }
  };

  const handleReport = async () => {
    if (!target || safetyBusy) return;
    try {
      await reportContact.mutateAsync({
        conversationId,
        contactUserId,
        reason: reportReason,
        detail: reportDetail.trim() || undefined,
      });
      setReportOpen(false);
      setReportDetail("");
      toast.success("举报已提交");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "举报失败，请稍后重试"
      );
    }
  };

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="right"
          className="w-full gap-0 overflow-hidden p-0 sm:max-w-[420px]"
          data-testid="contact-profile-sheet"
        >
          <SheetHeader className="border-b border-gray-100 px-5 py-4 pr-12">
            <SheetTitle>联系人资料</SheetTitle>
            <SheetDescription>
              仅聊天双方可查看对方主动公开的联系信息
            </SheetDescription>
          </SheetHeader>

          <div className="min-h-0 flex-1 overflow-y-auto bg-[#f6f8fb]">
            {profileQuery.isLoading ? (
              <div className="flex h-56 items-center justify-center gap-2 text-sm text-gray-500">
                <Loader2 className="h-4 w-4 animate-spin" />
                正在加载联系人资料…
              </div>
            ) : profileQuery.isError || !profile ? (
              <div className="flex h-64 flex-col items-center justify-center gap-3 px-6 text-center">
                <div className="text-sm font-medium text-gray-800">
                  资料暂不可查看
                </div>
                <div className="text-xs text-gray-500">
                  {profileQuery.error?.message || "联系人资料不存在"}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void profileQuery.refetch()}
                >
                  重新加载
                </Button>
              </div>
            ) : (
              <>
                <div className="border-b border-gray-100 bg-white px-5 py-5">
                  <div className="flex items-center gap-4">
                    <UserAvatar
                      avatarUrl={profile.contact.avatarUrl || target?.avatarUrl}
                      name={profile.contact.name}
                      userId={profile.contact.userId}
                      className="h-16 w-16 rounded-2xl text-xl"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-lg font-semibold text-gray-950">
                        {profile.contact.name}
                      </div>
                      {profile.company?.name && (
                        <div className="mt-1 truncate text-sm text-gray-700">
                          {profile.company.name}
                        </div>
                      )}
                      {profile.contact.jobTitle && (
                        <div className="mt-1 flex items-center gap-1 text-xs text-gray-500">
                          <BriefcaseBusiness className="h-3.5 w-3.5" />
                          {profile.contact.jobTitle}
                        </div>
                      )}
                    </div>
                    <div className="rounded-full bg-[#eef5fb] px-2.5 py-1 text-xs font-medium text-[#185FA5]">
                      在售 {profile.inventoryCount}
                    </div>
                  </div>
                </div>

                <Tabs
                  value={tab}
                  onValueChange={value =>
                    setTab(value as "profile" | "inventory")
                  }
                  className="gap-0"
                >
                  <div className="sticky top-0 z-10 border-b border-gray-100 bg-white px-5 py-2.5">
                    <TabsList className="grid w-full grid-cols-2">
                      <TabsTrigger value="profile">资料</TabsTrigger>
                      <TabsTrigger value="inventory">
                        在售库存 {profile.inventoryCount}
                      </TabsTrigger>
                    </TabsList>
                  </div>

                  <TabsContent value="profile" className="m-0 space-y-3 p-4">
                    <section className="rounded-xl border border-gray-100 bg-white px-4 shadow-sm">
                      <div className="border-b border-gray-100 py-3 text-sm font-semibold text-gray-900">
                        联系方式
                      </div>
                      <ContactRow
                        label="手机号"
                        value={profile.contact.phone}
                      />
                      <ContactRow
                        label="微信号"
                        value={profile.contact.wechatId}
                      />
                    </section>

                    <section className="rounded-xl border border-gray-100 bg-white px-4 shadow-sm">
                      <div className="border-b border-gray-100 py-3 text-sm font-semibold text-gray-900">
                        会话安全
                      </div>
                      {isBlocked && (
                        <div className="my-3 rounded-lg bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800">
                          {blockState.blockedByMe
                            ? "你已屏蔽对方，双方暂不能发送消息。"
                            : "对方已屏蔽此会话，双方暂不能发送消息。"}
                        </div>
                      )}
                      <div className="flex gap-2 py-3">
                        <Button
                          variant="outline"
                          className="flex-1"
                          onClick={() => setReportOpen(true)}
                          disabled={safetyBusy}
                        >
                          <Flag className="h-4 w-4" />
                          举报
                        </Button>
                        <Button
                          variant="outline"
                          className={
                            blockState.blockedByMe
                              ? "flex-1 text-[#185FA5]"
                              : "flex-1 text-red-600 hover:bg-red-50 hover:text-red-700"
                          }
                          onClick={() => void handleToggleBlock()}
                          disabled={safetyBusy || blockState.blockedByContact}
                        >
                          {blockState.blockedByMe ? (
                            <ShieldCheck className="h-4 w-4" />
                          ) : (
                            <ShieldOff className="h-4 w-4" />
                          )}
                          {blockState.blockedByMe ? "解除屏蔽" : "屏蔽对方"}
                        </Button>
                      </div>
                    </section>
                  </TabsContent>

                  <TabsContent value="inventory" className="m-0 p-4">
                    <form
                      className="mb-3 flex gap-2"
                      onSubmit={event => {
                        event.preventDefault();
                        submitInventorySearch();
                      }}
                    >
                      <div className="relative flex-1">
                        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                        <Input
                          value={searchInput}
                          onChange={event => setSearchInput(event.target.value)}
                          placeholder="搜索型号、品牌、封装"
                          className="pl-9"
                        />
                      </div>
                      <Button type="submit" variant="outline">
                        搜索
                      </Button>
                    </form>

                    {inventoryQuery.isLoading && inventoryPage === 1 ? (
                      <div className="flex h-40 items-center justify-center gap-2 text-sm text-gray-500">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        正在加载在售库存…
                      </div>
                    ) : inventoryQuery.isError ? (
                      <div className="rounded-xl border border-red-100 bg-white p-5 text-center">
                        <div className="text-sm text-red-600">
                          {inventoryQuery.error.message || "库存加载失败"}
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          className="mt-3"
                          onClick={() => void inventoryQuery.refetch()}
                        >
                          重新加载
                        </Button>
                      </div>
                    ) : inventoryItems.length === 0 ? (
                      <div className="flex h-40 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-gray-200 bg-white text-gray-400">
                        <PackageSearch className="h-7 w-7" />
                        <span className="text-sm">
                          {inventoryKeyword
                            ? "没有匹配的在售库存"
                            : "暂无公开在售库存"}
                        </span>
                      </div>
                    ) : (
                      <div className="space-y-2.5">
                        <div className="text-xs text-gray-500">
                          共 {inventoryTotal} 条
                        </div>
                        {inventoryItems.map(item => (
                          <button
                            key={item.id}
                            type="button"
                            onClick={() => openInNewTab(`/product/${item.id}`)}
                            className="flex w-full gap-3 rounded-xl border border-gray-100 bg-white p-3 text-left shadow-sm transition hover:border-[#9fc2e1] hover:shadow"
                          >
                            {item.imageUrl ? (
                              <img
                                src={item.imageUrl}
                                alt=""
                                className="h-14 w-14 shrink-0 rounded-lg border border-gray-100 object-cover"
                                loading="lazy"
                              />
                            ) : (
                              <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-[#eef5fb] text-sm font-semibold text-[#185FA5]">
                                {item.partNumber.slice(0, 1)}
                              </div>
                            )}
                            <div className="min-w-0 flex-1">
                              <div className="flex items-start justify-between gap-2">
                                <span className="break-all text-sm font-semibold text-gray-950">
                                  {item.partNumber}
                                </span>
                                <ExternalLink className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gray-400" />
                              </div>
                              <div className="mt-1 flex flex-wrap gap-1 text-[11px] text-gray-500">
                                {item.brand && (
                                  <span className="rounded bg-gray-100 px-1.5 py-0.5">
                                    {item.brand}
                                  </span>
                                )}
                                {item.package && (
                                  <span className="rounded bg-gray-100 px-1.5 py-0.5">
                                    {item.package}
                                  </span>
                                )}
                                {item.dateCode && (
                                  <span className="rounded bg-gray-100 px-1.5 py-0.5">
                                    批号 {item.dateCode}
                                  </span>
                                )}
                              </div>
                              <div className="mt-2 flex items-center justify-between gap-2 text-xs">
                                <span className="text-gray-600">
                                  在售 {item.quantity.toLocaleString("zh-CN")}
                                </span>
                                <span
                                  className={
                                    item.price === null
                                      ? "text-gray-500"
                                      : "font-semibold text-[#d85b12]"
                                  }
                                >
                                  {formatPrice(item.price)}
                                  {item.price !== null && (
                                    <small className="ml-1 font-normal text-gray-400">
                                      {item.taxIncluded ? "含税" : "未税"}
                                    </small>
                                  )}
                                </span>
                              </div>
                              {(item.refreshedAt || item.publishedAt) && (
                                <div className="mt-1 text-[10px] text-gray-400">
                                  更新{" "}
                                  {formatBeijingRelativeTime(
                                    item.refreshedAt || item.publishedAt!
                                  )}
                                </div>
                              )}
                            </div>
                          </button>
                        ))}
                        {hasMore && (
                          <Button
                            variant="outline"
                            className="w-full"
                            onClick={() => setInventoryPage(page => page + 1)}
                            disabled={inventoryQuery.isFetching}
                          >
                            {inventoryQuery.isFetching ? (
                              <>
                                <Loader2 className="h-4 w-4 animate-spin" />
                                加载中…
                              </>
                            ) : (
                              "加载更多"
                            )}
                          </Button>
                        )}
                      </div>
                    )}
                  </TabsContent>
                </Tabs>
              </>
            )}
          </div>
        </SheetContent>
      </Sheet>

      <Dialog open={reportOpen} onOpenChange={setReportOpen}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>举报联系人</DialogTitle>
            <DialogDescription>
              请选择最符合实际情况的原因。平台会结合会话记录进行核查。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              {REPORT_REASONS.map(reason => (
                <button
                  key={reason.value}
                  type="button"
                  onClick={() => setReportReason(reason.value)}
                  className={`rounded-lg border px-3 py-2 text-left text-sm ${reportReason === reason.value ? "border-[#185FA5] bg-[#eef5fb] text-[#185FA5]" : "border-gray-200 text-gray-700 hover:bg-gray-50"}`}
                >
                  {reason.label}
                </button>
              ))}
            </div>
            <textarea
              value={reportDetail}
              onChange={event =>
                setReportDetail(event.target.value.slice(0, 300))
              }
              placeholder="可补充说明（选填，最多300字）"
              className="min-h-24 w-full resize-none rounded-lg border border-gray-200 p-3 text-sm outline-none focus:border-[#185FA5] focus:ring-2 focus:ring-[#185FA5]/10"
            />
            <div className="text-right text-xs text-gray-400">
              {reportDetail.length}/300
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setReportOpen(false)}
              disabled={reportContact.isPending}
            >
              取消
            </Button>
            <Button
              onClick={() => void handleReport()}
              disabled={reportContact.isPending}
            >
              {reportContact.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  提交中…
                </>
              ) : (
                "提交举报"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
