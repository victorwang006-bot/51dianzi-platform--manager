import {
  EmptyState,
  PageHeader,
  Pagination,
  StatusBadge,
  adminRoleMap,
  formatDateTime,
} from "@/components/admin/shared";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { trpc } from "@/lib/trpc";
import { ShieldCheck } from "lucide-react";
import { useState } from "react";

const roleDescriptions: { role: string; name: string; duties: string }[] = [
  { role: "super_admin", name: "超级管理员", duties: "全部权限，管理管理员账号与角色分配" },
  { role: "operation", name: "平台运营", duties: "数据看板、商品治理、订单处置、告警处理" },
  { role: "merchant_mgr", name: "商户管理", duties: "商户入驻审核、资质管理、协议与结算账户配置" },
  { role: "customer_svc", name: "客服/售后", duties: "订单查询、退款申请审核、异常标注" },
  { role: "risk_control", name: "风控审核", duties: "智能风控分析、风险处置、可疑行为审查" },
  { role: "finance", name: "财务结算", duties: "支付流水查询、结算单生成与打款、对账" },
  { role: "auditor", name: "审计人员", duties: "操作日志与敏感数据访问记录查阅（只读）" },
];

export default function Admins() {
  const [page, setPage] = useState(1);
  const { data, isLoading } = trpc.admin.list.useQuery({ page, pageSize: 20 });

  return (
    <DashboardLayout>
      <PageHeader
        title="权限管理"
        description="基于 RBAC 的角色权限控制，支持多角色管理员账户体系"
      />

      {/* 角色说明 */}
      <Card className="mb-6">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-primary" />
            角色与职责矩阵
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>角色</th>
                  <th>职责范围</th>
                </tr>
              </thead>
              <tbody>
                {roleDescriptions.map(r => (
                  <tr key={r.role}>
                    <td className="whitespace-nowrap">
                      <StatusBadge label={r.name} style={r.role === "super_admin" ? "danger" : "info"} />
                    </td>
                    <td className="text-xs text-muted-foreground">{r.duties}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* 管理员列表 */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">管理员账户</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6 space-y-3">
              {[1, 2, 3].map(i => <Skeleton key={i} className="h-12" />)}
            </div>
          ) : !data || data.data.length === 0 ? (
            <EmptyState message="暂无管理员账户记录。当前系统通过 Manus 账号登录，登录用户的角色可在数据库 users 表中配置。" />
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>姓名</th>
                      <th>角色</th>
                      <th>邮箱</th>
                      <th>状态</th>
                      <th>最近登录</th>
                      <th>创建时间</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.data.map(a => (
                      <tr key={a.id}>
                        <td className="font-medium">{a.displayName ?? a.username}</td>
                        <td>
                          <StatusBadge
                            label={adminRoleMap[a.adminRole] ?? a.adminRole}
                            style={a.adminRole === "super_admin" ? "danger" : "info"}
                          />
                        </td>
                        <td className="text-xs">{a.email ?? "-"}</td>
                        <td>
                          <StatusBadge
                            label={a.status === "active" ? "启用" : "停用"}
                            style={a.status === "active" ? "success" : "gray"}
                          />
                        </td>
                        <td className="text-xs text-muted-foreground">{formatDateTime(a.lastLoginAt)}</td>
                        <td className="text-xs text-muted-foreground">{formatDateTime(a.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pagination page={page} pageSize={20} total={data.total} onPageChange={setPage} />
            </>
          )}
        </CardContent>
      </Card>
    </DashboardLayout>
  );
}
