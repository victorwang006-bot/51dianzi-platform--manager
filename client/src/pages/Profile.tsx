import { useAuth } from "@/_core/hooks/useAuth";
import { installAuthSessionClearListener } from "@/business/platform/client/src/lib/authSessionEvents";
import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { trpc } from "@/lib/trpc";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BadgeCheck, KeyRound, Loader2, Phone, RefreshCw, Save } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { useLocation } from "wouter";
import {
  currentShanghaiMonth,
  decimalAmount,
  messageOf,
  normalizeMainlandPhone,
  passwordError,
  personalCenterIdentity,
  personalCenterQueryPrefix,
  presentValue,
  roleLabel,
  validMonth,
} from "./profileModel";
import "./Profile.css";

const TABS = [
  { key: "profile", label: "个人资料" },
  { key: "security", label: "账号安全" },
  { key: "performance", label: "我的业绩" },
  { key: "commission", label: "我的提成" },
] as const;
type Tab = (typeof TABS)[number]["key"];
const EMPTY_PASSWORD = { oldPassword: "", newPassword: "", confirmPassword: "" };
const EMPTY_PHONE = { oldPassword: "", phone: "", code: "" };

function sourcedField(record: object, field: string): string {
  const value: unknown = Reflect.get(record, field);
  return presentValue(typeof value === "string" ? value : null);
}

function LoadingPanel() {
  return <div className="pc-loading" role="status" aria-label="正在加载个人中心">
    <Skeleton className="h-8 w-40" />
    <Skeleton className="h-24 w-full" />
    <Skeleton className="h-24 w-full" />
  </div>;
}

function Failure({ error, retry, pending = false }: { error: unknown; retry(): void; pending?: boolean }) {
  return <div className="pc-state pc-state--error" role="alert">
    <span>{messageOf(error)}</span>
    <Button size="sm" variant="outline" disabled={pending} onClick={retry}>
      <RefreshCw className={pending ? "animate-spin" : undefined} />重试
    </Button>
  </div>;
}

export default function Profile() {
  const auth = useAuth();
  const refreshRef = useRef(auth.refresh);
  refreshRef.current = auth.refresh;
  const [epoch, setEpoch] = useState(0);
  const [sessionCleared, setSessionCleared] = useState(false);
  const clearingRef = useRef(0);
  const identity = auth.user ? personalCenterIdentity(auth.user) : null;
  const scope = identity && !auth.loading && !auth.error && !sessionCleared ? `${identity}:${epoch}` : null;
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  useEffect(() => installAuthSessionClearListener(() => {
    const generation = ++clearingRef.current;
    // Invalidate synchronously, before React commits the unmount, so a promise
    // completing in this same turn cannot act on the previous subject.
    scopeRef.current = null;
    setSessionCleared(true);
    setEpoch(value => value + 1);
    // A cached auth.me object must not resurrect the old session. Only a fresh
    // successful server result can mount another self-scoped page after clearing.
    void refreshRef.current().then(result => {
      if (generation === clearingRef.current && !result.error && result.data) {
        setSessionCleared(false);
      }
    }).catch(() => {});
  }), []);

  return <DashboardLayout>
    <section className="personal-center" aria-label="个人中心">
      <header className="pc-page-header"><h1 className="aui-page-title">个人中心</h1></header>
      {auth.loading ? <LoadingPanel /> : auth.error ?
        <Failure error={auth.error} retry={() => { void auth.refresh(); }} /> :
        identity && !sessionCleared ? <ProfileSession
          key={`${identity}:${epoch}`}
          identity={identity}
          epoch={epoch}
          refresh={auth.refresh}
          logout={auth.logout}
          isCurrent={() => scopeRef.current === scope}
        /> : <div className="pc-state">登录状态已失效，请重新登录。</div>}
    </section>
  </DashboardLayout>;
}

