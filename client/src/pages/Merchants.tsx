import {
  EmptyState,
  PageHeader,
  Pagination,
  StatusBadge,
  agreementStatusMap,
  formatDateTime,
  merchantStatusMap,
} from "@/components/admin/shared";
import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Search } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Link } from "wouter";

type ReviewAction = "approve" | "supplement" | "suspend" | "reactivate";

const actionLabels: Record<ReviewAction, string> = {
  approve: "审核通过",
  supplement: "要求补件",
  suspend: "暂停商户",
  reactivate: "恢复商户",
};

type CrmStatus = "none" | "pending" | "enabled" | "disabled" | "rejected";

const crmStatusMap: Record<CrmStatus, { label: string; style: "success" | "warning" | "danger" | "info" | "gray" }> = {
  none: { label: "未申请", style: "gray" },
  pending: { label: "待开通", style: "warning" },
  enabled: { label: "已开通", style: "success" },
  disabled: { label: "已暂停", style: "danger" },
  rejected: { label: "已拒绝", style: "gray" },
};

const crmActionLabels: Record<string, string> = {
  enabled: "通过（开通 ERP）",
  disabled: "暂停 ERP",
  rejected: "拒绝申请",
};

export default function Merchants() {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [reviewTarget, setReviewTarget] = useState<{ id: number; name: string; action: ReviewAction } | null>(null);
  const [reviewNote, setReviewNote] = useState("");
  const [crmTarget, setCrmTarget] = useState<{
    id: number;
    name: string;
    nextStatus: "enabled" | "disabled" | "rejected";
    currentStatus: CrmStatus;
    currentOwner: string;
  } | null>(null);
  const [crmPortalUserId, setCrmPortalUserId] = useState("");
  const [crmNote, setCrmNote] = useState("");
  const [rebindTarget, setRebindTarget] = useState<{
    id: number;
    name: string;
    currentOwner: string;
    requestId: string;
  } | null>(null);
  const [rebindPortalUserId, setRebindPortalUserId] = useState("");
  const [rebindReason, setRebindReason] = useState("");
  const [msgTarget, setMsgTarget] = useState<{ id: number; name: string } | null>(null);
  const [msgContent, setMsgContent] = useState("");
  const [detailId, setDetailId] = useState<number | null>(null);

  const { user } = useAuth();
  const isSuperAdmin = (user?.adminRole ?? "super_admin") === "super_admin";
  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.merchant.list.useQuery({
    page,
    pageSize: 20,
    status: status === "all" ? undefined : status,
    search: search || undefined,
  });
  const { data: detail } = trpc.merchant.detail.useQuery(
    { id: detailId ?? 0 },
    { enabled: detailId !== null },
  );

  const reviewMutation = trpc.merchant.review.useMutation({
    onSuccess: () => {
      toast.success("操作成功");
      utils.merchant.list.invalidate();
      setReviewTarget(null);
      setReviewNote("");
    },
    onError: err => toast.error(`操作失败：${err.message}`),
  });

  const crmMutation = trpc.merchant.setCrmStatus.useMutation({
    onSuccess: (_d, vars) => {
      toast.success(
        vars.crmStatus === "enabled" && crmTarget?.currentStatus === "disabled" ? "ERP 已恢复"
          : vars.crmStatus === "enabled" ? "已绑定前台用户并开通 ERP"
          : vars.crmStatus === "rejected" ? "已拒绝该申请"
          : "ERP 已暂停",
      );
      utils.merchant.list.invalidate();
      setCrmTarget(null);
      setCrmPortalUserId("");
      setCrmNote("");
    },
    onError: err => toast.error(`操作失败：${err.message}`),
  });

  const rebindMutation = trpc.merchant.rebindCrmOwner.useMutation({
    onSuccess: data => {
      toast.success(data.idempotent ? "该换绑请求已处理" : "ERP 超级管理员已换绑");
      utils.merchant.list.invalidate();
      setRebindTarget(null);
      setRebindPortalUserId("");
      setRebindReason("");
    },
    onError: err => toast.error(`换绑失败：${err.message}`),
  });

  const sendMsgMutation = trpc.merchant.sendMessage.useMutation({
    onSuccess: () => {
      toast.success("消息已发送，客户前台联系客服将显示红点提醒");
      setMsgTarget(null);
      setMsgContent("");
    },
    onError: err => toast.error(`发送失败：${err.message}`),
  });

  const doSearch = () => {
    setSearch(searchInput);
    setPage(1);
  };

  return (
    <DashboardLayout>
      <PageHeader title="商户管理" description="商户入驻审核、资质管理、协议状态与结算账户配置" />

      {/* 筛选栏 */}
      <Card className="mb-4">
        <CardContent className="py-4 flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 flex-1 min-w-[240px]">
            <Input
              placeholder="搜索公司名称 / 商户编号"
              value={searchInput}
              onChange={e => setSearchInput(e.target.value)}
              onKeyDown={e => e.key === "Enter" && doSearch()}
              className="max-w-xs"
            />
            <Button variant="outline" size="sm" onClick={doSearch}>
              <Search className="h-4 w-4 mr-1" />
              搜索
            </Button>
          </div>
          <Select value={status} onValueChange={v => { setStatus(v); setPage(1); }}>
            <SelectTrigger className="w-[140px]">
              <SelectValue placeholder="全部状态" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部状态</SelectItem>
              <SelectItem value="pending">待审核</SelectItem>
              <SelectItem value="supplement">待补件</SelectItem>
              <SelectItem value="approved">已入驻</SelectItem>
              <SelectItem value="suspended">已暂停</SelectItem>
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {/* 列表 */}
      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6 space-y-3">
              {[1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="h-12" />)}
            </div>
          ) : !data || data.data.length === 0 ? (
            <EmptyState message="暂无商户数据" />
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>商户编号</th>
                      <th>公司名称</th>
                      <th>联系人</th>
                      <th>销售负责人</th>
                      <th>状态</th>
                      <th>ERP</th>
                      <th>协议</th>
                      <th>资质到期</th>
                      <th>入驻时间</th>
                      <th>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.data.map(m => {
                      const st = merchantStatusMap[m.status] ?? { label: m.status, style: "gray" as const };
                      const ag = agreementStatusMap[m.agreementStatus] ?? { label: m.agreementStatus, style: "gray" as const };
                      const crmStatus = ((m as { crmStatus?: CrmStatus }).crmStatus ?? "none") as CrmStatus;
                      const crmOwnerPortalUserId = ((m as { crmOwnerPortalUserId?: string | null }).crmOwnerPortalUserId ?? "").trim();
                      const crmActuallyEnabled = crmStatus === "enabled" && Boolean(crmOwnerPortalUserId);
                      const crm = crmStatus === "enabled" && !crmActuallyEnabled
                        ? { label: "待绑定账号", style: "warning" as const }
                        : (crmStatusMap[crmStatus] ?? crmStatusMap.none);
                      const licenseExpiringSoon = m.licenseExpiry && new Date(m.licenseExpiry).getTime() - Date.now() < 30 * 86400_000;
                      return (
                        <tr key={m.id}>
                          <td className="font-mono text-xs">{m.merchantNo}</td>
                          <td className="max-w-[220px]">
                            <Link href={`/merchants/${m.id}`} className="text-primary hover:underline text-left truncate block max-w-full">
                              {m.companyName}
                            </Link>
                          </td>
                          <td>
                            <div className="text-xs">
                              <p>{m.contactName ?? "-"}</p>
                              <p className="text-muted-foreground">{m.contactPhone ?? ""}</p>
                            </div>
                          </td>
                          <td className="text-xs">{(m as { salesOwner?: string | null }).salesOwner ?? "-"}</td>
                          <td><StatusBadge label={st.label} style={st.style} /></td>
                          <td>
                            <StatusBadge label={crm.label} style={crm.style} />
                            {crmOwnerPortalUserId ? (
                              <p className="mt-1 text-[11px] text-muted-foreground font-mono">用户 {crmOwnerPortalUserId}</p>
                            ) : crmStatus === "enabled" ? (
                              <p className="mt-1 text-[11px] text-amber-700">尚未绑定前台用户</p>
                            ) : null}
                          </td>
                          <td><StatusBadge label={ag.label} style={ag.style} /></td>
                          <td className={`text-xs ${licenseExpiringSoon ? "text-red-600 font-medium" : "text-muted-foreground"}`}>
                            {m.licenseExpiry ? formatDateTime(m.licenseExpiry).split(" ")[0] : "-"}
                          </td>
                          <td className="text-xs text-muted-foreground">{formatDateTime(m.createdAt)}</td>
                          <td>
                            <div className="flex items-center gap-1 flex-wrap">
                              {crmActuallyEnabled ? (
                                /* 已开通客户：只有「暂停」 */
                                <Button size="sm" variant="outline" className="h-7 text-xs text-red-600 border-red-200 hover:bg-red-50 hover:text-red-700" onClick={() => {
                                  setCrmPortalUserId(crmOwnerPortalUserId);
                                  setCrmTarget({ id: m.id, name: m.companyName, nextStatus: "disabled", currentStatus: crmStatus, currentOwner: crmOwnerPortalUserId });
                                }}>
                                  暂停
                                </Button>
                              ) : (
                                /* 未开通 / 待开通 / 已暂停 / 已拒绝：通过 / 发信 / 拒绝 */
                                <>
                                  <Button size="sm" variant="default" className="h-7 text-xs" onClick={() => {
                                    setCrmPortalUserId(crmOwnerPortalUserId);
                                    setCrmTarget({ id: m.id, name: m.companyName, nextStatus: "enabled", currentStatus: crmStatus, currentOwner: crmOwnerPortalUserId });
                                  }}>
                                    {crmStatus === "enabled" ? "绑定账号" : "通过"}
                                  </Button>
                                  <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setMsgTarget({ id: m.id, name: m.companyName })}>
                                    发信
                                  </Button>
                                  <Button size="sm" variant="outline" className="h-7 text-xs text-red-600 border-red-200 hover:bg-red-50 hover:text-red-700" onClick={() => {
                                    setCrmPortalUserId(crmOwnerPortalUserId);
                                    setCrmTarget({ id: m.id, name: m.companyName, nextStatus: "rejected", currentStatus: crmStatus, currentOwner: crmOwnerPortalUserId });
                                  }}>
                                    拒绝
                                  </Button>
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <Pagination page={page} pageSize={20} total={data.total} onPageChange={setPage} />
            </>
          )}
        </CardContent>
      </Card>

      {/* 审核对话框 */}
      <Dialog open={reviewTarget !== null} onOpenChange={open => !open && setReviewTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{reviewTarget ? actionLabels[reviewTarget.action] : ""}</DialogTitle>
            <DialogDescription>
              目标商户：{reviewTarget?.name}。此操作将被记录到审计日志。
            </DialogDescription>
          </DialogHeader>
          <Textarea
            placeholder="请填写操作理由 / 备注（必填）"
            value={reviewNote}
            onChange={e => setReviewNote(e.target.value)}
            rows={3}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setReviewTarget(null)}>取消</Button>
            <Button
              disabled={reviewMutation.isPending || !reviewNote.trim()}
              onClick={() => {
                if (!reviewTarget) return;
                reviewMutation.mutate({ id: reviewTarget.id, action: reviewTarget.action, note: reviewNote.trim() });
              }}
            >
              确认{reviewTarget ? actionLabels[reviewTarget.action] : ""}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ERP 通过/拒绝/暂停对话框 */}
      <Dialog open={crmTarget !== null} onOpenChange={open => {
        if (!open) {
          setCrmTarget(null);
          setCrmPortalUserId("");
          setCrmNote("");
        }
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{crmTarget ? crmActionLabels[crmTarget.nextStatus] : ""}</DialogTitle>
            <DialogDescription>
              目标商户：{crmTarget?.name}。
              {crmTarget?.nextStatus === "enabled" && "通过后仅绑定的前台账号可以进入并使用 ERP 系统。"}
              {crmTarget?.nextStatus === "disabled" && "暂停后该商户将无法进入 ERP 页面，前台会提示：您的ERP权限已经被暂停，请联系客服。"}
              {crmTarget?.nextStatus === "rejected" && "拒绝后该商户的 ERP 开通申请将被驳回，可通过「发信」告知客户原因。"}
            </DialogDescription>
          </DialogHeader>
          {crmTarget?.nextStatus === "enabled" && (
            <div className="space-y-2">
              <label htmlFor="crm-portal-user-id" className="text-sm font-medium">前台用户 ID</label>
              <Input
                id="crm-portal-user-id"
                value={crmPortalUserId}
                onChange={e => setCrmPortalUserId(e.target.value)}
                placeholder="请输入要开通 ERP 的前台用户 ID"
                disabled={Boolean(crmTarget.currentOwner)}
              />
              <p className="text-xs text-muted-foreground">
                {crmTarget.currentOwner
                  ? "该商户已有绑定账号；开通操作不会更换绑定。如需换绑，请先核验企业授权关系。"
                  : "一个商户只能绑定一个前台账号，请与用户提交申请时的账号核对后再确认。"}
              </p>
            </div>
          )}
          <Textarea
            placeholder="备注（选填，如通过/拒绝/暂停原因）"
            value={crmNote}
            onChange={e => setCrmNote(e.target.value)}
            rows={3}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setCrmTarget(null)}>取消</Button>
            <Button
              disabled={crmMutation.isPending || (crmTarget?.nextStatus === "enabled" && !crmPortalUserId.trim())}
              variant={crmTarget?.nextStatus === "enabled" ? "default" : "destructive"}
              onClick={() => {
                if (!crmTarget) return;
                crmMutation.mutate({
                  id: crmTarget.id,
                  crmStatus: crmTarget.nextStatus,
                  portalUserId: crmTarget.nextStatus === "enabled" ? crmPortalUserId.trim() : undefined,
                  note: crmNote.trim() || undefined,
                });
              }}
            >
              确认{crmTarget ? crmActionLabels[crmTarget.nextStatus] : ""}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 发信对话框：发送消息到客户前台"联系客服" */}
      <Dialog open={msgTarget !== null} onOpenChange={open => { if (!open) { setMsgTarget(null); setMsgContent(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>发信给客户</DialogTitle>
            <DialogDescription>
              目标商户：{msgTarget?.name}。消息将推送到客户前台"联系客服"，客户端将显示红色信息提示图标。
            </DialogDescription>
          </DialogHeader>
          <Textarea
            placeholder="请输入要发送给客户的消息内容，例如：您的ERP开通申请材料不完整，请补充营业执照扫描件…"
            value={msgContent}
            onChange={e => setMsgContent(e.target.value)}
            rows={5}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => { setMsgTarget(null); setMsgContent(""); }}>取消</Button>
            <Button
              disabled={sendMsgMutation.isPending || !msgContent.trim()}
              onClick={() => {
                if (!msgTarget) return;
                sendMsgMutation.mutate({ id: msgTarget.id, content: msgContent.trim() });
              }}
            >
              发送
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 商户详情 */}
      <Dialog open={detailId !== null} onOpenChange={open => !open && setDetailId(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>商户详情</DialogTitle>
          </DialogHeader>
          {detail ? (
            <div className="space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <div><p className="text-xs text-muted-foreground">商户编号</p><p className="font-mono">{detail.merchantNo}</p></div>
                <div><p className="text-xs text-muted-foreground">公司名称</p><p>{detail.companyName}</p></div>
                <div><p className="text-xs text-muted-foreground">联系人</p><p>{detail.contactName ?? "-"}</p></div>
                <div><p className="text-xs text-muted-foreground">联系电话</p><p>{detail.contactPhone ?? "-"}</p></div>
                <div><p className="text-xs text-muted-foreground">邮箱</p><p>{detail.contactEmail ?? "-"}</p></div>
                <div><p className="text-xs text-muted-foreground">营业执照号</p><p className="font-mono">{detail.businessLicense ?? "-"}</p></div>
                <div><p className="text-xs text-muted-foreground">资质到期日</p><p>{detail.licenseExpiry ? formatDateTime(detail.licenseExpiry).split(" ")[0] : "-"}</p></div>
              </div>
              <div className="border-t pt-3">
                <p className="text-xs text-muted-foreground mb-2">结算账户</p>
                <div className="grid grid-cols-2 gap-3">
                  <div><p className="text-xs text-muted-foreground">开户行</p><p>{detail.settlementBank ?? "-"}</p></div>
                  <div><p className="text-xs text-muted-foreground">账户名</p><p>{detail.settlementAccountName ?? "-"}</p></div>
                  <div className="col-span-2"><p className="text-xs text-muted-foreground">账号</p><p className="font-mono">{detail.settlementAccount ?? "-"}</p></div>
                </div>
              </div>
              {detail.reviewNote && (
                <div className="border-t pt-3">
                  <p className="text-xs text-muted-foreground">最近审核备注</p>
                  <p className="mt-1">{detail.reviewNote}</p>
                </div>
              )}
            </div>
          ) : (
            <Skeleton className="h-48" />
          )}
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
