import * as React from "react";
import { trpc as typedTrpc } from "../../../../api/business-trpc";
import { useAuth } from "../../../../api/business-auth";
import { useCompanyStockScope } from "../components/companyStock/useCompanyStockSession";
import { SalesCustomerPicker } from "../components/companyStock/SalesCustomerPicker";
import { CompanyStockShipmentForm } from "../components/companyStock/CompanyStockShipmentForm";
import { Button } from "../components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog";
import {
  __sv2_SCALE,
  __sv2_PRICE,
  __sv2_micro,
  __sv2_div,
  __sv2_text,
  __sv2_money,
  __sv2_trim,
  __sv2_id,
  __sv2_date,
  __sv2_today,
  __sv2_paid,
  __sv2_due,
  __sv2_complete,
  __sv2_status,
  __sv2_known,
  __sv2_error,
  __sv2_receiptKey,
  __sv2_receipt,
  __sv2_createDraft,
  __sv2_definite,
  __sv2_form,
  __sv2_new,
  __sv2_totals,
  __sv2_localFinance,
  __sv2_payload,
  __sv2_editPreview,
  __sv2_validate,
  __sv2_diffs,
} from "../lib/businessSalesOrderMoney";
import "./BusinessSalesOrdersPage.css";
// 与采购页面的动态接口方式一致，保留线上新增 revise 和扩展响应。
const trpc = typedTrpc as any;
function __sv2_Input({ label, value, onChange, ...rest }: any) {
  return (
    <input
      className="crm-input"
      aria-label={label}
      value={value ?? ""}
      onChange={(e: any) => onChange(e.target.value)}
      {...rest}
    />
  );
}
function __sv2_Button({
  children,
  primary = false,
  danger = false,
  ...props
}: any) {
  return (
    <Button
      type="button"
      variant="outline"
      className={
        "__sv2_btn " +
        (primary ? "__sv2_primary " : "") +
        (danger ? "__sv2_danger" : "")
      }
      {...props}
    >
      {children}
    </Button>
  );
}
function __sv2_Finance({ finance, totals, estimated }: any) {
  return (
    <section className="aui-data-panel __sv2_card">
      <div className="__sv2_heading">
        <strong>
          {finance ? "利润与提成" : "销售汇总"}
          {estimated && finance ? "（预估）" : ""}
        </strong>
        <small>{finance ? "整单计档" : ""}</small>
      </div>
      <div className="__sv2_kv">
        <span>销售额</span>
        <b>{__sv2_money(totals.sales)}</b>
      </div>
      {finance ? (
        <>
          <div className="__sv2_kv">
            <span>采购成本</span>
            <b>{__sv2_money(finance.cost)}</b>
          </div>
          {finance.goods != null && finance.procFee != null ? (
            <small className="__sv2_sub">
              货款 {__sv2_money(finance.goods)} + 采购费用{" "}
              {__sv2_money(finance.procFee)}
            </small>
          ) : (
            <small className="__sv2_sub">
              含采购费用 · 货款/费用拆分待后端提供
            </small>
          )}
          <div className="__sv2_kv">
            <span>差价</span>
            <b>{__sv2_money(finance.margin)}</b>
          </div>
          <div className="__sv2_kv">
            <span>税扣</span>
            <b>{__sv2_money(-finance.tax)}</b>
          </div>
        </>
      ) : null}
      <div className="__sv2_kv">
        <span>销售费用</span>
        <b>{totals.expense === null ? "—" : __sv2_money(-totals.expense)}</b>
      </div>
      {finance ? (
        <>
          <div className="__sv2_net">
            <span>净利润</span>
            <b className={finance.net < 0n ? "__sv2_red" : ""}>
              {__sv2_money(finance.net)}
            </b>
          </div>
          <div className="__sv2_com">
            <span>预计提成 {finance.rate}%</span>
            <b>{__sv2_money(finance.com)}</b>
          </div>
          <div className="__sv2_tiers">
            {[
              [15, "≤5万 15%"],
              [18, "5–10万 18%"],
              [20, ">10万 20%"],
            ].map(([r, t]: any) => (
              <div key={r} className={finance.rate === r ? "on" : ""}>
                {t}
              </div>
            ))}
          </div>
          <small className="__sv2_muted">
            回款完成后计入提成{estimated ? "；最终以保存后服务器结果为准" : ""}
          </small>
        </>
      ) : null}
    </section>
  );
}
function __sv2_Expenses({ rows, onChange, disabled }: any) {
  return (
    <section className="crm-order-section">
      <div className="__sv2_heading">
        <strong>销售费用</strong>
        <small>从订单利润中扣除</small>
      </div>
      <div className="__sv2_tw">
        <table className="__sv2_table __sv2_exp">
          <thead>
            <tr>
              <th>项目</th>
              <th>金额</th>
              <th>备注</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {rows.length ? (
              rows.map((e: any, k: any) => (
                <tr key={k}>
                  <td>
                    <__sv2_Input
                      label={"费用第" + (k + 1) + "行项目"}
                      list="__sv2_exp_names"
                      maxLength={64}
                      value={e.title}
                      disabled={disabled}
                      onChange={(v: any) =>
                        onChange(
                          rows.map((x: any, j: any) =>
                            j === k ? { ...x, title: v } : x,
                          ),
                        )
                      }
                      placeholder="选择或输入"
                    />
                  </td>
                  <td>
                    <__sv2_Input
                      label={"费用第" + (k + 1) + "行金额"}
                      inputMode="decimal"
                      value={e.amount}
                      disabled={disabled}
                      onChange={(v: any) =>
                        onChange(
                          rows.map((x: any, j: any) =>
                            j === k ? { ...x, amount: v } : x,
                          ),
                        )
                      }
                      placeholder="0.00"
                    />
                  </td>
                  <td>
                    <__sv2_Input
                      label={"费用第" + (k + 1) + "行备注"}
                      maxLength={500}
                      value={e.note}
                      disabled={disabled}
                      onChange={(v: any) =>
                        onChange(
                          rows.map((x: any, j: any) =>
                            j === k ? { ...x, note: v } : x,
                          ),
                        )
                      }
                      placeholder="付款对象、发票"
                    />
                  </td>
                  <td>
                    <button
                      type="button"
                      className="__sv2_link"
                      disabled={disabled}
                      onClick={() =>
                        onChange(rows.filter((_: any, j: any) => j !== k))
                      }
                    >
                      删除
                    </button>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={4} className="__sv2_muted">
                  暂无销售费用
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <datalist id="__sv2_exp_names">
        {["开票税点", "运费", "客户返点", "中介佣金", "招待费", "其他"].map(
          (t: any) => (
            <option key={t} value={t} />
          ),
        )}
      </datalist>
      {!disabled ? (
        <__sv2_Button
          disabled={rows.length >= 30}
          onClick={() =>
            onChange([...rows, { title: "", amount: "", note: "" }])
          }
        >
          ＋ 添加费用
        </__sv2_Button>
      ) : null}
      <small className="__sv2_muted">最多30行</small>
    </section>
  );
}
const __sv2_cache = new Map();
export function BusinessSalesOrdersPage({ ready, state, embedded }: any) {
  const identity = useCompanyStockScope(),
    auth = useAuth(),
    utils = trpc.useUtils(),
    [keyword, setKeyword] = React.useState<any>(""),
    [search, setSearch] = React.useState<any>(""),
    [tab, setTab] = React.useState<any>("all"),
    [page, setPage] = React.useState<any>(1),
    [session, setSession] = React.useState<any>(null),
    [details, setDetails] = React.useState<any>({}),
    [notice, setNotice] = React.useState<any>("");
  const enabled = ready && identity.ready,
    list = trpc.crmSalesOrder.list.useQuery(
      {
        keyword: search,
        page,
        pageSize: 20,
        ...(embedded ? { customerId: embedded.customer.id } : {}),
      },
      { enabled, retry: false, staleTime: 15000, placeholderData: undefined },
    ),
    rows = enabled && !list.isError ? (list.data?.items ?? []) : [],
    epoch = rows.map((x: any) => x.id + ":" + x.version).join(","),
    root = React.useRef<any>(null),
    scope = identity.identityKey;
  const rowsRef = React.useRef<any>(rows);
  rowsRef.current = rows;
  React.useEffect(() => {
    setDetails({});
    setSession(null);
  }, [scope]);
  React.useEffect(() => {
    if (ready && identity.ready) {
      const receipt = __sv2_receipt(identity.storageScope),
        recovery = __sv2_createDraft(identity.storageScope);
      if (receipt) {
        setNotice(
          receipt.expenses?.length
            ? "订单已创建，但销售费用未保存，请打开订单补录。"
            : "订单已创建，请核对创建结果。",
        );
        setSession({
          id: receipt.id,
          key: scope + ":" + receipt.id,
          initialExpenses: receipt.expenses,
        });
      } else if (recovery) {
        setNotice("新建保存结果待确认，请重试原请求核验，不能重复创建。");
        setSession({ new: true, key: recovery.payload.requestId, recovery });
      }
    }
  }, [ready, identity.ready, identity.storageScope, scope]);
  React.useEffect(() => {
    if (!enabled || !rows.length) return;
    let alive = true,
      active = 0;
    const queue: any[] = [],
      queued = new Set(),
      observer = new IntersectionObserver(
        (entries: any) => {
          entries.forEach((e: any) => {
            if (e.isIntersecting) enqueue(Number(e.target.dataset.orderId));
          });
        },
        { rootMargin: "0px" },
      );
    const pump = () => {
      while (alive && active < 3 && queue.length) {
        const row = queue.shift(),
          key = scope + ":" + row.id + ":" + row.version,
          cached = __sv2_cache.get(key);
        if (cached && Date.now() - cached.at < 60000) {
          setDetails((v: any) => ({ ...v, [row.id]: cached.data }));
          continue;
        }
        active++;
        utils.crmSalesOrder.get
          .fetch(
            { id: row.id, ...(embedded ? { customerId: row.customerId } : {}) },
            { staleTime: 0 },
          )
          .then((data: any) => {
            if (
              !alive ||
              data.id !== row.id ||
              data.customerId !== row.customerId
            )
              return;
            __sv2_cache.set(key, { at: Date.now(), data });
            if (__sv2_cache.size > 100)
              __sv2_cache.delete(__sv2_cache.keys().next().value);
            setDetails((v: any) => ({ ...v, [row.id]: data }));
          })
          .catch(() => {})
          .finally(() => {
            active--;
            pump();
          });
      }
    };
    function enqueue(id: any) {
      if (queued.has(id)) return;
      const row = rowsRef.current.find((x: any) => x.id === id);
      if (!row) return;
      queued.add(id);
      queue.push(row);
      pump();
    }
    root.current
      ?.querySelectorAll("[data-order-id]")
      .forEach((el: any) => observer.observe(el));
    return () => {
      alive = false;
      observer.disconnect();
    };
  }, [scope, enabled, epoch, tab]);
  const completed = (o: any) => __sv2_complete(o),
    filtered = rows.filter(
      (o: any) =>
        tab === "all" ||
        (tab === "cancelled" && o.status === "cancelled") ||
        (tab === "completed" && completed(o)) ||
        (tab === "payment" &&
          o.status !== "cancelled" &&
          !completed(o) &&
          __sv2_due(o) > 0n) ||
        (tab === "shipment" &&
          o.status !== "cancelled" &&
          !completed(o) &&
          o.shippedQty < o.orderedQty),
    ),
    profitRows = filtered.filter((o: any) => __sv2_known(details[o.id] ?? o)),
    showProfit = rows.some((o: any) => __sv2_known(details[o.id] ?? o));
  let sales = 0n,
    due = 0n,
    net = 0n;
  filtered.forEach((o: any) => {
    sales += __sv2_micro(o.totalAmount);
    if (o.status !== "cancelled") due += __sv2_due(o);
    if (o.status !== "cancelled" && __sv2_known(details[o.id] ?? o))
      net += __sv2_micro((details[o.id] ?? o).profitBreakdown.netProfit);
  });
  const refresh = () => {
    __sv2_cache.clear();
    setDetails({});
    list.refetch();
  };
  return (
    <div className="__sv2_scope" ref={root}>
      <div className="aui-data-panel __sv2_toolbar">
        <__sv2_Input
          label="订单搜索"
          value={keyword}
          maxLength={128}
          onChange={setKeyword}
          placeholder="订单号、需求号、项目、客户、型号"
          onKeyDown={(e: any) => {
            if (e.key === "Enter") {
              setSearch(keyword.trim());
              setPage(1);
            }
          }}
        />
        <__sv2_Button
          onClick={() => {
            setSearch(keyword.trim());
            setPage(1);
          }}
        >
          筛选
        </__sv2_Button>
        <__sv2_Button onClick={refresh}>刷新</__sv2_Button>
        <__sv2_Button
          primary
          disabled={!enabled}
          onClick={() => setSession({ new: true, key: __sv2_id() })}
        >
          新建业务订单
        </__sv2_Button>
      </div>
      <div className="__sv2_summary">
        <div>
          <span>订单金额</span>
          <b>{__sv2_money(sales)}</b>
        </div>
        <div>
          <span>待收款</span>
          <b>{__sv2_money(due)}</b>
        </div>
        {showProfit ? (
          <div>
            <span>净利润</span>
            <b>{__sv2_money(net)}</b>
            <small>
              已核算 {profitRows.length}/{filtered.length} 行
            </small>
          </div>
        ) : null}
        <small>当前页 · 当前页签汇总（非全库）</small>
      </div>
      <div className="__sv2_tabs" role="tablist">
        {[
          ["all", "全部"],
          ["payment", "待收款"],
          ["shipment", "待出货"],
          ["completed", "已完成"],
          ["cancelled", "已取消"],
        ].map(([id, title]: any) => (
          <button
            type="button"
            role="tab"
            aria-selected={tab === id}
            className={tab === id ? "on" : ""}
            key={id}
            onClick={() => setTab(id)}
          >
            {title}
          </button>
        ))}
        <small>页签筛选当前页数据</small>
      </div>
      {list.isError ? (
        <div role="alert" className="__sv2_alert">
          {__sv2_error(list.error)}
        </div>
      ) : null}
      {list.isFetching ? (
        <p role="status" className="__sv2_muted">
          正在读取订单…
        </p>
      ) : null}
      <div className="__sv2_listwrap">
        <table className="crm-sales-orders-table admin-table-readable __sv2_list">
          <thead>
            <tr>
              {[
                "订单号 / 日期",
                "客户",
                "料号 / 品牌",
                "数量 / 单价",
                "订单金额",
                ...(showProfit ? ["净利润 / 提成"] : []),
                "收款",
                "出货",
                "负责人",
                "操作",
              ].map((t: any) => (
                <th key={t}>{t}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((o: any) => {
              const d = details[o.id] ?? o,
                i = d.items?.[0],
                open = (action: any) =>
                  setSession({ id: o.id, key: scope + ":" + o.id, action }),
                cancel = o.status === "cancelled",
                ro = cancel || completed(o);
              return (
                <tr data-order-id={o.id} key={o.id}>
                  <td>
                    <button
                      type="button"
                      className="crm-sales-orders-order-link __sv2_order"
                      onClick={() => open("edit")}
                    >
                      {o.orderNumber}
                    </button>
                    <small>
                      {__sv2_date(o.createdAt).replace(/-/g, "/")} ·{" "}
                      {__sv2_status(o)}
                    </small>
                  </td>
                  <td>
                    <div className="admin-cell-primary">{o.customerName}</div>
                    <small>
                      {o.sourceType === "company_stock"
                        ? "公司库存"
                        : o.demandNo || "需求采购"}
                    </small>
                  </td>
                  <td>
                    <div className="admin-cell-primary">
                      {i?.partNumber ?? "正在读取…"}
                      {d.items?.length > 1
                        ? " +" + (d.items.length - 1) + "项"
                        : ""}
                    </div>
                    <small>
                      {i
                        ? [i.brand, i.dc ? "DC " + i.dc : ""]
                            .filter(Boolean)
                            .join(" · ")
                        : "—"}
                    </small>
                  </td>
                  <td className="__sv2_n">
                    {o.orderedQty} 件
                    <small>
                      {d.items?.length === 1
                        ? __sv2_money(i.price ?? i.unitPrice, 4) + "/件"
                        : d.items?.length > 1
                          ? "多价"
                          : "—"}
                    </small>
                  </td>
                  <td className="__sv2_n">
                    {__sv2_money(o.totalAmount)}
                    <small>
                      {o.currencyLabel ??
                        (o.salesTaxMode === "tax_included"
                          ? "人民币（含税）"
                          : o.salesTaxMode === "tax_excluded"
                            ? "人民币（未税）"
                            : "税口径待核")}
                    </small>
                    {__sv2_micro(o.salesExpenses ?? "0") > 0n ? (
                      <small>费用 {__sv2_money(o.salesExpenses)}</small>
                    ) : null}
                  </td>
                  {showProfit ? (
                    <td className="__sv2_n">
                      {cancel ? (
                        "—"
                      ) : __sv2_known(d) ? (
                        <>
                          <b
                            className={
                              __sv2_micro(d.profitBreakdown.netProfit) < 0n
                                ? "__sv2_red"
                                : "__sv2_green"
                            }
                          >
                            {__sv2_money(d.profitBreakdown.netProfit)}
                          </b>
                          {d.commissionPreview?.estimatedAmount != null ? (
                            <small>
                              提成 {d.commissionPreview.rate}% ·{" "}
                              {__sv2_money(d.commissionPreview.estimatedAmount)}
                            </small>
                          ) : null}
                        </>
                      ) : (
                        <small>—</small>
                      )}
                    </td>
                  ) : null}
                  <td>
                    <div>
                      <span
                        className={
                          __sv2_due(o) === 0n
                            ? "__sv2_green"
                            : __sv2_paid(o) > 0n
                              ? "__sv2_amber"
                              : "__sv2_muted"
                        }
                      >
                        ●
                      </span>{" "}
                      {o.paymentStatus === "monthly"
                        ? "月结登记"
                        : __sv2_due(o) === 0n
                          ? "已收款"
                          : __sv2_paid(o) > 0n
                            ? "部分收款"
                            : "未收款"}
                    </div>
                    {!cancel ? (
                      <small>待收 {__sv2_money(__sv2_due(o))}</small>
                    ) : null}
                  </td>
                  <td>
                    <div>
                      <span
                        className={
                          o.shippedQty >= o.orderedQty
                            ? "__sv2_green"
                            : o.shippedQty > 0
                              ? "__sv2_amber"
                              : "__sv2_muted"
                        }
                      >
                        ●
                      </span>{" "}
                      {o.shipmentStatus === "shipped"
                        ? "已出货"
                        : o.shippedQty > 0
                          ? "部分出货"
                          : "未出货"}
                    </div>
                    <small>
                      {o.shippedQty}/{o.orderedQty}
                    </small>
                  </td>
                  <td>
                    <small>{o.createdByName}</small>
                  </td>
                  <td className="__sv2_actions">
                    <button type="button" onClick={() => open("edit")}>
                      查看
                    </button>
                    {!ro ? (
                      <>
                        <button type="button" onClick={() => open("payment")}>
                          收款
                        </button>
                        <button type="button" onClick={() => open("shipment")}>
                          出货
                        </button>
                      </>
                    ) : null}
                  </td>
                </tr>
              );
            })}
            {!filtered.length && !list.isFetching ? (
              <tr>
                <td colSpan={showProfit ? 10 : 9} className="__sv2_empty">
                  当前页暂无符合此页签的订单
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <div className="aui-pagination __sv2_pagination">
        <span>
          共 {list.data?.total ?? 0} 条 · 当前页 {filtered.length} 条
        </span>
        <div>
          <__sv2_Button
            disabled={page <= 1 || list.isFetching}
            onClick={() => setPage(page - 1)}
          >
            上一页
          </__sv2_Button>
          <span>
            第 {page} / {Math.max(1, Math.ceil((list.data?.total ?? 0) / 20))}{" "}
            页
          </span>
          <__sv2_Button
            disabled={page * 20 >= (list.data?.total ?? 0) || list.isFetching}
            onClick={() => setPage(page + 1)}
          >
            下一页
          </__sv2_Button>
        </div>
      </div>
      {notice ? <p role="status">{notice}</p> : null}
      {session ? (
        <__sv2_Editor
          key={scope + session.key}
          session={session}
          enabled={enabled}
          embedded={embedded}
          onClose={() => setSession(null)}
          onChanged={(msg: any) => {
            setNotice(msg);
            refresh();
            embedded?.onOrderChanged?.();
          }}
        />
      ) : null}
    </div>
  );
}
export function __sv2_Editor({ session, enabled, embedded, onClose, onChanged }: any) {
  const identity = useCompanyStockScope(),
    auth = useAuth(),
    utils = trpc.useUtils(),
    [orderId, setOrderId] = React.useState<any>(session.id ?? null),
    [order, setOrder] = React.useState<any>(null),
    [form, setForm] = React.useState<any>(
      () =>
        session.recovery?.frozen ??
        __sv2_new(auth.user?.name ?? auth.user?.username),
    ),
    [error, setError] = React.useState<any>(""),
    [review, setReview] = React.useState<any>(false),
    [reason, setReason] = React.useState<any>(""),
    [history, setHistory] = React.useState<any>(false),
    [picker, setPicker] = React.useState<any>(null),
    [customerPicker, setCustomerPicker] = React.useState<any>(false),
    [lotSearch, setLotSearch] = React.useState<any>(""),
    [lotKeyword, setLotKeyword] = React.useState<any>(""),
    [lotPage, setLotPage] = React.useState<any>(1),
    [pending, setPending] = React.useState<any>(session.recovery ?? null),
    [busy, setBusy] = React.useState<any>(false),
    [payOpen, setPayOpen] = React.useState<any>(session.action === "payment"),
    [shipOpen, setShipOpen] = React.useState<any>(
      session.action === "shipment",
    ),
    [pay, setPay] = React.useState<any>({
      method: "bank",
      amount: "",
      date: __sv2_today(),
      note: "",
    }),
    [ship, setShip] = React.useState<any>({
      method: "pickup",
      company: "",
      number: "",
      qty: {},
    }),
    [cancelOpen, setCancelOpen] = React.useState<any>(false),
    [cancelReason, setCancelReason] = React.useState<any>(""),
    [previewInput, setPreviewInput] = React.useState<any>(null),
    [demandSearch, setDemandSearch] = React.useState<any>("");
  const [createId] = React.useState<any>(
      () => session.recovery?.payload.requestId ?? __sv2_id(),
    ),
    [expenseId] = React.useState<any>(__sv2_id),
    reviseId = React.useRef<any>(__sv2_id()),
    guard = React.useRef<any>({
      alive: true,
      enabled,
      identity: identity.identityKey,
    }),
    running = React.useRef<any>(false),
    startIdentity = React.useRef<any>(identity.identityKey);
  guard.current.enabled = enabled;
  guard.current.identity = identity.identityKey;
  React.useEffect(
    () => () => {
      guard.current.alive = false;
    },
    [],
  );
  const writable = () =>
    guard.current.alive &&
    guard.current.enabled &&
    guard.current.identity === startIdentity.current;
  const isNew = !orderId,
    read = trpc.crmSalesOrder.get.useQuery(
      {
        id: orderId ?? 1,
        ...(embedded ? { customerId: embedded.customer.id } : {}),
      },
      {
        enabled: enabled && !!orderId,
        retry: false,
        staleTime: 0,
        refetchOnMount: "always",
        placeholderData: undefined,
      },
    ),
    create = trpc.crmSalesOrder.createCompanyStock.useMutation({
      retry: false,
    }),
    createDemand = trpc.crmSalesOrder.create.useMutation({ retry: false }),
    revise = trpc.crmSalesOrder.revise.useMutation({ retry: false }),
    payment = trpc.crmSalesOrder.recordPayment.useMutation({ retry: false }),
    shipment = trpc.crmSalesOrder.shipCompanyStock.useMutation({
      retry: false,
    }),
    cancel = trpc.crmSalesOrder.cancel.useMutation({ retry: false }),
    allocate = trpc.crmSalesOrder.allocateCompanyStock.useMutation({
      retry: false,
    });
  React.useEffect(() => {
    if (
      enabled &&
      read.isSuccess &&
      !read.isFetching &&
      read.data?.id === orderId &&
      (!embedded || read.data.customerId === embedded.customer.id) &&
      !order
    ) {
      setOrder(read.data);
      setForm({
        ...__sv2_form(read.data),
        ...(session.initialExpenses
          ? { expenses: session.initialExpenses }
          : {}),
      });
      if (session.initialExpenses?.length)
        setError("订单已创建，但销售费用未保存，请补录。不会再次创建订单。");
      setPay((v: any) => ({
        ...v,
        amount: __sv2_trim(__sv2_text(__sv2_due(read.data))),
      }));
    }
  }, [read.data, read.isFetching, orderId, enabled, order]);
  const readonly =
      !isNew &&
      (order?.status === "cancelled" || (order && __sv2_complete(order))),
    locked = busy || !!pending || !enabled || readonly,
    customerLocked =
      !isNew &&
      (order?.sourceType !== "company_stock" ||
        __sv2_paid(order) > 0n ||
        order?.shippedQty > 0),
    totals = __sv2_totals(form),
    diffs = order ? __sv2_diffs(order, form) : [],
    errors = __sv2_validate(form, order),
    change = (patch: any) => {
      if (!locked) {
        setForm((v: any) => ({ ...v, ...patch }));
        setError("");
        setReview(false);
      }
    },
    changeLine = (k: any, patch: any) =>
      change({
        lines: form.lines.map((l: any, j: any) =>
          j === k ? { ...l, ...patch } : l,
        ),
      });
  const lots = trpc.crmSalesOrder.companyStockCandidates.useQuery(
    {
      customerId: form.customerId ?? 1,
      keyword: lotKeyword,
      page: lotPage,
      pageSize: 20,
      ...(!isNew && order?.companyStockAllocations?.length
        ? {
            selectedLotIds: Array.from(
              new Set(order.companyStockAllocations.map((x: any) => x.lotId)),
            ),
          }
        : {}),
    },
    {
      enabled:
        enabled &&
        !!form.customerId &&
        (form.source === "company_stock" || shipOpen) &&
        !readonly,
      retry: false,
      staleTime: 10000,
      placeholderData: undefined,
    },
  );
  const demands = trpc.crmSalesOrder.candidates.useQuery(
    {
      customerId: form.customerId ?? 1,
      keyword: demandSearch,
      page: 1,
      pageSize: 10,
    },
    {
      enabled:
        enabled && isNew && form.source === "demand" && !!form.customerId,
      retry: false,
      staleTime: 0,
      placeholderData: undefined,
    },
  );
  const signature = JSON.stringify([
    form.lines.map((l: any) => [l.qty, l.price, l.allocations]),
    form.salesTaxMode,
    form.customerId,
    form.confirmationNote,
    form.dueDate,
  ]);
  React.useEffect(() => {
    setPreviewInput(null);
    if (
      !enabled ||
      form.source !== "company_stock" ||
      !form.customerId ||
      !form.lines.length
    )
      return;
    const timer = setTimeout(() => {
      try {
        let payload = isNew
          ? __sv2_payload(
              { ...form, confirmationNote: form.confirmationNote || "预估" },
              createId,
            )
          : __sv2_editPreview(order, form);
        if (
          !payload ||
          form.lines.some(
            (l: any) => !/^[1-9]\d*$/.test(l.qty) || !__sv2_PRICE.test(l.price),
          )
        )
          return;
        setPreviewInput(payload);
      } catch {}
    }, 450);
    return () => clearTimeout(timer);
  }, [signature, isNew, order, enabled]);
  const preview = trpc.crmSalesOrder.previewCompanyStock.useQuery(
    previewInput ?? {
      customerId: form.customerId ?? 1,
      items: [],
      salesTaxMode: "tax_included",
      dueDate: null,
      confirmationNote: "预估",
      customerConfirmed: true,
    },
    {
      enabled: enabled && !!previewInput && !readonly,
      retry: false,
      staleTime: 10000,
      placeholderData: undefined,
    },
  );
  const sameQty =
      order &&
      form.lines.every((l: any) => Number(l.qty) === l.orderedQty) &&
      form.salesTaxMode === order.salesTaxMode,
    financeBase =
      !isNew && sameQty
        ? order
        : previewInput &&
            preview.isSuccess &&
            !preview.isFetching &&
            !preview.isError
          ? preview.data
          : null,
    finance =
      readonly && order
        ? __sv2_localFinance(order, form)
        : __sv2_localFinance(financeBase, form),
    estimated = isNew || diffs.length > 0;
  const refresh = async () => {
    const data = await utils.crmSalesOrder.get.fetch(
      {
        id: orderId,
        ...(embedded ? { customerId: embedded.customer.id } : {}),
      },
      { staleTime: 0 },
    );
    if (writable()) {
      setOrder(data);
      setForm(__sv2_form(data));
      reviseId.current = __sv2_id();
      setReason("");
      setReview(false);
      setPending(null);
      setPay((v: any) => ({
        ...v,
        amount: __sv2_trim(__sv2_text(__sv2_due(data))),
      }));
    }
    return data;
  };
  const finish = async (result: any, frozen: any) => {
    if (!writable()) return;
    const id = result.id;
    __sv2_receipt(identity.storageScope, { id, expenses: frozen.expenses });
    __sv2_createDraft(identity.storageScope, null);
    setOrderId(id);
    const data = await utils.crmSalesOrder.get.fetch({ id }, { staleTime: 0 });
    if (!writable()) return;
    setOrder(data);
    setForm(__sv2_form(data));
    if (frozen.expenses.length) {
      try {
        await revise.mutateAsync({
          id,
          version: data.version,
          requestId: expenseId,
          reason: "新建订单补录销售费用",
          confirmationNote: frozen.confirmationNote.trim(),
          dueDate: frozen.dueDate || null,
          lines: data.items.map((i: any) => ({
            orderItemId: i.id,
            orderedQty: i.orderedQty,
            unitPrice: i.unitPrice,
          })),
          expenses: frozen.expenses.map((e: any) => ({
            title: e.title.trim(),
            amount: e.amount.trim(),
            note: e.note.trim(),
          })),
        });
        const fresh = await utils.crmSalesOrder.get.fetch(
          { id },
          { staleTime: 0 },
        );
        if (writable()) {
          setOrder(fresh);
          setForm(__sv2_form(fresh));
          setError("订单已创建，销售费用已保存。");
          __sv2_receipt(identity.storageScope, null);
        }
      } catch (err: any) {
        if (writable()) {
          setForm({ ...__sv2_form(data), expenses: frozen.expenses });
          setError(
            "订单已创建，但销售费用未保存，请打开订单补录。当前已转为该订单编辑态；" +
              __sv2_error(err),
          );
        }
      }
    } else {
      setError("订单已创建。");
      __sv2_receipt(identity.storageScope, null);
    }
    setPending(null);
    onChanged("业务订单已创建：" + result.orderNumber);
  };
  const submit = async () => {
    if (!writable() || running.current || readonly) return;
    if (!pending && errors.length) {
      setError(errors.join("；"));
      return;
    }
    if (!isNew && !pending && !reason.trim()) {
      setError("请填写修改原因（最多200字）");
      return;
    }
    let operation = pending;
    if (!operation) {
      if (isNew) {
        operation = {
          kind: form.source === "demand" ? "createDemand" : "create",
          payload: __sv2_payload(form, createId),
          frozen: JSON.parse(JSON.stringify(form)),
        };
      } else {
        operation = {
          kind: "revise",
          payload: {
            id: order.id,
            version: order.version,
            requestId: reviseId.current,
            reason: reason.trim(),
            dueDate: form.dueDate || null,
            confirmationNote: form.confirmationNote.trim(),
            ...(form.salesTaxMode ? { salesTaxMode: form.salesTaxMode } : {}),
            ...(form.customerId !== order.customerId
              ? { customerId: form.customerId }
              : {}),
            lines: form.lines.map((l: any) => ({
              orderItemId: l.orderItemId,
              orderedQty: Number(l.qty),
              unitPrice: l.price.trim(),
            })),
            expenses: form.expenses.map((e: any) => ({
              title: e.title.trim(),
              amount: e.amount.trim(),
              note: e.note.trim(),
            })),
          },
        };
      }
    }
    running.current = true;
    setBusy(true);
    setPending(operation);
    if (operation.kind !== "revise")
      __sv2_createDraft(identity.storageScope, operation);
    setError("");
    try {
      const result = await (
        operation.kind === "create"
          ? create
          : operation.kind === "createDemand"
            ? createDemand
            : revise
      ).mutateAsync(operation.payload);
      if (!writable()) return;
      if (operation.kind !== "revise") {
        await finish(result, operation.frozen);
      } else {
        setPending(null);
        setReview(false);
        await refresh();
        setError(
          result.replayed
            ? "已返回此前保存结果。"
            : "保存修改成功，利润与提成已重算。",
        );
        onChanged("订单已更新");
        __sv2_receipt(identity.storageScope, null);
      }
    } catch (err: any) {
      if (writable()) {
        setError(__sv2_error(err));
        if (__sv2_definite(err)) {
          setPending(null);
          if (operation.kind !== "revise")
            __sv2_createDraft(identity.storageScope, null);
        }
      }
    } finally {
      running.current = false;
      if (writable()) setBusy(false);
    }
  };
  const close = () => {
    if (busy) return;
    if (pending) {
      setError("保存结果尚未确认，请先重试原请求核验，不可丢弃请求标识。");
      return;
    }
    if (
      ((isNew &&
        (form.lines.length || form.expenses.length || form.confirmationNote)) ||
        (!isNew && diffs.length)) &&
      !globalThis.confirm("修改尚未保存，确认放弃并关闭？")
    )
      return;
    onClose();
  };
  const action = async (kind: any, payload: any) => {
    if (!writable() || running.current || readonly) return;
    if (diffs.length) {
      setError("请先保存订单修改，再登记收款或出货。");
      return;
    }
    running.current = true;
    setBusy(true);
    try {
      await (
        kind === "payment"
          ? payment
          : kind === "cancel"
            ? cancel
            : kind === "allocate"
              ? allocate
              : shipment
      ).mutateAsync(payload);
      if (writable()) {
        await refresh();
        setPayOpen(false);
        setShipOpen(false);
        setCancelOpen(false);
        setError("操作成功。");
        onChanged("订单已更新");
      }
    } catch (err: any) {
      if (writable()) setError(__sv2_error(err));
    } finally {
      running.current = false;
      if (writable()) setBusy(false);
    }
  };
  const payRequest = React.useRef<any>(null),
    shipRequest = React.useRef<any>(null);
  const addLot = (lot: any) => {
    if (locked) return;
    const lotData = { ...lot, qty: "", consumedQty: 0 };
    if (typeof picker === "number" && form.lines[picker]) {
      const row = form.lines[picker];
      if (
        row.allocations.length &&
        [row.partNumber, row.brand ?? "", row.pkg ?? "", row.dc ?? ""].join(
          "|",
        ) !==
          [lot.partNumber, lot.brand ?? "", lot.pkg ?? "", lot.dc ?? ""].join(
            "|",
          )
      ) {
        setError(
          "同一行多批次必须料号、品牌、封装、DC完全一致；不同物料请添加新行。",
        );
        return;
      }
      if (row.allocations.some((x: any) => x.lotId === lot.lotId)) {
        setError("本行不能重复选择同一批次。");
        return;
      }
      changeLine(picker, {
        ...(!row.allocations.length
          ? {
              partNumber: lot.partNumber,
              brand: lot.brand,
              pkg: lot.pkg,
              dc: lot.dc,
            }
          : {}),
        allocations: [...row.allocations, lotData],
      });
    } else
      change({
        lines: [
          ...form.lines,
          {
            partNumber: lot.partNumber,
            brand: lot.brand,
            pkg: lot.pkg,
            dc: lot.dc,
            qtyUnit: "个",
            qty: "",
            price: "",
            shippedQty: 0,
            allocations: [lotData],
          },
        ],
      });
    setPicker(null);
  };
  const availableFor = (l: any) => {
    if (isNew)
      return (l.allocations ?? []).reduce(
        (n: any, x: any) => n + Number(x.availableQty ?? 0),
        0,
      );
    const byId = new Map(
      [...(lots.data?.items ?? []), ...(lots.data?.selectedItems ?? [])].map(
        (x: any) => [x.lotId, x],
      ),
    );
    const allocations = (order?.companyStockAllocations ?? []).filter(
      (x: any) => x.orderItemId === l.orderItemId,
    );
    if (allocations.some((x: any) => !byId.has(x.lotId))) return "—";
    return allocations.reduce(
      (n: any, x: any) => n + Number(byId.get(x.lotId).availableQty ?? 0),
      0,
    );
  };
  return (
    <Dialog
      open={true}
      onOpenChange={(v: any) => {
        if (!v) close();
      }}
    >
      <DialogContent
        className="crm-sales-orders-dialog __sv2_scope __sv2_dialog"
        showCloseButton={false}
        onPointerDownOutside={(e: any) => e.preventDefault()}
        onEscapeKeyDown={(e: any) => {
          if (busy || pending) e.preventDefault();
        }}
        aria-describedby="__sv2_desc"
      >
        <div className="__sv2_dialoghead">
          <DialogHeader>
            <DialogTitle>{isNew ? "新建业务订单" : "销售订单详情"}</DialogTitle>
          </DialogHeader>
          <div>
            {order ? (
              <__sv2_Button onClick={() => setHistory(true)}>
                修改记录 {order.audits?.length ?? 0}
              </__sv2_Button>
            ) : null}
            <button
              type="button"
              aria-label="关闭订单弹窗"
              className="__sv2_x"
              onClick={close}
            >
              ×
            </button>
          </div>
        </div>
        <span id="__sv2_desc" className="sr-only">
          统一两栏查看与编辑业务订单
        </span>
        <div className="__sv2_body">
          {read.isError ? (
            <div className="__sv2_alert" role="alert">
              {__sv2_error(read.error)}
              <__sv2_Button onClick={() => read.refetch()}>
                重新读取
              </__sv2_Button>
            </div>
          ) : null}
          {!isNew && !order ? (
            <p role="status">正在读取订单…</p>
          ) : (
            <div className="__sv2_grid">
              <div className="__sv2_left">
                <section className="aui-data-panel __sv2_card">
                  <div className="__sv2_heading">
                    <strong>客户与交付</strong>
                    <div>
                      {isNew ? (
                        <div className="__sv2_segment">
                          <button
                            type="button"
                            className={
                              form.source === "company_stock" ? "on" : ""
                            }
                            disabled={locked}
                            onClick={() =>
                              change({
                                source: "company_stock",
                                salesTaxMode: "tax_included",
                                lines: [],
                                demand: null,
                              })
                            }
                          >
                            公司库存
                          </button>
                          <button
                            type="button"
                            className={form.source === "demand" ? "on" : ""}
                            disabled={locked}
                            onClick={() =>
                              change({
                                source: "demand",
                                salesTaxMode: "",
                                lines: [],
                                demand: null,
                              })
                            }
                          >
                            需求采购
                          </button>
                        </div>
                      ) : (
                        <small>
                          {order.sourceType === "company_stock"
                            ? "公司库存"
                            : "需求采购 · " + (order.demandNo ?? "")}
                        </small>
                      )}
                    </div>
                  </div>
                  <div className="__sv2_meta">
                    <div>
                      <span>订单号：</span>
                      {order?.orderNumber ?? "保存后生成"}
                    </div>
                    <div>
                      <span>状态：</span>
                      {order ? __sv2_status(order) : "新建"}
                    </div>
                    <div>
                      <span>客户：</span>
                      {form.customerName || "请选择客户"}
                      {customerLocked ? (
                        "（锁定）"
                      ) : !locked ? (
                        <button
                          type="button"
                          className="__sv2_link"
                          onClick={() => setCustomerPicker(!customerPicker)}
                        >
                          {form.customerId ? " 更换" : " 选择客户"}
                        </button>
                      ) : null}
                    </div>
                    <div>
                      <span>负责人：</span>
                      {form.owner} <small>锁定</small>
                    </div>
                    <label>
                      <span>下单日期：</span>
                      <__sv2_Input
                        label="下单日期"
                        type="date"
                        value={form.orderDate}
                        disabled
                        title="现有接口不支持修改下单日期"
                        onChange={() => {}}
                      />
                    </label>
                    <label>
                      <span>约定交付：</span>
                      <__sv2_Input
                        label="约定交付日期"
                        type="date"
                        value={form.dueDate}
                        disabled={locked}
                        onChange={(v: any) => change({ dueDate: v })}
                      />
                    </label>
                  </div>
                  {customerPicker && !customerLocked && !locked ? (
                    <div className="__sv2_picker">
                      <SalesCustomerPicker
                        enabled={enabled && !locked}
                        onSelect={(customer: any) => {
                          if (writable()) {
                            change({
                              customerId: customer.id,
                              customerName: customer.name,
                              lines: isNew ? [] : form.lines,
                            });
                            setCustomerPicker(false);
                          }
                        }}
                      />
                    </div>
                  ) : null}
                </section>
                {isNew && form.source === "demand" ? (
                  <section className="aui-data-panel __sv2_card">
                    <div className="__sv2_heading">
                      <strong>关联需求</strong>
                      <small>沿用客户需求转单</small>
                    </div>
                    <__sv2_Input
                      label="搜索关联需求"
                      value={demandSearch}
                      onChange={setDemandSearch}
                      placeholder="需求号、型号"
                    />
                    {demands.isError ? (
                      <p className="__sv2_red">{__sv2_error(demands.error)}</p>
                    ) : null}
                    {(demands.data?.items ?? []).map((d: any) => (
                      <button
                        type="button"
                        key={d.id}
                        disabled={locked}
                        className="__sv2_demand"
                        onClick={() =>
                          change({
                            demand: d,
                            lines: (d.items ?? [])
                              .filter(
                                (i: any) => Number(i.remainingQty ?? i.qty) > 0,
                              )
                              .map((i: any) => ({
                                ...i,
                                sourceDemandItemId: i.id,
                                qty: String(i.remainingQty ?? i.qty),
                                price: __sv2_trim(
                                  i.agreedUnitPrice ?? i.unitPrice ?? "",
                                ),
                                shippedQty: 0,
                                allocations: [],
                              })),
                          })
                        }
                      >
                        {d.demandNo} · {d.projectName} · {d.items?.length ?? 0}
                        行
                      </button>
                    ))}
                    {form.demand ? (
                      <small>
                        已选 {form.demand.demandNo} · 版本{" "}
                        {form.demand.revision ?? 1}
                      </small>
                    ) : null}
                  </section>
                ) : null}
                <section className="crm-order-section">
                  <div className="__sv2_heading">
                    <strong>订单明细</strong>
                    <div className="__sv2_tax">
                      <span>销售口径</span>
                      <select
                        className="crm-input"
                        aria-label="销售含税口径"
                        disabled={
                          locked ||
                          (!isNew &&
                            !order?.salesTaxMode &&
                            !order?.companyStockAllocated) ||
                          (form.source === "demand" && isNew)
                        }
                        value={form.salesTaxMode}
                        onChange={(e: any) =>
                          change({ salesTaxMode: e.target.value })
                        }
                      >
                        {!form.salesTaxMode ? (
                          <option value="">待核</option>
                        ) : null}
                        <option value="tax_included">含税</option>
                        <option value="tax_excluded">未税</option>
                      </select>
                      <span>税率</span>
                      <input
                        className="crm-input"
                        aria-label="销售税率"
                        value="13"
                        disabled
                        title="后端现行固定13%"
                      />
                      <span>%</span>
                    </div>
                  </div>
                  {isNew && form.source === "company_stock" ? (
                    <div className="__sv2_lotbar">
                      <__sv2_Input
                        label="输入料号搜索库存"
                        value={lotSearch}
                        disabled={locked || !form.customerId}
                        onChange={(v: any) => {
                          setLotSearch(v);
                          setLotKeyword(v);
                          setLotPage(1);
                          setPicker("new");
                        }}
                        placeholder="输入料号，选择批次自动带出品牌 / DC"
                      />
                      <__sv2_Button
                        disabled={locked || !form.customerId}
                        onClick={() => {
                          setPicker("new");
                          setLotKeyword(lotSearch);
                          setLotPage(1);
                        }}
                      >
                        ＋ 添加物料
                      </__sv2_Button>
                    </div>
                  ) : null}
                  {picker !== null && !locked ? (
                    <div className="__sv2_picker">
                      <div className="__sv2_heading">
                        <strong>选择公司库存批次</strong>
                        <button
                          type="button"
                          className="__sv2_link"
                          onClick={() => setPicker(null)}
                        >
                          收起
                        </button>
                      </div>
                      {typeof picker === "number" ? (
                        <__sv2_Input
                          label="批次搜索料号"
                          value={lotSearch}
                          onChange={(v: any) => {
                            setLotSearch(v);
                            setLotKeyword(v);
                            setLotPage(1);
                          }}
                          placeholder="料号 / 品牌 / DC"
                        />
                      ) : null}
                      {lots.isError ? (
                        <p role="alert" className="__sv2_red">
                          {__sv2_error(lots.error)}
                        </p>
                      ) : null}
                      {lots.isFetching ? (
                        <p>正在读取可售批次…</p>
                      ) : (
                        (lots.data?.items ?? []).map((l: any) => (
                          <button
                            type="button"
                            key={l.lotId}
                            className="__sv2_lot"
                            onClick={() => addLot(l)}
                          >
                            <strong>{l.partNumber}</strong>
                            <span>
                              {l.brand} / DC {l.dc || "—"} / 批次 #{l.lotId} /
                              入库 #{l.inboundOrderId}
                            </span>
                            <b>可售 {l.availableQty}</b>
                          </button>
                        ))
                      )}
                      <div className="__sv2_heading">
                        <__sv2_Button
                          disabled={lotPage <= 1}
                          onClick={() => setLotPage(lotPage - 1)}
                        >
                          上一页
                        </__sv2_Button>
                        <small>共 {lots.data?.total ?? 0} 个批次</small>
                        <__sv2_Button
                          disabled={lotPage * 20 >= (lots.data?.total ?? 0)}
                          onClick={() => setLotPage(lotPage + 1)}
                        >
                          下一页
                        </__sv2_Button>
                      </div>
                    </div>
                  ) : null}
                  <div className="__sv2_tw">
                    <table className="__sv2_table __sv2_items">
                      <thead>
                        <tr>
                          <th>型号 / 品牌 / 批次</th>
                          <th>可售</th>
                          <th>已出</th>
                          <th>销售数量</th>
                          <th>销售单价</th>
                          <th>金额</th>
                          <th>操作</th>
                        </tr>
                      </thead>
                      <tbody>
                        {form.lines.length ? (
                          form.lines.map((l: any, k: any) => {
                            const cost =
                                l.unitCost ?? l.allocations?.[0]?.unitCost,
                              priceValid = __sv2_PRICE.test(String(l.price)),
                              qtyValid = /^\d+$/.test(String(l.qty));
                            return (
                              <tr key={l.orderItemId ?? k}>
                                <td>
                                  <strong>{l.partNumber}</strong>
                                  <small>
                                    {[l.brand, l.pkg, l.dc ? "DC " + l.dc : ""]
                                      .filter(Boolean)
                                      .join(" / ")}
                                  </small>
                                  {(l.allocations ?? []).map(
                                    (x: any, j: any) => (
                                      <div
                                        className="__sv2_allocation"
                                        key={x.lotId}
                                      >
                                        <small>
                                          批次 #{x.lotId}
                                          {isNew
                                            ? " · 可售 " + x.availableQty
                                            : " · 预留 " + (x.reservedQty ?? 0)}
                                        </small>
                                        {isNew ? (
                                          <>
                                            <__sv2_Input
                                              label={
                                                "第" +
                                                (k + 1) +
                                                "行批次" +
                                                (j + 1) +
                                                "分配数量"
                                              }
                                              inputMode="numeric"
                                              value={x.qty}
                                              disabled={locked}
                                              onChange={(v: any) =>
                                                changeLine(k, {
                                                  allocations:
                                                    l.allocations.map(
                                                      (y: any, n: any) =>
                                                        n === j
                                                          ? { ...y, qty: v }
                                                          : y,
                                                    ),
                                                })
                                              }
                                            />
                                            <button
                                              type="button"
                                              className="__sv2_link"
                                              disabled={locked}
                                              onClick={() =>
                                                changeLine(k, {
                                                  allocations:
                                                    l.allocations.filter(
                                                      (_: any, n: any) =>
                                                        n !== j,
                                                    ),
                                                })
                                              }
                                            >
                                              移除批次
                                            </button>
                                          </>
                                        ) : null}
                                      </div>
                                    ),
                                  )}
                                  {cost != null ? (
                                    <small className="__sv2_blue">
                                      单件成本（含采购费用）
                                      {__sv2_money(cost, 4)}
                                      {priceValid
                                        ? " · 单件差价 " +
                                          __sv2_money(
                                            __sv2_micro(l.price) -
                                              __sv2_micro(cost),
                                            4,
                                          )
                                        : ""}
                                    </small>
                                  ) : null}
                                  {l.shippedQty > 0 ? (
                                    <small>已出货，料号/品牌/DC锁定</small>
                                  ) : null}
                                  {isNew && form.source === "company_stock" ? (
                                    <button
                                      type="button"
                                      className="__sv2_link"
                                      disabled={locked}
                                      onClick={() => {
                                        setPicker(k);
                                        setLotSearch(l.partNumber);
                                        setLotKeyword(l.partNumber);
                                        setLotPage(1);
                                      }}
                                    >
                                      ＋ 分配更多同物料批次
                                    </button>
                                  ) : null}
                                </td>
                                <td className="__sv2_n">
                                  {form.source === "company_stock"
                                    ? availableFor(l)
                                    : "—"}
                                </td>
                                <td className="__sv2_n">{l.shippedQty ?? 0}</td>
                                <td>
                                  <__sv2_Input
                                    label={"第" + (k + 1) + "行销售数量"}
                                    inputMode="numeric"
                                    value={l.qty}
                                    disabled={locked}
                                    className={
                                      "crm-input " +
                                      (Number(l.qty) < Number(l.shippedQty ?? 0)
                                        ? "__sv2_invalid"
                                        : "")
                                    }
                                    onChange={(v: any) =>
                                      changeLine(k, {
                                        qty: v,
                                        ...(isNew && l.allocations.length === 1
                                          ? {
                                              allocations: [
                                                { ...l.allocations[0], qty: v },
                                              ],
                                            }
                                          : {}),
                                      })
                                    }
                                  />
                                  {Number(l.qty) < Number(l.shippedQty ?? 0) ? (
                                    <small className="__sv2_red">
                                      不能少于已出货 {l.shippedQty}
                                    </small>
                                  ) : null}
                                </td>
                                <td>
                                  <__sv2_Input
                                    label={"第" + (k + 1) + "行销售单价"}
                                    inputMode="decimal"
                                    value={l.price}
                                    disabled={locked}
                                    onChange={(v: any) =>
                                      changeLine(k, { price: v })
                                    }
                                  />
                                </td>
                                <td className="__sv2_n">
                                  {priceValid && qtyValid
                                    ? __sv2_money(
                                        __sv2_micro(l.price) * BigInt(l.qty),
                                      )
                                    : "—"}
                                </td>
                                <td>
                                  {isNew ? (
                                    <button
                                      type="button"
                                      className="__sv2_link"
                                      disabled={locked}
                                      onClick={() =>
                                        change({
                                          lines: form.lines.filter(
                                            (_: any, j: any) => j !== k,
                                          ),
                                        })
                                      }
                                    >
                                      移除
                                    </button>
                                  ) : (
                                    <small title="现有改单接口不支持增删物料">
                                      —
                                    </small>
                                  )}
                                </td>
                              </tr>
                            );
                          })
                        ) : (
                          <tr>
                            <td colSpan={7} className="__sv2_muted">
                              {form.source === "company_stock"
                                ? "请先选择公司库存批次"
                                : "请选择关联需求"}
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                    <div className="__sv2_total">
                      <span>{form.lines.length} 行物料</span>
                      <span>
                        合计 <b>{totals.qty}</b> 件
                      </span>
                      <span>
                        金额 <b>{__sv2_money(totals.sales)}</b>
                      </span>
                    </div>
                  </div>
                  {!isNew && !readonly ? (
                    <small className="__sv2_muted">
                      现有接口仅支持数量、单价调整；物料身份/增删行/换批次尚不支持。
                    </small>
                  ) : null}
                </section>
                <__sv2_Expenses
                  rows={form.expenses}
                  disabled={locked}
                  onChange={(expenses: any) => change({ expenses })}
                />
                <details
                  className="crm-sales-orders-fold __sv2_note"
                  open={isNew ? true : undefined}
                >
                  <summary>客户确认说明{isNew ? "（必填）" : ""}</summary>
                  <textarea
                    className="crm-input"
                    aria-label="客户确认说明"
                    maxLength={500}
                    value={form.confirmationNote}
                    disabled={locked}
                    onChange={(e: any) =>
                      change({ confirmationNote: e.target.value })
                    }
                    placeholder="如：客户微信确认型号、数量、销售单价及交期"
                  />
                </details>
                {shipOpen &&
                !isNew &&
                !readonly &&
                order &&
                order.sourceType !== "company_stock" &&
                !order.companyStockAllocated ? (
                  <section className="aui-data-panel __sv2_card">
                    <div className="__sv2_heading">
                      <strong>需求采购订单交付</strong>
                      <small>沿用原批次分配 / 预留 / 出货流程</small>
                    </div>
                    <CompanyStockShipmentForm
                      order={order}
                      enabled={enabled && !busy && !diffs.length}
                      onSaved={async () => {
                        await refresh();
                        setShipOpen(false);
                        onChanged("出货已登记");
                      }}
                      onAllocated={async () => {
                        await refresh();
                        onChanged("公司库存已分配");
                      }}
                      onDirtyChange={() => {}}
                      onBusyChange={setBusy}
                      onCancel={() => setShipOpen(false)}
                    />
                  </section>
                ) : null}
                {isNew ? (
                  <label className="__sv2_confirmed">
                    <input
                      type="checkbox"
                      aria-label="客户已确认"
                      checked={form.customerConfirmed}
                      disabled={locked}
                      onChange={(e: any) =>
                        change({ customerConfirmed: e.target.checked })
                      }
                    />{" "}
                    客户已确认数量、销售价格与交期{" "}
                    <span className="__sv2_red">*</span>
                  </label>
                ) : null}
              </div>
              <aside className="__sv2_side">
                <__sv2_Finance
                  finance={finance}
                  totals={totals}
                  estimated={estimated}
                />
                {!finance && previewInput && preview.isFetching ? (
                  <small className="__sv2_muted">
                    正在预估（不按零成本计算）…
                  </small>
                ) : null}
                {preview.isError ? (
                  <small className="__sv2_muted">
                    利润预估暂不可用，保存后以服务器结果为准。
                  </small>
                ) : null}
                <section className="aui-data-panel __sv2_card">
                  <div className="__sv2_heading">
                    <strong>收款</strong>
                    {!isNew && !readonly ? (
                      <button
                        type="button"
                        className="__sv2_link"
                        disabled={busy}
                        onClick={() => setPayOpen(!payOpen)}
                      >
                        登记收款 ›
                      </button>
                    ) : null}
                  </div>
                  <small>
                    {order?.paymentStatus === "monthly"
                      ? "月结登记"
                      : order && __sv2_paid(order) > 0n
                        ? "已收 " + __sv2_money(__sv2_paid(order))
                        : "未收款"}
                  </small>
                  <div className="__sv2_bar">
                    <i
                      style={{
                        width:
                          order && __sv2_micro(order.totalAmount) > 0n
                            ? Number(
                                __sv2_div(
                                  __sv2_paid(order) * 10000n,
                                  __sv2_micro(order.totalAmount),
                                ),
                              ) /
                                100 +
                              "%"
                            : "0%",
                      }}
                    />
                  </div>
                  <div className="__sv2_three">
                    <div>
                      <span>应收</span>
                      <b>{__sv2_money(totals.sales)}</b>
                    </div>
                    <div>
                      <span>已收</span>
                      <b>{__sv2_money(order ? __sv2_paid(order) : 0n)}</b>
                    </div>
                    <div>
                      <span>待收</span>
                      <b className="__sv2_red">
                        {__sv2_money(
                          totals.sales === null
                            ? null
                            : totals.sales! - (order ? __sv2_paid(order) : 0n) >
                                0n
                              ? totals.sales! - (order ? __sv2_paid(order) : 0n)
                              : 0n,
                        )}
                      </b>
                    </div>
                  </div>
                  <div className="__sv2_records">
                    {order?.payments?.map((x: any) => (
                      <p key={x.id}>
                        {x.paymentDate}{" "}
                        {
                          ({ bank: "对公转账", cash: "现金", monthly: "月结" } as Record<string, string>)[
                            x.method
                          ]
                        }{" "}
                        {__sv2_money(x.amount)}
                        {x.note ? " · " + x.note : ""}
                      </p>
                    ))}
                  </div>
                  {payOpen && !readonly && order ? (
                    <div className="__sv2_inline">
                      <select
                        className="crm-input"
                        aria-label="收款方式"
                        value={pay.method}
                        disabled={busy}
                        onChange={(e: any) =>
                          setPay({ ...pay, method: e.target.value })
                        }
                      >
                        <option value="bank">对公转账</option>
                        <option value="cash">现金</option>
                        <option value="monthly">月结</option>
                      </select>
                      <__sv2_Input
                        label="收款金额"
                        value={pay.amount}
                        disabled={busy}
                        onChange={(v: any) => {
                          payRequest.current = null;
                          setPay({ ...pay, amount: v });
                        }}
                      />
                      <__sv2_Input
                        label="收款日期"
                        type="date"
                        value={pay.date}
                        disabled={busy}
                        onChange={(v: any) => setPay({ ...pay, date: v })}
                      />
                      <__sv2_Input
                        label="收款备注"
                        value={pay.note}
                        disabled={busy}
                        onChange={(v: any) => setPay({ ...pay, note: v })}
                      />
                      <__sv2_Button
                        primary
                        disabled={busy}
                        onClick={() => {
                          if (
                            !__sv2_PRICE.test(pay.amount) ||
                            __sv2_micro(pay.amount) <= 0n
                          ) {
                            setError("请输入有效的正数收款金额，最多4位小数。");
                            return;
                          }
                          payRequest.current ??= {
                            id: order.id,
                            version: order.version,
                            requestId: __sv2_id(),
                            method: pay.method,
                            amount: pay.amount,
                            paymentDate: pay.date,
                            note: pay.note,
                          };
                          action("payment", payRequest.current);
                        }}
                      >
                        确认收款
                      </__sv2_Button>
                    </div>
                  ) : null}
                </section>
                <section className="aui-data-panel __sv2_card">
                  <div className="__sv2_heading">
                    <strong>出货</strong>
                    {!isNew &&
                    !readonly &&
                    order?.shippedQty < order?.orderedQty ? (
                      <button
                        type="button"
                        className="__sv2_link"
                        disabled={busy}
                        onClick={() => setShipOpen(!shipOpen)}
                      >
                        登记出货 ›
                      </button>
                    ) : null}
                  </div>
                  <small>
                    {order?.shippedQty > 0
                      ? "已出 " + order.shippedQty
                      : "未出货"}{" "}
                    / {totals.qty}
                  </small>
                  <div className="__sv2_bar">
                    <i
                      style={{
                        width: totals.qty
                          ? Math.min(
                              100,
                              ((order?.shippedQty ?? 0) / totals.qty) * 100,
                            ) + "%"
                          : "0%",
                        background: "#059669",
                      }}
                    />
                  </div>
                  <div className="__sv2_three">
                    <div>
                      <span>订购</span>
                      <b>{totals.qty}</b>
                    </div>
                    <div>
                      <span>已出</span>
                      <b>{order?.shippedQty ?? 0}</b>
                    </div>
                    <div>
                      <span>待出</span>
                      <b>
                        {Math.max(0, totals.qty - (order?.shippedQty ?? 0))}
                      </b>
                    </div>
                  </div>
                  <div className="__sv2_records">
                    {order?.shipments?.map((s: any) => (
                      <p key={s.id}>
                        {__sv2_date(s.createdAt)}{" "}
                        {s.deliveryMethod === "pickup"
                          ? "自提"
                          : s.expressCo + " " + s.expressNo}{" "}
                        ·{" "}
                        {s.items
                          .map((x: any) => x.partNumber + "×" + x.qty)
                          .join("，")}
                      </p>
                    ))}
                  </div>
                  {shipOpen && !readonly && order ? (
                    <div className="__sv2_inline">
                      {order.companyStockAllocated ||
                      order.sourceType === "company_stock" ? (
                        <>
                          <select
                            className="crm-input"
                            aria-label="出货方式"
                            value={ship.method}
                            disabled={busy}
                            onChange={(e: any) =>
                              setShip({ ...ship, method: e.target.value })
                            }
                          >
                            <option value="pickup">自提</option>
                            <option value="express">快递</option>
                          </select>
                          {ship.method === "express" ? (
                            <>
                              <__sv2_Input
                                label="快递公司"
                                value={ship.company}
                                onChange={(v: any) =>
                                  setShip({ ...ship, company: v })
                                }
                              />
                              <__sv2_Input
                                label="快递单号"
                                value={ship.number}
                                onChange={(v: any) =>
                                  setShip({ ...ship, number: v })
                                }
                              />
                            </>
                          ) : null}
                          {order.companyStockAllocations
                            .filter((x: any) => x.reservedQty > 0)
                            .map((x: any) => (
                              <label key={x.id}>
                                {
                                  order.items.find(
                                    (i: any) => i.id === x.orderItemId,
                                  )?.partNumber
                                }{" "}
                                · 批次 #{x.lotId} · 待出 {x.reservedQty}
                                <__sv2_Input
                                  label={"批次" + x.lotId + "出货数量"}
                                  value={ship.qty[x.id] ?? ""}
                                  disabled={busy}
                                  onChange={(v: any) => {
                                    shipRequest.current = null;
                                    setShip({
                                      ...ship,
                                      qty: { ...ship.qty, [x.id]: v },
                                    });
                                  }}
                                />
                              </label>
                            ))}
                          <__sv2_Button
                            primary
                            disabled={busy}
                            onClick={() => {
                              const allocations =
                                order.companyStockAllocations.filter(
                                  (x: any) => Number(ship.qty[x.id]) > 0,
                                );
                              if (
                                !allocations.length ||
                                allocations.some(
                                  (x: any) =>
                                    !/^[1-9]\d*$/.test(ship.qty[x.id]) ||
                                    Number(ship.qty[x.id]) > x.reservedQty,
                                )
                              ) {
                                setError(
                                  "请选择出货数量，须为正整数且不超过批次待出数量。",
                                );
                                return;
                              }
                              if (
                                ship.method === "express" &&
                                (!ship.company.trim() || !ship.number.trim())
                              ) {
                                setError("请填写快递公司和快递单号。");
                                return;
                              }
                              shipRequest.current ??= {
                                id: order.id,
                                version: order.version,
                                requestId: __sv2_id(),
                                deliveryMethod: ship.method,
                                expressCo: ship.company,
                                expressNo: ship.number,
                                note: "",
                                items: allocations.map((x: any) => ({
                                  orderItemId: x.orderItemId,
                                  lotId: x.lotId,
                                  qty: Number(ship.qty[x.id]),
                                })),
                              };
                              action("shipment", shipRequest.current);
                            }}
                          >
                            确认出货
                          </__sv2_Button>
                        </>
                      ) : (
                        <p className="__sv2_muted">
                          需求订单尚未分配公司库存，请沿用原客户需求的采购/交付流程。当前不伪造批次或库存。
                        </p>
                      )}
                    </div>
                  ) : null}
                </section>
              </aside>
            </div>
          )}
        </div>
        <div className="__sv2_footer">
          <div className="__sv2_footnote">
            {error ? (
              <div role="alert" className="__sv2_red">
                {error}
              </div>
            ) : readonly ? (
              "订单" + __sv2_status(order) + "，仅可查看"
            ) : errors.length ? (
              errors[0]
            ) : diffs.length ? (
              "已修改 " + diffs.length + " 项"
            ) : (
              ""
            )}
          </div>
          {order && !readonly ? (
            <__sv2_Button
              danger
              disabled={
                locked || __sv2_paid(order) > 0n || order.shippedQty > 0
              }
              title={
                __sv2_paid(order) > 0n || order.shippedQty > 0
                  ? "已有收款或出货，不能取消订单"
                  : ""
              }
              onClick={() => setCancelOpen(true)}
            >
              取消订单
            </__sv2_Button>
          ) : null}
          <__sv2_Button disabled={busy || !!pending} onClick={close}>
            关闭
          </__sv2_Button>
          {!readonly ? (
            <>
              <__sv2_Button
                disabled={busy || !!pending || isNew}
                onClick={async () => {
                  if (
                    diffs.length &&
                    !globalThis.confirm("重新读取将替换未保存内容，确认继续？")
                  )
                    return;
                  try {
                    await refresh();
                    setError("已读取最新订单。");
                  } catch (err: any) {
                    setError(__sv2_error(err));
                  }
                }}
              >
                重新读取
              </__sv2_Button>
              <__sv2_Button
                primary
                disabled={
                  busy || !enabled || (!pending && !isNew && !diffs.length)
                }
                onClick={() => {
                  if (pending) {
                    submit();
                    return;
                  }
                  if (errors.length) {
                    setError(errors.join("；"));
                    return;
                  }
                  if (isNew) submit();
                  else {
                    setReason("");
                    setReview(true);
                  }
                }}
              >
                {busy
                  ? "保存中…"
                  : pending
                    ? "重试原请求"
                    : isNew
                      ? "保存订单"
                      : "保存修改"}
              </__sv2_Button>
            </>
          ) : null}
        </div>
        {review ? (
          <Dialog
            open={true}
            onOpenChange={(v: any) => {
              if (!v && !busy) setReview(false);
            }}
          >
            <DialogContent
              className="__sv2_scope __sv2_review"
              aria-describedby="__sv2_review_desc"
            >
              <DialogHeader>
                <DialogTitle>确认修改业务订单</DialogTitle>
              </DialogHeader>
              <p id="__sv2_review_desc" className="__sv2_muted">
                {order.orderNumber} · {order.customerName}
              </p>
              <div className="__sv2_tw">
                <table className="__sv2_table">
                  <thead>
                    <tr>
                      <th>项目</th>
                      <th>原值</th>
                      <th>新值</th>
                    </tr>
                  </thead>
                  <tbody>
                    {diffs.map((d: any, k: any) => (
                      <tr key={k}>
                        <td>{d[0]}</td>
                        <td className="__sv2_old">{d[1]}</td>
                        <td>
                          <b>{d[2]}</b>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="__sv2_impact">
                <p>
                  订单金额 {__sv2_money(order.totalAmount)} →{" "}
                  {__sv2_money(totals.sales)}；待收{" "}
                  {__sv2_money(__sv2_due(order))} →{" "}
                  {__sv2_money(totals.sales! - (order ? __sv2_paid(order) : 0n))}
                </p>
                {__sv2_known(order) ? (
                  <p>
                    净利润 {__sv2_money(order.profitBreakdown.netProfit)} →{" "}
                    {finance ? __sv2_money(finance.net) : "由服务器保存后核算"}
                    ；提成{" "}
                    {__sv2_money(
                      order.commissionPreview?.estimatedAmount,
                    )} → {finance ? __sv2_money(finance.com) : "由服务器核算"}
                    （预估）
                  </p>
                ) : null}
                {form.lines.map((l: any) => {
                  const delta = Number(l.qty) - l.orderedQty;
                  return delta && order.companyStockAllocated ? (
                    <p key={l.orderItemId}>
                      {l.partNumber}：{delta > 0 ? "追加" : "释放"}预留{" "}
                      {Math.abs(delta)} 件；已出货不变。
                    </p>
                  ) : null;
                })}
              </div>
              <label>
                修改原因 <span className="__sv2_red">*</span>
                <__sv2_Input
                  label="修改原因"
                  value={reason}
                  maxLength={200}
                  disabled={busy}
                  onChange={setReason}
                  placeholder="如：客户调整数量、单价或费用"
                />
              </label>
              {error ? (
                <p role="alert" className="__sv2_red">
                  {error}
                </p>
              ) : null}
              <div className="__sv2_reviewfoot">
                <__sv2_Button disabled={busy} onClick={() => setReview(false)}>
                  返回修改
                </__sv2_Button>
                <__sv2_Button
                  primary
                  disabled={busy || !reason.trim() || errors.length > 0}
                  onClick={submit}
                >
                  {busy ? "保存中…" : "确认保存"}
                </__sv2_Button>
              </div>
            </DialogContent>
          </Dialog>
        ) : null}
        {cancelOpen ? (
          <Dialog open={true} onOpenChange={setCancelOpen}>
            <DialogContent className="__sv2_scope __sv2_review">
              <DialogHeader>
                <DialogTitle>确认取消销售订单？</DialogTitle>
              </DialogHeader>
              <p>取消后释放库存预留且订单只读。已有收款或出货不得取消。</p>
              <__sv2_Input
                label="取消原因"
                value={cancelReason}
                maxLength={500}
                onChange={setCancelReason}
              />
              <__sv2_Button
                danger
                disabled={busy || !cancelReason.trim()}
                onClick={() =>
                  action("cancel", {
                    id: order.id,
                    version: order.version,
                    reason: cancelReason.trim(),
                  })
                }
              >
                确认取消订单
              </__sv2_Button>
            </DialogContent>
          </Dialog>
        ) : null}
        {history ? (
          <div
            className="__sv2_sheet"
            role="dialog"
            aria-label="修改记录时间线"
          >
            <header>
              <strong>修改记录 · {order.orderNumber}</strong>
              <button
                type="button"
                aria-label="关闭修改记录"
                className="__sv2_x"
                onClick={() => setHistory(false)}
              >
                ×
              </button>
            </header>
            <div>
              {(order.audits ?? []).map((x: any) => (
                <article key={x.id}>
                  <small>
                    {String(x.createdAt).replace("T", " ").slice(0, 19)}
                  </small>
                  <strong>
                    {x.actorName} ·{" "}
                    {({
                      created: "创建订单",
                      revised: "修改订单",
                      payment: "登记收款",
                      shipment: "登记出货",
                      cancelled: "取消订单",
                      expenses: "销售费用",
                    } as Record<string, string>)[x.action] ?? x.action}
                  </strong>
                  <p>{x.note}</p>
                </article>
              ))}
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