function ProfileSession({ identity, epoch, refresh, logout, isCurrent }: {
  identity: string;
  epoch: number;
  refresh: ReturnType<typeof useAuth>["refresh"];
  logout: ReturnType<typeof useAuth>["logout"];
  isCurrent(): boolean;
}) {
  const rpc = trpc.useUtils().client.personalCenter;
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();
  const prefix = useMemo(() => personalCenterQueryPrefix(identity, epoch), [identity, epoch]);
  const live = useRef(true);
  const [tab, setTab] = useState<Tab>("profile");
  const [month, setMonth] = useState(currentShanghaiMonth);
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ displayName: "", email: "" });
  const [password, setPassword] = useState(EMPTY_PASSWORD);
  const [phone, setPhone] = useState(EMPTY_PHONE);
  const [securityError, setSecurityError] = useState<string | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [relogin, setRelogin] = useState(false);
  const [ticket, setTicket] = useState<{
    ticketId: string; phone: string; maskedPhone: string; expiresAt: number;
  } | null>(null);
  const [retryAt, setRetryAt] = useState(0);
  const [now, setNow] = useState(Date.now);
  const cooldown = Math.max(0, Math.ceil((retryAt - now) / 1000));
  const ticketExpired = !!ticket && now >= ticket.expiresAt;

  function currentSession() { return live.current && isCurrent(); }
  function assertCurrentSession() {
    if (!currentSession()) throw new Error("登录主体已变化，请重新加载个人中心");
  }

  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      // Abort old identity requests, discard their data, and remove mutation
      // variables (password/SMS code) as this subject's component is unmounted.
      void queryClient.cancelQueries({ queryKey: prefix });
      queryClient.removeQueries({ queryKey: prefix });
      for (const mutation of queryClient.getMutationCache().findAll({ mutationKey: prefix })) {
        queryClient.getMutationCache().remove(mutation);
      }
    };
  }, [prefix, queryClient]);

  useEffect(() => {
    if (!retryAt && !ticket) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [retryAt, ticket]);

  const profileQuery = useQuery({
    queryKey: [...prefix, "profile"],
    queryFn: ({ signal }) => {
      assertCurrentSession();
      return rpc.profile.query(undefined, { signal });
    },
    retry: false, gcTime: 0, staleTime: 0, placeholderData: undefined,
    refetchOnWindowFocus: false,
  });
  const performanceQuery = useQuery({
    queryKey: [...prefix, "performance", month, page],
    queryFn: ({ signal }) => {
      assertCurrentSession();
      return rpc.performance.query({ month, page, pageSize: 10 }, { signal });
    },
    enabled: tab === "performance" && validMonth(month),
    retry: false, gcTime: 0, staleTime: 0, placeholderData: undefined,
    refetchOnWindowFocus: false,
  });
  const commissionQuery = useQuery({
    queryKey: [...prefix, "commission", month],
    queryFn: ({ signal }) => {
      assertCurrentSession();
      return rpc.commission.query({ month }, { signal });
    },
    enabled: tab === "commission" && validMonth(month),
    retry: false, gcTime: 0, staleTime: 0, placeholderData: undefined,
    refetchOnWindowFocus: false,
  });

  const updateProfile = useMutation({
    mutationKey: [...prefix, "update-profile"], gcTime: 0,
    mutationFn: (input: { displayName: string; email: string }) => {
      assertCurrentSession();
      return rpc.updateProfile.mutate(input);
    },
    onSuccess: next => {
      if (!currentSession()) return;
      queryClient.setQueryData([...prefix, "profile"], next);
      setDraft({ displayName: "", email: "" });
      setEditing(false);
      setProfileError(null);
      void refresh();
      toast.success("个人资料已保存");
    },
    onError: error => { if (currentSession()) setProfileError(messageOf(error)); },
  });

  async function requireLogin(message: string) {
    if (!currentSession()) return;
    setPassword(EMPTY_PASSWORD);
    setPhone(EMPTY_PHONE);
    setTicket(null);
    setDraft({ displayName: "", email: "" });
    setRelogin(true);
    toast.success(message);
    // The backend has already revoked old sessions and cleared its cookie.
    // useAuth.logout also clears the native header token and broadcasts the
    // session reset; even an already-revoked logout must end at the login page.
    try { await logout(); } catch { /* Already revoked by the successful mutation. */ }
    navigate("/login", { replace: true });
  }
  const changePassword = useMutation({
    mutationKey: [...prefix, "change-password"], gcTime: 0,
    mutationFn: (input: { oldPassword: string; newPassword: string }) => {
      assertCurrentSession();
      return rpc.changePassword.mutate(input);
    },
    onSuccess: () => requireLogin("密码已修改，请使用新密码重新登录"),
    onError: error => { if (currentSession()) setSecurityError(messageOf(error)); },
  });
  const requestCode = useMutation({
    mutationKey: [...prefix, "phone-code"], gcTime: 0,
    mutationFn: (input: { oldPassword: string; phone: string }) => {
      assertCurrentSession();
      return rpc.requestPhoneCode.mutate(input);
    },
    onSuccess: (result, input) => {
      if (!currentSession()) return;
      const requestedAt = Date.now();
      setNow(requestedAt);
      setRetryAt(requestedAt + result.retryAfterSeconds * 1000);
      setTicket({ ticketId: result.ticketId, phone: input.phone,
        maskedPhone: result.maskedPhone, expiresAt: requestedAt + result.expiresInSeconds * 1000 });
      setPhone(current => ({ ...current, code: "" }));
      setSecurityError(null);
    },
    onError: error => { if (currentSession()) setSecurityError(messageOf(error)); },
  });
  const bindPhone = useMutation({
    mutationKey: [...prefix, "bind-phone"], gcTime: 0,
    mutationFn: (input: { oldPassword: string; phone: string; ticketId: string; code: string }) => {
      assertCurrentSession();
      return rpc.bindPhone.mutate(input);
    },
    onSuccess: () => requireLogin("手机号已验证并更新，请重新登录"),
    onError: error => { if (currentSession()) setSecurityError(messageOf(error)); },
  });
  const securityPending = changePassword.isPending || requestCode.isPending || bindPhone.isPending || relogin;
  const profile = profileQuery.data;
  const performance = performanceQuery.data;
  const commission = commissionQuery.data;

  function saveProfile(event: FormEvent) {
    event.preventDefault();
    if (updateProfile.isPending) return;
    const displayName = draft.displayName.trim();
    const email = draft.email.trim();
    if (!displayName) { setProfileError("请输入用户名称"); return; }
    setProfileError(null);
    updateProfile.mutate({ displayName, email });
  }
  function savePassword(event: FormEvent) {
    event.preventDefault();
    if (securityPending) return;
    const error = passwordError(password);
    setSecurityError(error);
    if (error) return;
    changePassword.mutate({ oldPassword: password.oldPassword, newPassword: password.newPassword });
  }
  function sendCode() {
    if (securityPending || cooldown > 0) return;
    const normalized = normalizeMainlandPhone(phone.phone);
    if (!phone.oldPassword) { setSecurityError("请输入原密码以验证身份"); return; }
    if (!normalized) { setSecurityError("请输入有效的中国大陆手机号"); return; }
    setSecurityError(null);
    setTicket(null);
    requestCode.mutate({ oldPassword: phone.oldPassword, phone: normalized });
  }
  function savePhone(event: FormEvent) {
    event.preventDefault();
    if (securityPending) return;
    const normalized = normalizeMainlandPhone(phone.phone);
    if (!normalized || !phone.oldPassword) { setSecurityError("请填写原密码及有效的新手机号"); return; }
    if (!ticket || ticket.phone !== normalized || ticketExpired) { setSecurityError("请先获取当前新手机号的有效验证码"); return; }
    if (!/^\d{6}$/.test(phone.code)) { setSecurityError("请输入6位短信验证码"); return; }
    setSecurityError(null);
    bindPhone.mutate({ oldPassword: phone.oldPassword, phone: normalized, ticketId: ticket.ticketId, code: phone.code });
  }
  function editPhone(field: "oldPassword" | "phone", value: string) {
    setPhone(current => ({ ...current, [field]: value, code: "" }));
    setTicket(null);
    setSecurityError(null);
  }

  return <>
    <div className="pc-tabs" role="tablist" aria-label="个人中心功能">
      {TABS.map(item => <button type="button" key={item.key} id={`pc-tab-${item.key}`}
        role="tab" aria-selected={tab === item.key} aria-controls={`pc-panel-${item.key}`}
        tabIndex={tab === item.key ? 0 : -1}
        onKeyDown={event => {
          const index = TABS.findIndex(candidate => candidate.key === tab);
          const next = event.key === "ArrowRight" ? (index + 1) % TABS.length :
            event.key === "ArrowLeft" ? (index + TABS.length - 1) % TABS.length :
            event.key === "Home" ? 0 : event.key === "End" ? TABS.length - 1 : null;
          if (next === null) return;
          event.preventDefault();
          setTab(TABS[next].key);
          setSecurityError(null);
          document.getElementById(`pc-tab-${TABS[next].key}`)?.focus();
        }}
        onClick={() => { setTab(item.key); setSecurityError(null); }}>
        {item.label}
      </button>)}
    </div>

    <div id={`pc-panel-${tab}`} role="tabpanel" aria-labelledby={`pc-tab-${tab}`} className="pc-panel">
      {(tab === "profile" || tab === "security") && (profileQuery.isPending ? <LoadingPanel /> :
        profileQuery.isError ? <Failure error={profileQuery.error} retry={() => { void profileQuery.refetch(); }} pending={profileQuery.isFetching} /> : !profile ?
          <div className="pc-state">暂无法读取个人资料。</div> : null)}

      {tab === "profile" && profile && !profileQuery.isError && <Card className="pc-card">
        <CardHeader className="pc-card-header">
          <div className="pc-identity"><span className="pc-avatar" aria-hidden="true">
            {(profile.displayName || profile.username || "我").slice(0, 1).toUpperCase()}
          </span><div><CardTitle>{presentValue(profile.displayName)}</CardTitle>
            <span className="pc-muted">{presentValue(profile.username)} · {roleLabel(profile.adminRole)}</span></div></div>
          {!editing && <Button size="sm" variant="outline" onClick={() => {
            setDraft({ displayName: profile.displayName, email: profile.email });
            setProfileError(null); setEditing(true);
          }}>编辑资料</Button>}
        </CardHeader>
        <CardContent className="pc-card-content">
          <dl className="pc-details">
            <div><dt>真实姓名</dt><dd>{sourcedField(profile, "realName")}</dd></div>
            <div><dt>登录账号</dt><dd>{presentValue(profile.username)}</dd></div>
            <div><dt>角色</dt><dd>{roleLabel(profile.adminRole)}</dd></div>
            <div><dt>所属公司</dt><dd>{sourcedField(profile, "companyName")}</dd></div>
            <div><dt>岗位</dt><dd>{sourcedField(profile, "positionName")}</dd></div>
            <div><dt>手机号</dt><dd>{presentValue(profile.phone)}
              {profile.phone && <span className="pc-inline-status">{profile.phoneBinding === "verified_by_current_ticket" ? "已验证" : "未验证"}</span>}
            </dd></div>
          </dl>
          {editing ? <form className="pc-edit-form" onSubmit={saveProfile}>
            <div className="pc-form-grid">
              <div className="pc-field"><Label htmlFor="pc-display-name">用户名称</Label>
                <Input id="pc-display-name" maxLength={128} required value={draft.displayName}
                  disabled={updateProfile.isPending} onChange={event => setDraft(value => ({ ...value, displayName: event.target.value }))} />
              </div>
              <div className="pc-field"><Label htmlFor="pc-email">联系邮箱</Label>
                <Input id="pc-email" type="email" maxLength={255} value={draft.email}
                  disabled={updateProfile.isPending} onChange={event => setDraft(value => ({ ...value, email: event.target.value }))} />
              </div>
            </div>
            {profileError && <p className="pc-error" role="alert">{profileError}</p>}
            <div className="pc-actions"><Button type="button" variant="outline" size="sm" disabled={updateProfile.isPending}
              onClick={() => { setEditing(false); setDraft({ displayName: "", email: "" }); setProfileError(null); }}>取消</Button>
              <Button type="submit" size="sm" disabled={updateProfile.isPending}>
                {updateProfile.isPending ? <Loader2 className="animate-spin" /> : <Save />}保存资料
              </Button>
            </div>
          </form> : <dl className="pc-details pc-contact-details">
            <div><dt>用户名称</dt><dd>{presentValue(profile.displayName)}</dd></div>
            <div><dt>联系邮箱</dt><dd>{presentValue(profile.email)}</dd></div>
          </dl>}
        </CardContent>
      </Card>}

      {tab === "security" && profile && !profileQuery.isError && <>
        {securityError && <p className="pc-error pc-error-banner" role="alert">{securityError}</p>}
        {relogin && <p className="pc-state" role="status">安全设置已更新，正在退出并前往登录页…</p>}
        <div className="pc-security-grid">
          <Card className="pc-card"><CardHeader className="pc-card-header"><CardTitle><KeyRound />修改密码</CardTitle></CardHeader>
            <CardContent className="pc-card-content"><form onSubmit={savePassword} className="pc-security-form">
              <div className="pc-field"><Label htmlFor="pc-old-password">原密码</Label>
                <Input id="pc-old-password" type="password" autoComplete="current-password" maxLength={128} required
                  disabled={securityPending} value={password.oldPassword} onChange={event => setPassword(value => ({ ...value, oldPassword: event.target.value }))} />
              </div>
              <div className="pc-field"><Label htmlFor="pc-new-password">新密码</Label>
                <Input id="pc-new-password" type="password" autoComplete="new-password" minLength={8} maxLength={128} required placeholder="至少8个字符"
                  disabled={securityPending} value={password.newPassword} onChange={event => setPassword(value => ({ ...value, newPassword: event.target.value }))} />
              </div>
              <div className="pc-field"><Label htmlFor="pc-confirm-password">确认新密码</Label>
                <Input id="pc-confirm-password" type="password" autoComplete="new-password" minLength={8} maxLength={128} required
                  disabled={securityPending} value={password.confirmPassword} onChange={event => setPassword(value => ({ ...value, confirmPassword: event.target.value }))} />
              </div>
              <div className="pc-actions"><Button type="submit" size="sm" disabled={securityPending}>
                {changePassword.isPending ? <Loader2 className="animate-spin" /> : <KeyRound />}修改并重新登录
              </Button></div>
            </form></CardContent>
          </Card>
          <Card className="pc-card"><CardHeader className="pc-card-header"><CardTitle><Phone />{profile.phoneBinding === "verified_by_current_ticket" ? "更换手机号" : "验证与绑定手机"}</CardTitle></CardHeader>
            <CardContent className="pc-card-content"><form onSubmit={savePhone} className="pc-security-form">
              <p className="pc-muted">当前手机号：{presentValue(profile.phone)}{profile.phone && profile.phoneBinding !== "verified_by_current_ticket" ? "（未验证）" : ""}</p>
              <div className="pc-field"><Label htmlFor="pc-phone-password">原密码验证身份</Label>
                <Input id="pc-phone-password" type="password" autoComplete="current-password" maxLength={128} required
                  disabled={securityPending} value={phone.oldPassword} onChange={event => editPhone("oldPassword", event.target.value)} />
              </div>
              <div className="pc-field"><Label htmlFor="pc-phone">待验证手机号</Label>
                <Input id="pc-phone" type="tel" inputMode="tel" autoComplete="tel" maxLength={16} required placeholder={profile.phoneBinding === "verified_by_current_ticket" ? "中国大陆新手机号" : "可验证当前号码或绑定新号码"}
                  disabled={securityPending} value={phone.phone} onChange={event => editPhone("phone", event.target.value)} />
              </div>
              <div className="pc-field"><Label htmlFor="pc-phone-code">短信验证码</Label>
                <div className="pc-code-row"><Input id="pc-phone-code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} required
                  disabled={securityPending || !ticket || ticketExpired} value={phone.code}
                  onChange={event => setPhone(value => ({ ...value, code: event.target.value.replace(/\D/g, "").slice(0, 6) }))} />
                  <Button type="button" variant="outline" size="sm" onClick={sendCode}
                    disabled={securityPending || cooldown > 0 || !phone.oldPassword || !normalizeMainlandPhone(phone.phone)}>
                    {requestCode.isPending ? <Loader2 className="animate-spin" /> : null}
                    {cooldown > 0 ? `${cooldown}秒后重发` : "获取验证码"}
                  </Button>
                </div>
              </div>
              {ticket && <p className="pc-muted" role="status">{ticketExpired ? "验证码已过期，请重新获取。" : `验证码已发送至 ${ticket.maskedPhone}`}</p>}
              <div className="pc-actions"><Button type="submit" size="sm"
                disabled={securityPending || !ticket || ticketExpired || !/^\d{6}$/.test(phone.code)}>
                {bindPhone.isPending ? <Loader2 className="animate-spin" /> : <BadgeCheck />}验证并{profile.phone ? "更换" : "绑定"}
              </Button></div>
            </form></CardContent>
          </Card>
        </div>
      </>}

      {(tab === "performance" || tab === "commission") && <div className="pc-filter">
        <Label htmlFor="pc-month">月份</Label><Input id="pc-month" type="month" value={month}
          onChange={event => {
            if (validMonth(event.target.value)) { setMonth(event.target.value); setPage(1); }
          }} />
        <span className="pc-muted">北京时间</span>
      </div>}
      {tab === "performance" && (performanceQuery.isPending ? <LoadingPanel /> : performanceQuery.isError ?
        <Failure error={performanceQuery.error} retry={() => { void performanceQuery.refetch(); }} pending={performanceQuery.isFetching} /> :
        performance?.status === "unavailable" ? <div className="pc-state">{performance.reason || "当前暂无可核实的本人业绩来源。"}</div> :
        performance?.status === "available" ? <>
          <div className="pc-stat-grid">
            <div className="pc-stat"><span>本人订单数</span><strong>{performance.orderCount}</strong><small>笔</small></div>
            <div className="pc-stat"><span>销售额</span><strong>{decimalAmount(performance.orderAmount)}</strong><small>{performance.currencyLabel}（{performance.currency}）</small></div>
            <div className="pc-stat"><span>已回款</span><strong>{decimalAmount(performance.collectedAmount)}</strong><small>{performance.currencyLabel}（{performance.currency}）</small></div>
          </div>
          <Card className="pc-card"><CardHeader className="pc-card-header"><CardTitle>本人订单明细</CardTitle>
            <span className="pc-muted">{performance.currencyLabel}（{performance.currency}）</span>
          </CardHeader>
            <div className="pc-table-scroll"><table className="pc-table">
              <thead><tr><th>订单编号</th><th>下单时间</th><th className="pc-center">状态</th><th className="pc-numeric">销售金额</th></tr></thead>
              <tbody>{performance.items.length ? performance.items.map(order => <tr key={order.id}>
                <td>{order.orderNumber}</td>
                <td>{new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(order.createdAt))}</td>
                <td className="pc-center">已确认</td><td className="pc-numeric">{decimalAmount(order.totalAmount)}</td>
              </tr>) : <tr><td colSpan={4} className="pc-center">该月暂无本人已确认订单。</td></tr>}</tbody>
            </table></div>
            <div className="pc-pagination">
              <span>共 {performance.total} 笔 · 第 {performance.page} / {Math.max(1, Math.ceil(performance.total / performance.pageSize))} 页</span>
              <Button size="sm" variant="outline" disabled={performance.page <= 1 || performanceQuery.isFetching}
                onClick={() => setPage(value => Math.max(1, value - 1))}>上一页</Button>
              <Button size="sm" variant="outline" disabled={performance.page * performance.pageSize >= performance.total || performanceQuery.isFetching}
                onClick={() => setPage(value => value + 1)}>下一页</Button>
            </div>
          </Card>
          <details className="pc-basis"><summary>统计口径与不可用数据</summary>
            <p>{performance.basis}</p>
            <p>账期登记：{decimalAmount(performance.monthlyBookedAmount)} {performance.currency}（不计入现金回款）</p>
            <p>退款：暂无可核实账本，不以0代替。</p>
          </details>
        </> : <div className="pc-state">暂无可核实的业绩数据。</div>)}
      {tab === "commission" && (commissionQuery.isPending ? <LoadingPanel /> : commissionQuery.isError ?
        <Failure error={commissionQuery.error} retry={() => { void commissionQuery.refetch(); }} pending={commissionQuery.isFetching} /> :
        <Card className="pc-card"><CardHeader className="pc-card-header"><CardTitle>尚未配置</CardTitle></CardHeader>
          <CardContent className="pc-card-content"><p className="pc-muted">{commission?.reason || "尚未配置可核实的个人提成规则与结算来源。"}</p></CardContent>
        </Card>)}
    </div>
  </>;
}
