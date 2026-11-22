export function createDemandRedesign(__live){
var __DRExports = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // ../channel-release-20261121-1837/manager/demand-redesign-entry.ts
  var demand_redesign_entry_exports = {};
  __export(demand_redesign_entry_exports, {
    CustomerDemandExactEntry: () => CustomerDemandExactEntry,
    ProcurementDemands: () => ProcurementDemands,
    customerDemandExactId: () => customerDemandExactId
  });

  // native-bridge:/home/ubuntu/work/channel-release-20261121-1837/manager/client/src/business/platform/client/src/hooks/usePageMemory
  var usePageMemory = __live.usePageMemory;
  var useRememberedState = __live.useRememberedState;
  var freshListOptions = __live.freshListOptions;
  var useRestoringListQuery = __live.useRestoringListQuery;

  // native-bridge:react
  var useEffect = __live.React.useEffect;
  var useRef = __live.React.useRef;
  var useState = __live.React.useState;

  // native-bridge:/home/ubuntu/work/channel-release-20261121-1837/manager/client/src/business/BusinessScope
  var useBusinessScope = __live.useBusinessScope;

  // native-bridge:/home/ubuntu/work/channel-release-20261121-1837/manager/client/src/business/api/business-trpc
  var trpc = __live.trpc;

  // ../channel-release-20261121-1837/manager/client/src/business/platform/client/src/pages/procurementDemandReads.ts
  function isDemandAuthorizationError(error) {
    const value = error;
    const code = value?.data?.code ?? value?.shape?.data?.code;
    return ["UNAUTHORIZED", "FORBIDDEN", "NOT_FOUND"].includes(code ?? "") || [401, 403].includes(value?.data?.httpStatus ?? 0);
  }
  function useProcurementRead(query, key, ready, denied = false) {
    const proof = useRef({ key });
    if (proof.current.key !== key || !ready || denied || isDemandAuthorizationError(query.error))
      proof.current = { key };
    const fresh = ready && !denied && query.isSuccess === true && !query.error && !query.isError && !query.isFetching && !query.isLoading && !query.isPending && !query.isPlaceholderData && query.isFetchedAfterMount === true;
    if (fresh && query.data !== void 0) proof.current.data = query.data;
    return {
      data: proof.current.data,
      fresh,
      denied: denied || isDemandAuthorizationError(query.error)
    };
  }
  function useDocumentVisible() {
    const [visible, setVisible] = useState(
      () => typeof document !== "undefined" && document.visibilityState !== "hidden"
    );
    useEffect(() => {
      const update = () => setVisible(document.visibilityState !== "hidden");
      document.addEventListener("visibilitychange", update);
      return () => document.removeEventListener("visibilitychange", update);
    }, []);
    return visible;
  }
  function useProcurementArrivals(enabled, resetProof = false) {
    const visible = useDocumentVisible();
    const [baseline, setBaseline] = useState(
      void 0
    );
    const [count, setCount] = useState(0);
    const peek = trpc.customerDemand.procurementList.useQuery(
      {
        view: "all",
        keyword: "",
        sort: "latest",
        page: 1,
        pageSize: 1,
        ...resetProof || baseline === void 0 ? {} : { newSince: baseline }
      },
      {
        enabled: enabled && visible,
        staleTime: 0,
        refetchOnMount: "always",
        refetchInterval: enabled && visible ? 3e4 : false,
        refetchIntervalInBackground: false,
        retry: false,
        placeholderData: void 0
      }
    );
    const denied = isDemandAuthorizationError(peek.error);
    const valid = enabled && visible && peek.isSuccess === true && !peek.error && !peek.isError && !peek.isFetching && !peek.isPlaceholderData && peek.isFetchedAfterMount === true;
    useEffect(() => {
      if (denied || resetProof) {
        setBaseline(void 0);
        setCount(0);
        return;
      }
      if (!valid || !peek.data || !("latestSubmission" in peek.data)) return;
      if (baseline === void 0) {
        setBaseline(peek.data.latestSubmission);
        setCount(0);
      } else if (typeof peek.data.newCount === "number")
        setCount(Math.max(0, peek.data.newCount));
    }, [valid, denied, resetProof, peek.data, peek.dataUpdatedAt, baseline]);
    return {
      count: denied || resetProof || !enabled ? 0 : count,
      denied,
      error: enabled && !denied ? peek.error : null,
      retry: () => peek.refetch(),
      acknowledge: (displayedCursor) => {
        setCount(0);
        setBaseline(displayedCursor);
      }
    };
  }

  // native-bridge:/home/ubuntu/work/channel-release-20261121-1837/manager/client/src/components/admin/UnifiedAdminPage
  var AdminDataPanel = __live.AdminDataPanel;
  var AdminFilterBar = __live.AdminFilterBar;
  var AdminPage = __live.AdminPage;

  // native-bridge:/home/ubuntu/work/channel-release-20261121-1837/manager/client/src/lib/adminNewInformation
  var useAdminNewInformationContextRows = __live.useAdminNewInformationContextRows;

  // native-bridge:/home/ubuntu/work/channel-release-20261121-1837/manager/client/src/components/admin/AdminNewInformationBadge
  var AdminNewInformationRowBadge = __live.AdminNewInformationRowBadge;

  // native-bridge:lucide-react
  var ChevronLeft = __live.ChevronLeft;
  var ChevronRight = __live.ChevronRight;
  var Loader2 = __live.Loader2;
  var RefreshCw = __live.RefreshCw;
  var Search = __live.Search;
  var X = __live.X;

  // native-bridge:sonner
  var toast = __live.toast;

  // native-bridge:/home/ubuntu/work/channel-release-20261121-1837/manager/client/src/business/platform/shared/customerDemands
  var CUSTOMER_DEMAND_UNITS = __live.CUSTOMER_DEMAND_UNITS;

  // ../channel-release-20261121-1837/manager/client/src/business/platform/shared/beijingTime.ts
  var BEIJING_TIME_ZONE = "Asia/Shanghai";
  var LOCALE = "zh-CN";
  function toDate(value) {
    if (value === null || value === void 0 || value === "") return null;
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  function formatBeijingTime(value) {
    const date = toDate(value);
    if (!date) return "";
    return date.toLocaleTimeString(LOCALE, {
      timeZone: BEIJING_TIME_ZONE,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    });
  }
  function formatBeijingDate(value) {
    const date = toDate(value);
    if (!date) return "";
    return date.toLocaleDateString(LOCALE, {
      timeZone: BEIJING_TIME_ZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).replace(/\//g, "-");
  }
  function formatBeijingDateTime(value) {
    const date = toDate(value);
    if (!date) return "";
    const datePart = formatBeijingDate(date);
    const timePart = formatBeijingTime(date);
    return `${datePart} ${timePart}`;
  }
  function formatBeijingDateTimeWithSeconds(value) {
    const date = toDate(value);
    if (!date) return "";
    const datePart = formatBeijingDate(date);
    const timePart = date.toLocaleTimeString(LOCALE, {
      timeZone: BEIJING_TIME_ZONE,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false
    });
    return `${datePart} ${timePart}`;
  }

  // native-bridge:/home/ubuntu/work/channel-release-20261121-1837/manager/client/src/business/BusinessContentFrame
  var BusinessContentFrame_default = __live.PlatformLayout;

  // native-bridge:/home/ubuntu/work/channel-release-20261121-1837/manager/client/src/business/platform/client/src/components/customerDemands/DemandQuoteDialog
  var DemandQuoteDialog = __live.DemandQuoteDialog;

  // native-bridge:/home/ubuntu/work/channel-release-20261121-1837/manager/client/src/business/platform/client/src/components/customerDemands/DemandQuoteList
  var DemandQuoteList = __live.DemandQuoteList;

  // native-bridge:/home/ubuntu/work/channel-release-20261121-1837/manager/client/src/business/platform/client/src/components/ui/button
  var Button = __live.Button;

  // native-bridge:/home/ubuntu/work/channel-release-20261121-1837/manager/client/src/business/platform/client/src/components/ui/input
  var Input = __live.Input;

  // native-bridge:/home/ubuntu/work/channel-release-20261121-1837/manager/client/src/business/platform/client/src/components/ui/table
  var Table = __live.Table;
  var TableBody = __live.TableBody;
  var TableCell = __live.TableCell;
  var TableHead = __live.TableHead;
  var TableHeader = __live.TableHeader;
  var TableRow = __live.TableRow;

  // native-bridge:/home/ubuntu/work/channel-release-20261121-1837/manager/client/src/business/platform/client/src/components/ui/dialog
  var Dialog = __live.Dialog;
  var DialogContent = __live.DialogContent;
  var DialogDescription = __live.DialogDescription;
  var DialogTitle = __live.DialogTitle;

  // native-bridge:react/jsx-runtime
  var jsx = __live.jsx.jsx;
  var jsxs = __live.jsx.jsxs;
  var Fragment = __live.jsx.Fragment;

  // ../channel-release-20261121-1837/manager/client/src/business/platform/client/src/pages/ProcurementDemands.tsx
  var QUOTE_VIEW_OPTIONS = [
    { value: "all", label: "\u5168\u90E8\u9700\u6C42" },
    { value: "unquoted", label: "\u6211\u672A\u62A5\u4EF7" },
    { value: "quoted", label: "\u6211\u5DF2\u62A5\u4EF7" },
    { value: "reconfirm", label: "\u5F85\u91CD\u65B0\u786E\u8BA4" }
  ];
  var PAGE_SIZE = 20;
  var toolbarClass = "procurement-demand-control border-slate-300 bg-white px-3 text-slate-700 shadow-none hover:bg-slate-50 hover:text-slate-900";
  function quoteProgress(demand) {
    if ((demand.mySupplierCount ?? 0) > 0)
      return `${demand.mySupplierCount}\u5BB6 \xB7 \u7D2F\u8BA1${demand.myQuoteRoundCount ?? 0}\u8F6E`;
    return demand.myQuoteNeedsReconfirmation ? "\u5F85\u66F4\u65B0" : "\u5F85\u62A5\u4EF7";
  }
  function formatQty(value, unit) {
    return value == null ? "\u5F85\u786E\u8BA4" : `${value.toLocaleString("zh-CN")}${unit || "\u7247"}`;
  }
  function priorityLabel(priority) {
    return priority === "urgent" ? "\u7D27\u6025" : "\u666E\u901A";
  }
  function quoteable(demand) {
    return demand.status === "submitted" || demand.status === "processing";
  }
  function ProcurementDemandDetailDialog({
    id,
    onClose,
    onQuote
  }) {
    const detailQuery = trpc.customerDemand.procurementGet.useQuery(
      { id },
      { placeholderData: void 0, staleTime: 0, refetchOnMount: "always" }
    );
    const mismatch = Boolean(detailQuery.data && detailQuery.data.id !== id);
    const detailRead = useProcurementRead(
      detailQuery,
      String(id),
      true,
      mismatch
    );
    const detail = detailRead.data;
    return /* @__PURE__ */ jsx(
      Dialog,
      {
        open: true,
        onOpenChange: (open) => {
          if (!open) onClose();
        },
        children: /* @__PURE__ */ jsxs(
          DialogContent,
          {
            showCloseButton: false,
            className: "procurement-demands-detail flex min-w-0 max-h-[90dvh] w-[calc(100vw-32px)] max-w-[1100px] sm:max-w-[1100px] flex-col gap-0 overflow-hidden p-0",
            onEscapeKeyDown: (event) => {
              event.preventDefault();
              onClose();
            },
            onInteractOutside: (event) => {
              event.preventDefault();
              onClose();
            },
            children: [
              /* @__PURE__ */ jsxs("div", { className: "flex min-w-0 shrink-0 items-center justify-between gap-3 border-b border-slate-200 px-4 py-3", children: [
                /* @__PURE__ */ jsxs("div", { className: "min-w-0", children: [
                  /* @__PURE__ */ jsx(DialogTitle, { children: "\u91C7\u8D2D\u9700\u6C42\u8BE6\u60C5" }),
                  /* @__PURE__ */ jsx(DialogDescription, { className: "sr-only", children: "\u67E5\u770B\u9700\u6C42\u57FA\u672C\u4FE1\u606F\u3001\u7269\u6599\u660E\u7EC6\u4E0E\u4F9B\u5E94\u5546\u62A5\u4EF7" })
                ] }),
                /* @__PURE__ */ jsx(
                  "button",
                  {
                    type: "button",
                    "aria-label": "\u5173\u95ED\u91C7\u8D2D\u9700\u6C42\u8BE6\u60C5",
                    onClick: onClose,
                    className: "procurement-demand-close shrink-0 rounded text-slate-600 hover:bg-slate-100",
                    children: /* @__PURE__ */ jsx(X, { className: "h-4 w-4" })
                  }
                )
              ] }),
              /* @__PURE__ */ jsxs("div", { className: "min-h-0 min-w-0 flex-1 overflow-y-auto px-4 py-3", children: [
                !detail && !detailQuery.error && /* @__PURE__ */ jsxs("div", { className: "admin-cell-secondary flex items-center gap-2 py-8", children: [
                  /* @__PURE__ */ jsx(Loader2, { className: "h-4 w-4 animate-spin" }),
                  "\u6B63\u5728\u52A0\u8F7D\u9700\u6C42\u2026"
                ] }),
                mismatch && /* @__PURE__ */ jsx("p", { role: "alert", className: "text-red-600", children: "\u9700\u6C42\u4E0A\u4E0B\u6587\u4E0D\u4E00\u81F4\uFF0C\u8BF7\u5173\u95ED\u540E\u91CD\u65B0\u6253\u5F00\u3002" }),
                detailQuery.error && /* @__PURE__ */ jsx(
                  "p",
                  {
                    role: "alert",
                    className: "rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700",
                    children: detailQuery.error.message || "\u9700\u6C42\u52A0\u8F7D\u5931\u8D25"
                  }
                ),
                detail && /* @__PURE__ */ jsxs(Fragment, { children: [
                  /* @__PURE__ */ jsxs("div", { className: "procurement-demand-metadata grid gap-3 border-b border-slate-100 pb-3 sm:grid-cols-3 lg:grid-cols-4", children: [
                    /* @__PURE__ */ jsxs("div", { children: [
                      /* @__PURE__ */ jsx("p", { className: "admin-cell-secondary", children: "\u9700\u6C42\u7F16\u53F7" }),
                      /* @__PURE__ */ jsx("p", { className: "admin-cell-primary mt-1 break-all", children: detail.demandNo })
                    ] }),
                    /* @__PURE__ */ jsxs("div", { children: [
                      /* @__PURE__ */ jsx("p", { className: "admin-cell-secondary", children: "\u9879\u76EE" }),
                      /* @__PURE__ */ jsx("p", { className: "mt-1", children: detail.projectName || "\u2014" })
                    ] }),
                    /* @__PURE__ */ jsxs("div", { children: [
                      /* @__PURE__ */ jsx("p", { className: "admin-cell-secondary", children: "\u63D0\u4EA4\u65F6\u95F4" }),
                      /* @__PURE__ */ jsx("p", { className: "mt-1 tabular-nums", children: formatBeijingDateTimeWithSeconds(detail.submittedAt) || "\u2014" })
                    ] }),
                    /* @__PURE__ */ jsxs("div", { children: [
                      /* @__PURE__ */ jsx("p", { className: "admin-cell-secondary", children: "\u5F55\u5165\u65F6\u95F4" }),
                      /* @__PURE__ */ jsx("p", { className: "mt-1 tabular-nums", children: formatBeijingDateTimeWithSeconds(detail.createdAt) || "\u2014" })
                    ] }),
                    /* @__PURE__ */ jsxs("div", { children: [
                      /* @__PURE__ */ jsx("p", { className: "admin-cell-secondary", children: "\u9500\u552E" }),
                      /* @__PURE__ */ jsx("p", { className: "mt-1", children: detail.salesName || "\u2014" })
                    ] }),
                    /* @__PURE__ */ jsxs("div", { children: [
                      /* @__PURE__ */ jsx("p", { className: "admin-cell-secondary", children: "\u4F18\u5148\u7EA7" }),
                      /* @__PURE__ */ jsx(
                        "p",
                        {
                          className: `mt-1 ${detail.priority === "urgent" ? "font-medium text-red-600" : "text-slate-700"}`,
                          children: priorityLabel(detail.priority)
                        }
                      )
                    ] }),
                    /* @__PURE__ */ jsxs("div", { children: [
                      /* @__PURE__ */ jsx("p", { className: "admin-cell-secondary", children: "\u8981\u6C42\u56DE\u590D\u65F6\u95F4" }),
                      /* @__PURE__ */ jsx("p", { className: "mt-1", children: formatBeijingDateTime(detail.replyDueAt) || "\u2014" })
                    ] })
                  ] }),
                  /* @__PURE__ */ jsxs("div", { className: "mt-3", children: [
                    /* @__PURE__ */ jsxs("h3", { className: "admin-section-title mb-2", children: [
                      "\u7269\u6599\u660E\u7EC6\uFF08\u5171",
                      detail.items.length,
                      "\u9879\uFF09"
                    ] }),
                    /* @__PURE__ */ jsx("div", { className: "overflow-x-auto rounded border border-slate-200", children: /* @__PURE__ */ jsxs("table", { className: "admin-table-readable procurement-demand-items w-full table-fixed", children: [
                      /* @__PURE__ */ jsxs("colgroup", { children: [
                        /* @__PURE__ */ jsx("col", { className: "w-[24%]" }),
                        /* @__PURE__ */ jsx("col", { className: "w-[13%]" }),
                        /* @__PURE__ */ jsx("col", { className: "w-[11%]" }),
                        /* @__PURE__ */ jsx("col", { className: "w-[10%]" }),
                        /* @__PURE__ */ jsx("col", { className: "w-[7%]" }),
                        /* @__PURE__ */ jsx("col", { className: "w-[15%]" }),
                        /* @__PURE__ */ jsx("col", { className: "w-[20%]" })
                      ] }),
                      /* @__PURE__ */ jsx("thead", { children: /* @__PURE__ */ jsxs("tr", { className: "bg-slate-50 text-left", children: [
                        /* @__PURE__ */ jsx("th", { className: "px-2", children: "\u578B\u53F7" }),
                        /* @__PURE__ */ jsx("th", { className: "px-2", children: "\u54C1\u724C" }),
                        /* @__PURE__ */ jsx("th", { className: "px-2", children: "\u5C01\u88C5" }),
                        /* @__PURE__ */ jsx("th", { className: "px-2 text-right", children: "\u6570\u91CF" }),
                        /* @__PURE__ */ jsx("th", { className: "px-2", children: "\u5355\u4F4D" }),
                        /* @__PURE__ */ jsx("th", { className: "px-2", children: "\u8981\u6C42\u4EA4\u671F" }),
                        /* @__PURE__ */ jsx("th", { className: "px-2", children: "\u5907\u6CE8" })
                      ] }) }),
                      /* @__PURE__ */ jsx("tbody", { children: detail.items.map((item) => /* @__PURE__ */ jsxs(
                        "tr",
                        {
                          className: "border-t border-slate-100 text-slate-700",
                          children: [
                            /* @__PURE__ */ jsx("td", { className: "admin-cell-primary procurement-demand-model px-2 py-2", children: item.partNumber || "\u2014" }),
                            /* @__PURE__ */ jsx("td", { className: "px-2 py-2", children: item.brand || "\u2014" }),
                            /* @__PURE__ */ jsx("td", { className: "px-2 py-2", children: item.pkg || "\u2014" }),
                            /* @__PURE__ */ jsx("td", { className: "admin-cell-primary px-2 py-2 text-right tabular-nums", children: item.qty == null ? "\u5F85\u786E\u8BA4" : item.qty.toLocaleString("zh-CN") }),
                            /* @__PURE__ */ jsx("td", { className: "px-2 py-2", children: item.qtyUnit && CUSTOMER_DEMAND_UNITS.includes(
                              item.qtyUnit
                            ) ? item.qtyUnit : "\u2014" }),
                            /* @__PURE__ */ jsx("td", { className: "px-2 py-2", children: item.deliveryRequirement || "\u2014" }),
                            /* @__PURE__ */ jsx("td", { className: "whitespace-pre-wrap px-2 py-2", children: item.note || "\u2014" })
                          ]
                        },
                        item.id
                      )) })
                    ] }) })
                  ] }),
                  detail.note?.trim() ? /* @__PURE__ */ jsxs("div", { className: "mt-3", children: [
                    /* @__PURE__ */ jsx("h3", { className: "admin-section-title", children: "\u9700\u6C42\u8BF4\u660E" }),
                    /* @__PURE__ */ jsx("p", { className: "mt-1 whitespace-pre-wrap rounded border border-slate-200 bg-slate-50 px-3 py-2 leading-6 text-slate-700", children: detail.note })
                  ] }) : null,
                  /* @__PURE__ */ jsx(
                    DemandQuoteList,
                    {
                      demandId: id,
                      audience: "procurement",
                      canWrite: quoteable(detail),
                      onCreate: () => {
                        if (quoteable(detail)) onQuote();
                      },
                      onEdit: (quoteId) => {
                        if (quoteable(detail)) onQuote(quoteId);
                      }
                    }
                  )
                ] })
              ] }),
              /* @__PURE__ */ jsx("div", { className: "flex min-w-0 shrink-0 justify-end gap-2 border-t border-slate-200 bg-white px-4 py-3", children: /* @__PURE__ */ jsx(
                Button,
                {
                  type: "button",
                  size: "default",
                  variant: "outline",
                  onClick: onClose,
                  className: "procurement-demand-control bg-white",
                  children: "\u5173\u95ED"
                }
              ) })
            ]
          }
        )
      }
    );
  }
  function ProcurementDemands() {
    const scope = useBusinessScope();
    return /* @__PURE__ */ jsx(
      ProcurementDemandsSession,
      {},
      `${scope.storageScope}|${scope.contextVerification.authorizationVersion}`
    );
  }
  function ProcurementDemandsSession() {
    const d51Ready = usePageMemory();
    const [viewMemory, setView] = useRememberedState("view", "all");
    const view = viewMemory === "mine" ? "quoted" : viewMemory === "unassigned" ? "unquoted" : QUOTE_VIEW_OPTIONS.some((option) => option.value === viewMemory) ? viewMemory : "all";
    const [sortMemory, setSort] = useRememberedState(
      "sort",
      "latest"
    );
    const sort = sortMemory === "urgent" ? "urgent" : "latest";
    const [keywordInput, setKeywordInput] = useRememberedState(
      "keywordInput",
      ""
    );
    const [keyword, setKeyword] = useRememberedState("keyword", "");
    const [page, setPage] = useRememberedState("page", 1);
    const [openedId, setOpenedId] = useState(null);
    const [quoteTarget, setQuoteTarget] = useState(null);
    const [latestIntent, setLatestIntent] = useState(null);
    const listInput = { view, sort, keyword, page, pageSize: PAGE_SIZE };
    const rawListQuery = trpc.customerDemand.procurementList.useQuery(
      listInput,
      freshListOptions({ placeholderData: void 0 }, d51Ready)
    );
    const mainRead = useProcurementRead(
      rawListQuery,
      JSON.stringify(listInput),
      d51Ready
    );
    const arrivals = useProcurementArrivals(
      d51Ready && mainRead.data !== void 0 && !mainRead.denied,
      mainRead.denied || !d51Ready
    );
    const denied = mainRead.denied || arrivals.denied;
    const result = denied ? void 0 : mainRead.data;
    const listQuery = useRestoringListQuery(
      rawListQuery,
      result !== void 0 && !denied
    );
    const items = result?.items ?? [];
    const currentPage = result?.page ?? page;
    const totalPages = Math.max(1, Math.ceil((result?.total ?? 0) / PAGE_SIZE));
    const listReady = d51Ready && !denied && mainRead.fresh && result !== void 0;
    const newInformationRows = useAdminNewInformationContextRows({
      module: "procurement",
      refs: listReady ? items.map((demand) => `demand:${demand.id}`) : [],
      listReady
    });
    useEffect(() => {
      if (result?.page && result.page !== page) setPage(result.page);
    }, [result?.page, page]);
    useEffect(() => {
      if (denied || !d51Ready) {
        setOpenedId(null);
        setQuoteTarget(null);
        setLatestIntent(null);
      }
    }, [denied, d51Ready]);
    useEffect(() => {
      if (!latestIntent || !listReady || !result || view !== "all" || sort !== "latest" || keyword !== "" || page !== 1 || result.page !== 1 || !("latestSubmission" in result) || rawListQuery.dataUpdatedAt < latestIntent.requestedAt || rawListQuery.dataUpdatedAt <= latestIntent.priorDataUpdatedAt) return;
      arrivals.acknowledge(result.latestSubmission);
      setLatestIntent(null);
    }, [latestIntent, listReady, result, view, sort, keyword, page, rawListQuery.dataUpdatedAt]);
    const chooseView = (next) => {
      setLatestIntent(null);
      setView(next);
      setPage(1);
    };
    const search = () => {
      setLatestIntent(null);
      setKeyword(keywordInput.trim());
      setPage(1);
    };
    const latest = () => {
      const unchanged = view === "all" && sort === "latest" && keyword === "" && page === 1;
      setLatestIntent({
        requestedAt: Date.now(),
        priorDataUpdatedAt: rawListQuery.dataUpdatedAt
      });
      setKeywordInput("");
      setKeyword("");
      setView("all");
      setSort("latest");
      setPage(1);
      window.scrollTo?.({ top: 0, left: 0 });
      if (unchanged) void manualRefresh();
    };
    const manualRefresh = async () => {
      try {
        const refreshed = await listQuery.refetch();
        if (refreshed?.error || refreshed?.isError)
          toast.error("\u5237\u65B0\u5931\u8D25\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5");
      } catch {
        toast.error("\u5237\u65B0\u5931\u8D25\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5");
      }
    };
    const ordinaryFailure = !denied && Boolean(listQuery.error) && result !== void 0;
    const appliedView = QUOTE_VIEW_OPTIONS.find((option) => option.value === view)?.label ?? "\u5168\u90E8\u9700\u6C42";
    const unapplied = keywordInput.trim() !== keyword;
    return /* @__PURE__ */ jsx(BusinessContentFrame_default, { children: /* @__PURE__ */ jsxs(AdminPage, { className: "procurement-demands-page", "aria-label": "\u91C7\u8D2D\u5185\u90E8\u9700\u6C42", children: [
      /* @__PURE__ */ jsxs(AdminFilterBar, { className: "mb-3 flex flex-wrap items-center gap-2", children: [
        /* @__PURE__ */ jsx(
          "label",
          {
            htmlFor: "procurement-demand-view",
            className: "admin-cell-secondary",
            children: "\u53EF\u62A5\u4EF7\u9700\u6C42"
          }
        ),
        /* @__PURE__ */ jsx(
          "select",
          {
            id: "procurement-demand-view",
            "aria-label": "\u91C7\u8D2D\u62A5\u4EF7\u89C6\u56FE",
            value: view,
            onChange: (event) => {
              const next = QUOTE_VIEW_OPTIONS.find(
                (option) => option.value === event.target.value
              )?.value;
              if (next) chooseView(next);
            },
            className: "procurement-demand-control rounded-md border border-slate-300 bg-white px-3 text-slate-700",
            children: QUOTE_VIEW_OPTIONS.map((option) => /* @__PURE__ */ jsx("option", { value: option.value, children: option.label }, option.value))
          }
        ),
        /* @__PURE__ */ jsx(
          "label",
          {
            htmlFor: "procurement-demand-sort",
            className: "admin-cell-secondary",
            children: "\u6392\u5E8F"
          }
        ),
        /* @__PURE__ */ jsxs(
          "select",
          {
            id: "procurement-demand-sort",
            "aria-label": "\u91C7\u8D2D\u9700\u6C42\u6392\u5E8F",
            value: sort,
            onChange: (event) => {
              setSort(event.target.value === "urgent" ? "urgent" : "latest");
              setPage(1);
            },
            className: "procurement-demand-control rounded-md border border-slate-300 bg-white px-3 text-slate-700",
            children: [
              /* @__PURE__ */ jsx("option", { value: "latest", children: "\u6700\u65B0\u63D0\u4EA4" }),
              /* @__PURE__ */ jsx("option", { value: "urgent", children: "\u7D27\u6025\u4F18\u5148" })
            ]
          }
        ),
        /* @__PURE__ */ jsxs("div", { className: "ml-auto flex w-full min-w-0 flex-wrap items-center gap-2 sm:w-auto sm:flex-1", children: [
          /* @__PURE__ */ jsx(
            Input,
            {
              "aria-label": "\u641C\u7D22\u9700\u6C42\u7F16\u53F7\u6216\u578B\u53F7",
              value: keywordInput,
              onChange: (event) => setKeywordInput(event.target.value),
              onKeyDown: (event) => {
                if (event.key === "Enter") search();
              },
              placeholder: "\u641C\u7D22\u9700\u6C42\u7F16\u53F7\u6216\u578B\u53F7",
              className: "procurement-demand-control min-w-0 flex-1 bg-white sm:max-w-[320px]"
            }
          ),
          /* @__PURE__ */ jsxs(
            Button,
            {
              type: "button",
              variant: "outline",
              onClick: search,
              className: toolbarClass,
              children: [
                /* @__PURE__ */ jsx(Search, { className: "mr-1 h-3.5 w-3.5" }),
                "\u641C\u7D22"
              ]
            }
          ),
          /* @__PURE__ */ jsx(
            Button,
            {
              type: "button",
              variant: "outline",
              onClick: latest,
              className: toolbarClass,
              children: "\u67E5\u770B\u6700\u65B0"
            }
          ),
          /* @__PURE__ */ jsxs(
            Button,
            {
              type: "button",
              variant: "outline",
              onClick: () => void manualRefresh(),
              disabled: !d51Ready || Boolean(listQuery.isFetching),
              className: "procurement-demand-control border-[#185FA5]/40 bg-white text-[#185FA5] hover:bg-[#f5f9fd]",
              children: [
                /* @__PURE__ */ jsx(
                  RefreshCw,
                  {
                    className: `mr-1.5 h-3.5 w-3.5 ${listQuery.isFetching ? "animate-spin" : ""}`
                  }
                ),
                "\u624B\u52A8\u5237\u65B0"
              ]
            }
          )
        ] })
      ] }),
      /* @__PURE__ */ jsxs(
        "div",
        {
          className: "procurement-demand-conditions mb-3 flex flex-wrap items-center gap-x-4 gap-y-1",
          "aria-label": "\u5DF2\u5E94\u7528\u91C7\u8D2D\u6761\u4EF6",
          children: [
            /* @__PURE__ */ jsxs("span", { children: [
              "\u5DF2\u5E94\u7528\uFF1A",
              appliedView,
              " \xB7",
              " ",
              sort === "latest" ? "\u6700\u65B0\u63D0\u4EA4" : "\u7D27\u6025\u4F18\u5148",
              " \xB7",
              " ",
              keyword ? `\u641C\u7D22\u201C${keyword}\u201D` : "\u672A\u9650\u5236\u5173\u952E\u8BCD",
              " \xB7 \u7B2C",
              page,
              "\u9875"
            ] }),
            unapplied && /* @__PURE__ */ jsx("span", { className: "text-amber-700", children: "\u8F93\u5165\u5C1A\u672A\u5E94\u7528\uFF0C\u8BF7\u6309 Enter \u6216\u641C\u7D22" }),
            /* @__PURE__ */ jsx("span", { className: "admin-cell-secondary", children: "\u4EC5\u663E\u793A\u5F53\u524D\u8D26\u53F7\u83B7\u6388\u6743\u7684\u5185\u90E8\u5DF2\u63D0\u4EA4\u9700\u6C42\uFF1B\u4FDD\u7559\u672C\u9875\u7B5B\u9009\u3001\u9875\u7801\u4E0E\u8FD4\u56DE\u4F4D\u7F6E" })
          ]
        }
      ),
      !denied && arrivals.count > 0 && /* @__PURE__ */ jsxs(
        "div",
        {
          className: "procurement-demand-arrivals mb-3 flex flex-wrap items-center justify-between gap-2",
          "aria-live": "polite",
          children: [
            /* @__PURE__ */ jsxs("span", { children: [
              "\u6709 ",
              arrivals.count,
              " \u6761\u65B0\u9700\u6C42\uFF0C\u5217\u8868\u5C1A\u672A\u81EA\u52A8\u66F4\u65B0"
            ] }),
            /* @__PURE__ */ jsx(
              "button",
              {
                type: "button",
                className: "procurement-demand-text-link",
                onClick: latest,
                children: "\u67E5\u770B\u6700\u65B0\u9700\u6C42"
              }
            )
          ]
        }
      ),
      !denied && arrivals.error && /* @__PURE__ */ jsxs("div", { className: "procurement-demand-conditions mb-3", children: [
        "\u65B0\u9700\u6C42\u68C0\u67E5\u6682\u672A\u66F4\u65B0 \xB7",
        " ",
        /* @__PURE__ */ jsx(
          "button",
          {
            type: "button",
            className: "procurement-demand-text-link",
            onClick: () => void arrivals.retry(),
            children: "\u91CD\u8BD5\u68C0\u67E5"
          }
        )
      ] }),
      /* @__PURE__ */ jsxs(AdminDataPanel, { className: "gap-0 overflow-hidden p-0", children: [
        ordinaryFailure && /* @__PURE__ */ jsxs(
          "div",
          {
            role: "alert",
            className: "procurement-demand-update-alert flex flex-wrap items-center gap-2 px-3 py-2",
            children: [
              "\u6682\u672A\u66F4\u65B0\uFF0C\u4EE5\u4E0B\u4FDD\u7559\u4E0A\u6B21\u6210\u529F\u6570\u636E \xB7",
              " ",
              listQuery.error?.message || "\u5237\u65B0\u5931\u8D25",
              /* @__PURE__ */ jsx(
                "button",
                {
                  type: "button",
                  onClick: () => void manualRefresh(),
                  className: "procurement-demand-text-link",
                  children: "\u91CD\u8BD5\u5237\u65B0"
                }
              )
            ]
          }
        ),
        denied ? /* @__PURE__ */ jsxs("div", { role: "alert", className: "p-4 text-red-600", children: [
          "\u5F53\u524D\u9700\u6C42\u6388\u6743\u5DF2\u5931\u6548\uFF0C\u8BF7\u91CD\u65B0\u6838\u9A8C\u6743\u9650\u540E\u91CD\u8BD5\u3002",
          /* @__PURE__ */ jsx(
            "button",
            {
              type: "button",
              className: "procurement-demand-text-link ml-2",
              onClick: () => void manualRefresh(),
              children: "\u91CD\u8BD5"
            }
          )
        ] }) : !d51Ready || !result && !listQuery.error ? /* @__PURE__ */ jsxs("div", { className: "admin-cell-secondary flex items-center justify-center gap-2 py-12", children: [
          /* @__PURE__ */ jsx(Loader2, { className: "h-4 w-4 animate-spin" }),
          "\u6B63\u5728\u52A0\u8F7D\u91C7\u8D2D\u9700\u6C42\u2026"
        ] }) : !result && listQuery.error ? /* @__PURE__ */ jsxs("div", { role: "alert", className: "p-4 text-red-600", children: [
          listQuery.error.message || "\u91C7\u8D2D\u9700\u6C42\u52A0\u8F7D\u5931\u8D25",
          /* @__PURE__ */ jsx(
            "button",
            {
              type: "button",
              onClick: () => void manualRefresh(),
              className: "procurement-demand-text-link ml-2",
              children: "\u91CD\u8BD5\u5237\u65B0"
            }
          )
        ] }) : items.length === 0 ? /* @__PURE__ */ jsxs("div", { className: "p-12 text-center", children: [
          /* @__PURE__ */ jsx("p", { className: "admin-cell-primary", children: "\u6682\u65E0\u9700\u6C42" }),
          /* @__PURE__ */ jsx("p", { className: "admin-cell-secondary mt-1", children: "\u5F53\u524D\u7B5B\u9009\u6761\u4EF6\u4E0B\u6CA1\u6709\u53EF\u62A5\u4EF7\u7684\u5185\u90E8\u9700\u6C42\uFF0C\u53EF\u70B9\u51FB\u201C\u67E5\u770B\u6700\u65B0\u201D\u6E05\u9664\u65E7\u6761\u4EF6" })
        ] }) : /* @__PURE__ */ jsxs(
          Table,
          {
            className: "admin-table-readable procurement-demands-table table-fixed",
            containerClassName: "procurement-demands-table-scroll",
            children: [
              /* @__PURE__ */ jsxs("colgroup", { children: [
                /* @__PURE__ */ jsx("col", {}),
                /* @__PURE__ */ jsx("col", { className: "w-[160px]" }),
                /* @__PURE__ */ jsx("col", { className: "w-[210px]" }),
                /* @__PURE__ */ jsx("col", { className: "w-[170px]" }),
                /* @__PURE__ */ jsx("col", { className: "w-[110px]" })
              ] }),
              /* @__PURE__ */ jsx(TableHeader, { children: /* @__PURE__ */ jsxs(TableRow, { className: "bg-slate-50 hover:bg-slate-50", children: [
                /* @__PURE__ */ jsx(TableHead, { children: "\u7269\u6599" }),
                /* @__PURE__ */ jsx(TableHead, { children: "\u6570\u91CF / \u4EA4\u671F" }),
                /* @__PURE__ */ jsx(TableHead, { children: "\u63D0\u4EA4\u4FE1\u606F" }),
                /* @__PURE__ */ jsx(TableHead, { children: "\u672C\u4EBA\u62A5\u4EF7" }),
                /* @__PURE__ */ jsx(TableHead, { className: "text-right", children: "\u62A5\u4EF7" })
              ] }) }),
              /* @__PURE__ */ jsx(TableBody, { children: items.map((demand) => {
                const material = demand.matchedItem ?? {
                  partNumber: demand.firstPartNumber,
                  brand: demand.firstBrand,
                  qty: demand.firstQty,
                  qtyUnit: demand.firstQtyUnit,
                  deliveryRequirement: demand.firstDeliveryRequirement
                };
                const submitted = formatBeijingDateTime(demand.submittedAt);
                return /* @__PURE__ */ jsxs(
                  TableRow,
                  {
                    ref: newInformationRows.getRow(`demand:${demand.id}`).ref,
                    "data-page-memory-row": String(demand.id),
                    children: [
                      /* @__PURE__ */ jsxs(TableCell, { children: [
                        /* @__PURE__ */ jsxs("div", { className: "flex flex-wrap items-center gap-x-2 gap-y-1", children: [
                          /* @__PURE__ */ jsx(
                            "button",
                            {
                              type: "button",
                              onClick: () => setOpenedId(demand.id),
                              className: "admin-cell-primary procurement-demand-model procurement-demand-text-link",
                              "aria-label": `\u67E5\u770B\u9700\u6C42 ${demand.demandNo} \u7684\u578B\u53F7\u8BE6\u60C5`,
                              children: material.partNumber || "\u67E5\u770B\u7269\u6599\u8BE6\u60C5"
                            }
                          ),
                          /* @__PURE__ */ jsx(
                            AdminNewInformationRowBadge,
                            {
                              isNew: newInformationRows.getRow(`demand:${demand.id}`).isNew
                            }
                          ),
                          demand.priority === "urgent" && /* @__PURE__ */ jsx("span", { className: "procurement-demand-priority text-red-600", children: "\u7D27\u6025" })
                        ] }),
                        /* @__PURE__ */ jsxs("div", { className: "admin-cell-secondary mt-1 procurement-demand-secondary-data", children: [
                          "\u54C1\u724C\uFF1A",
                          material.brand || "\u5F85\u786E\u8BA4"
                        ] }),
                        demand.itemCount > 1 && /* @__PURE__ */ jsx(
                          "button",
                          {
                            type: "button",
                            className: "admin-cell-secondary procurement-demand-text-link mt-1",
                            "aria-label": `\u67E5\u770B\u9700\u6C42 ${demand.demandNo} \u7684\u5168\u90E8${demand.itemCount}\u9879\u7269\u6599`,
                            onClick: () => setOpenedId(demand.id),
                            children: demand.matchedItem ? `\u547D\u4E2D\u7B2C${demand.matchedItem.index}\u9879 / \u5171${demand.itemCount}\u9879 \xB7 \u67E5\u770B\u5168\u90E8\u7269\u6599` : `\u5171${demand.itemCount}\u9879 \xB7 \u67E5\u770B\u5168\u90E8\u7269\u6599`
                          }
                        )
                      ] }),
                      /* @__PURE__ */ jsxs(TableCell, { children: [
                        /* @__PURE__ */ jsx("div", { className: "admin-cell-primary tabular-nums", children: formatQty(material.qty, material.qtyUnit) }),
                        /* @__PURE__ */ jsxs("div", { className: "admin-cell-secondary mt-1 procurement-demand-secondary-data", children: [
                          "\u4EA4\u671F\uFF1A",
                          material.deliveryRequirement || "\u5F85\u786E\u8BA4"
                        ] }),
                        /* @__PURE__ */ jsxs(
                          "div",
                          {
                            className: "admin-cell-secondary mt-1",
                            title: formatBeijingDateTime(demand.replyDueAt) || void 0,
                            children: [
                              "\u56DE\u590D\uFF1A",
                              formatBeijingDateTime(demand.replyDueAt) || "\u5F85\u786E\u8BA4"
                            ]
                          }
                        )
                      ] }),
                      /* @__PURE__ */ jsxs(TableCell, { children: [
                        /* @__PURE__ */ jsx(
                          "div",
                          {
                            className: "tabular-nums",
                            title: `\u63D0\u4EA4\u65F6\u95F4\uFF08\u5317\u4EAC\u65F6\u95F4\uFF09\uFF1A${formatBeijingDateTimeWithSeconds(demand.submittedAt) || "\u5F85\u786E\u8BA4"}`,
                            children: submitted || "\u63D0\u4EA4\u65F6\u95F4\u5F85\u786E\u8BA4"
                          }
                        ),
                        /* @__PURE__ */ jsx(
                          "button",
                          {
                            type: "button",
                            className: "procurement-demand-number procurement-demand-text-link mt-1",
                            "aria-label": `\u67E5\u770B\u9700\u6C42 ${demand.demandNo} \u8BE6\u60C5`,
                            onClick: () => setOpenedId(demand.id),
                            children: demand.demandNo
                          }
                        ),
                        /* @__PURE__ */ jsxs("div", { className: "admin-cell-secondary mt-1 procurement-demand-secondary-data", children: [
                          "\u9500\u552E\uFF1A",
                          demand.salesName || "\u2014"
                        ] })
                      ] }),
                      /* @__PURE__ */ jsxs(TableCell, { children: [
                        /* @__PURE__ */ jsx("div", { className: "font-medium", children: quoteProgress(demand) }),
                        demand.myQuoteNeedsReconfirmation && /* @__PURE__ */ jsx("div", { className: "procurement-demand-reconfirm mt-1", children: "\u65E7\u7248\u62A5\u4EF7\u5F85\u91CD\u65B0\u786E\u8BA4" }),
                        (demand.currentQuoteCount ?? 0) > 0 && /* @__PURE__ */ jsxs("div", { className: "admin-cell-secondary mt-1", children: [
                          "\u5168\u4F53\u5F53\u524D ",
                          demand.currentQuoteCount,
                          " \u4EFD"
                        ] })
                      ] }),
                      /* @__PURE__ */ jsx(TableCell, { className: "procurement-demand-actions text-right", children: /* @__PURE__ */ jsx(
                        Button,
                        {
                          type: "button",
                          variant: "outline",
                          size: "sm",
                          disabled: !quoteable(demand) || !listReady,
                          onClick: () => {
                            if (!quoteable(demand) || !listReady) return;
                            if (demand.myQuoteNeedsReconfirmation)
                              setOpenedId(demand.id);
                            else setQuoteTarget({ demandId: demand.id });
                          },
                          title: !quoteable(demand) ? "\u5F53\u524D\u9700\u6C42\u4E0D\u53EF\u62A5\u4EF7\uFF0C\u8BF7\u67E5\u770B\u8BE6\u60C5\u6838\u9A8C" : !listReady ? "\u6B63\u5728\u6838\u9A8C\u5F53\u524D\u9700\u6C42\uFF0C\u8BF7\u7A0D\u5019" : void 0,
                          className: "admin-row-action border-[#185FA5]/30 bg-white px-2.5 text-[#185FA5] hover:bg-[#f5f9fd]",
                          children: demand.myQuoteNeedsReconfirmation ? "\u66F4\u65B0\u62A5\u4EF7" : (demand.myActiveQuoteCount ?? 0) > 0 ? "\u65B0\u589E\u62A5\u4EF7" : "\u62A5\u4EF7"
                        }
                      ) })
                    ]
                  },
                  demand.id
                );
              }) })
            ]
          }
        ),
        result && (result.total ?? 0) > 0 && /* @__PURE__ */ jsxs("div", { className: "admin-cell-secondary flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-3 py-3", children: [
          /* @__PURE__ */ jsxs("span", { children: [
            "\u5171 ",
            result.total,
            " \u6761 \xB7 \u7B2C ",
            currentPage,
            "/",
            totalPages,
            " \u9875"
          ] }),
          /* @__PURE__ */ jsxs("div", { className: "flex items-center gap-2", children: [
            /* @__PURE__ */ jsxs(
              Button,
              {
                type: "button",
                size: "sm",
                variant: "outline",
                className: "admin-row-action bg-white px-2.5",
                disabled: currentPage <= 1 || Boolean(listQuery.isFetching),
                onClick: () => setPage(currentPage - 1),
                "aria-label": "\u4E0A\u4E00\u9875",
                children: [
                  /* @__PURE__ */ jsx(ChevronLeft, { className: "mr-1 h-3.5 w-3.5" }),
                  "\u4E0A\u4E00\u9875"
                ]
              }
            ),
            /* @__PURE__ */ jsxs(
              Button,
              {
                type: "button",
                size: "sm",
                variant: "outline",
                className: "admin-row-action bg-white px-2.5",
                disabled: currentPage >= totalPages || Boolean(listQuery.isFetching),
                onClick: () => setPage(currentPage + 1),
                "aria-label": "\u4E0B\u4E00\u9875",
                children: [
                  "\u4E0B\u4E00\u9875",
                  /* @__PURE__ */ jsx(ChevronRight, { className: "ml-1 h-3.5 w-3.5" })
                ]
              }
            )
          ] })
        ] })
      ] }),
      !denied && d51Ready && openedId !== null && /* @__PURE__ */ jsx(
        ProcurementDemandDetailDialog,
        {
          id: openedId,
          onClose: () => setOpenedId(null),
          onQuote: (quoteId) => {
            setOpenedId(null);
            setQuoteTarget({
              demandId: openedId,
              ...quoteId == null ? {} : { quoteId }
            });
          }
        }
      ),
      !denied && d51Ready && quoteTarget !== null && /* @__PURE__ */ jsx(
        DemandQuoteDialog,
        {
          demandId: quoteTarget.demandId,
          quoteId: quoteTarget.quoteId,
          onClose: () => setQuoteTarget(null),
          onSaved: () => {
            void manualRefresh();
          }
        }
      )
    ] }) });
  }

  // native-bridge:wouter
  var useLocation = __live.useLocation;

  // native-bridge:/home/ubuntu/work/channel-release-20261121-1837/manager/client/src/business/platform/client/src/components/customerDemands/CustomerDemandDialog
  var CustomerDemandDialog = __live.CustomerDemandDialog;

  // native-bridge:/home/ubuntu/work/channel-release-20261121-1837/manager/client/src/business/platform/client/src/components/customerDemands/useDemandReadSession
  var demandFreshReadOptions = __live.demandFreshReadOptions;
  var useDemandServerRead = __live.useDemandServerRead;

  // ../channel-release-20261121-1837/manager/client/src/business/platform/client/src/components/customerDemands/CustomerDemandExactEntry.tsx
  function customerDemandExactId(search) {
    const values = new URLSearchParams(search).getAll("demandId");
    if (values.length !== 1 || !/^[1-9]\d*$/.test(values[0])) return null;
    const value = Number(values[0]);
    return Number.isSafeInteger(value) && value <= 2147483647 ? value : null;
  }
  function CustomerDemandExactEntry({ id }) {
    const scope = useBusinessScope();
    return /* @__PURE__ */ jsx(
      CustomerDemandExactSession,
      {
        id
      },
      `${scope.storageScope}|${scope.contextVerification.authorizationVersion}|${id}`
    );
  }
  function CustomerDemandExactSession({ id }) {
    const ready = usePageMemory();
    const [, navigate] = useLocation();
    const query = trpc.customerDemand.get.useQuery(
      { id: id ?? 0 },
      { ...demandFreshReadOptions, enabled: ready && id !== null }
    );
    const read = useDemandServerRead(
      query,
      String(id),
      Boolean(query.data && query.data.id !== id)
    );
    const detail = ready ? read.data : void 0;
    const back = () => navigate("/customer-demands", { replace: true });
    if (id === null)
      return /* @__PURE__ */ jsxs("section", { role: "alert", children: [
        "\u9700\u6C42\u5B9A\u4F4D\u53C2\u6570\u65E0\u6548\uFF0C\u8BF7\u4ECE\u63D0\u4EA4\u6210\u529F\u5165\u53E3\u91CD\u65B0\u6253\u5F00\u3002",
        /* @__PURE__ */ jsx("button", { type: "button", onClick: back, children: "\u8FD4\u56DE\u5BA2\u6237\u9700\u6C42" })
      ] });
    if (read.failed)
      return /* @__PURE__ */ jsxs("section", { role: "alert", children: [
        query.error?.message || "\u65E0\u6CD5\u67E5\u770B\u6B64\u9700\u6C42\uFF0C\u8BF7\u6838\u9A8C\u5F53\u524D\u8D26\u53F7\u6743\u9650",
        /* @__PURE__ */ jsx("button", { type: "button", onClick: () => void query.refetch(), children: "\u91CD\u8BD5" }),
        /* @__PURE__ */ jsx("button", { type: "button", onClick: back, children: "\u8FD4\u56DE\u5BA2\u6237\u9700\u6C42" })
      ] });
    if (!detail) return /* @__PURE__ */ jsx("section", { "aria-live": "polite", children: "\u6B63\u5728\u6838\u9A8C\u6B64\u9700\u6C42\u2026" });
    return /* @__PURE__ */ jsx(
      CustomerDemandDialog,
      {
        customer: { id: detail.customerId, name: detail.customerName },
        demandId: detail.id,
        mode: "view",
        readOnly: true,
        onClose: back
      }
    );
  }
  return __toCommonJS(demand_redesign_entry_exports);
})();

return __DRExports;
}
