import {
  expressCodeOf,
  expressNameOf,
  expressPhoneRequired,
  isFinalLogisticsState,
  logisticsStateLabel,
} from "../../../shared/expressCompanies";
import { ENV } from "../_core/env";
import * as db from "../db";
import {
  isKuaidi100Configured,
  Kuaidi100Error,
  queryLogistics,
  type LogisticsTrace,
} from "./kuaidi100Gateway";

/**
 * 物流查询服务：在快递100 网关之上负责缓存、限流与降级。
 *
 * 三条必须遵守的约束（来自快递100 官方文档）：
 * 1. 同一运单查询间隔不得低于半小时，否则会被锁单
 * 2. 只在用户主动查看时查询，不做定时轮询
 * 3. 同一自然月内同一运单多次查询只计一次费用
 *
 * 因此这里的策略是：命中缓存且未过期直接返回；已签收等终态永久返回缓存；
 * 只有缓存过期且非终态时才真正调用接口。任何失败都降级为返回既有缓存，
 * 保证界面不会因为第三方故障而空白。
 */

export type LogisticsView = {
  /** 是否有可展示的物流数据 */
  available: boolean;
  /** 快递公司中文名 */
  companyName: string;
  /** 快递公司编码 */
  companyCode: string | null;
  /** 运单号 */
  expressNo: string;
  /** 基础状态值 */
  state: string;
  /** 状态中文名，如"派件中" */
  stateLabel: string;
  /** 轨迹列表，时间倒序 */
  traces: LogisticsTrace[];
  /** 数据来源：live 本次实时查询 / cache 缓存 / none 无数据 */
  source: "live" | "cache" | "none";
  /** 最近查询时间 */
  queriedAt: Date | null;
  /** 预计到达时间 */
  arrivalTime: string | null;
  /** 当前所在城市 */
  currentCity: string | null;
  /**
   * 给用户看的提示。用于说明为何暂时没有轨迹，
   * 例如未配置服务、快递公司不支持、或第三方暂时无结果。
   */
  notice: string | null;
};

function emptyView(
  companyName: string,
  expressNo: string,
  notice: string | null,
  companyCode: string | null = null,
): LogisticsView {
  return {
    available: false,
    companyName,
    companyCode,
    expressNo,
    state: "",
    stateLabel: "暂无信息",
    traces: [],
    source: "none",
    queriedAt: null,
    arrivalTime: null,
    currentCity: null,
    notice,
  };
}

function parseTraces(raw: string): LogisticsTrace[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as LogisticsTrace[]) : [];
  } catch {
    return [];
  }
}

function viewFromSnapshot(
  snapshot: NonNullable<Awaited<ReturnType<typeof db.getLogisticsSnapshot>>>,
  companyName: string,
  notice: string | null = null,
): LogisticsView {
  const traces = parseTraces(snapshot.traces);
  return {
    available: traces.length > 0,
    companyName,
    companyCode: snapshot.expressCode,
    expressNo: snapshot.expressNo,
    state: snapshot.state,
    stateLabel: logisticsStateLabel(snapshot.state),
    traces,
    source: "cache",
    queriedAt: snapshot.queriedAt,
    arrivalTime: snapshot.arrivalTime ?? null,
    currentCity: snapshot.currentCity ?? null,
    notice: notice ?? (traces.length > 0 ? null : snapshot.lastError ?? null),
  };
}

type TrackInput = {
  /** 卖家录入的快递公司（中文名或编码） */
  expressCo: string | null | undefined;
  /** 运单号 */
  expressNo: string | null | undefined;
  /** 收件人电话，顺丰与中通查询必填 */
  receiverPhone?: string | null;
  /** 收货地址，用于提高签收判断准确率 */
  receiverAddress?: string | null;
  /**
   * 强制刷新：忽略缓存窗口直接查询。
   * 仅在缓存确实已过期时才允许生效，避免绕过限流导致锁单。
   */
  forceRefresh?: boolean;
};

export async function getLogisticsView(input: TrackInput): Promise<LogisticsView> {
  const expressNo = input.expressNo?.trim() ?? "";
  const rawCompany = input.expressCo?.trim() ?? "";

  if (!expressNo || !rawCompany) {
    return emptyView(rawCompany, expressNo, "卖家尚未录入运单信息");
  }

  const code = expressCodeOf(rawCompany);
  const companyName = expressNameOf(code) || rawCompany;

  if (!code) {
    // 快递公司未收录时不调接口：传错 com 可能查到不相关的单号，
    // 反而给出误导信息，不如明确提示。
    return emptyView(
      rawCompany,
      expressNo,
      `暂不支持自动查询「${rawCompany}」，请凭运单号在承运商官网查询`,
    );
  }

  const snapshot = await db.getLogisticsSnapshot(code, expressNo);

  // 终态（已签收/退签/拒签）永久返回缓存：轨迹不会再变，
  // 再查一次纯属浪费单量，也无助于信息更新。
  if (snapshot && isFinalLogisticsState(snapshot.state)) {
    return viewFromSnapshot(snapshot, companyName);
  }

  const cacheMs = ENV.kuaidi100CacheMinutes * 60 * 1000;
  const fresh =
    snapshot && Date.now() - new Date(snapshot.queriedAt).getTime() < cacheMs;

  // 即便请求方要求强制刷新，缓存仍在窗口内时也不放行。
  // 快递100 的锁单是账号级惩罚，不能交由前端参数决定是否触发。
  if (snapshot && fresh) {
    const waitMinutes = Math.max(
      1,
      Math.ceil(
        (cacheMs - (Date.now() - new Date(snapshot.queriedAt).getTime())) / 60000,
      ),
    );
    return viewFromSnapshot(
      snapshot,
      companyName,
      input.forceRefresh
        ? `承运商限制查询频率，请 ${waitMinutes} 分钟后再刷新`
        : null,
    );
  }

  if (!isKuaidi100Configured()) {
    if (snapshot) {
      return viewFromSnapshot(snapshot, companyName, "实时物流查询服务未启用");
    }
    return emptyView(companyName, expressNo, "实时物流查询服务未启用", code);
  }

  // 顺丰与中通必须带电话，缺失时直接给出可操作的提示，
  // 而不是让接口返回 408 后再翻译一次错误。
  const phone = input.receiverPhone?.trim() ?? "";
  if (expressPhoneRequired(code) && !phone) {
    const notice = `${companyName}查询需要收件人电话，当前订单缺少该信息`;
    return snapshot
      ? viewFromSnapshot(snapshot, companyName, notice)
      : emptyView(companyName, expressNo, notice, code);
  }

  try {
    const result = await queryLogistics({
      com: code,
      num: expressNo,
      phone: expressPhoneRequired(code) ? phone : phone || undefined,
      to: input.receiverAddress?.trim() || undefined,
    });

    // 缓存键必须用本地的 code / expressNo，不能用快递100 回传的 result.com：
    // 它会把“自动识别后的真实承运商”写回来（如录单写圆通实际是顺丰），
    // 与下次读缓存时用的键不一致，导致缓存永远未命中、反复真实查询而锁单。
    await db.upsertLogisticsSnapshot({
      expressCode: code,
      expressNo,
      state: result.state,
      traces: JSON.stringify(result.traces),
      arrivalTime: result.arrivalTime ?? null,
      currentCity: result.currentCity ?? null,
      queriedAt: new Date(),
      lastError: null,
    });

    return {
      available: result.traces.length > 0,
      companyName: expressNameOf(result.com) || companyName,
      companyCode: result.com || code,
      expressNo: result.nu || expressNo,
      state: result.state,
      stateLabel: logisticsStateLabel(result.state),
      traces: result.traces,
      source: "live",
      queriedAt: new Date(),
      arrivalTime: result.arrivalTime ?? null,
      currentCity: result.currentCity ?? null,
      notice: result.traces.length === 0 ? "承运商暂未回传轨迹信息" : null,
    };
  } catch (error) {
    const message =
      error instanceof Kuaidi100Error
        ? error.message
        : `物流查询失败：${error instanceof Error ? error.message : String(error)}`;

    // 记录失败并推进 queriedAt，防止用户连续点击刷新击穿限流。
    await db.markLogisticsQueryFailed(code, expressNo, message).catch(() => {
      /* 缓存写入失败不应阻断查询结果返回 */
    });

    // 有旧缓存时优先展示旧数据，把错误降级为提示。
    if (snapshot) {
      return viewFromSnapshot(snapshot, companyName, message);
    }
    return emptyView(companyName, expressNo, message, code);
  }
}

/**
 * 批量取物流概要，用于订单列表的「物流」列。
 *
 * 这里只读缓存、绝不发起查询：列表可能一次展示几十个运单，
 * 若逐个调接口会瞬间打爆单量并触发锁单。实时查询只在用户点开详情时进行。
 */
export async function getLogisticsSummaries(
  orders: { id: number; expressCo: string | null; expressNo: string | null }[],
): Promise<Record<number, { stateLabel: string; state: string; queriedAt: Date | null }>> {
  const result: Record<number, { stateLabel: string; state: string; queriedAt: Date | null }> = {};
  for (const order of orders) {
    const code = expressCodeOf(order.expressCo);
    const no = order.expressNo?.trim();
    if (!code || !no) continue;
    const snapshot = await db.getLogisticsSnapshot(code, no);
    if (!snapshot || !snapshot.state) continue;
    result[order.id] = {
      state: snapshot.state,
      stateLabel: logisticsStateLabel(snapshot.state),
      queriedAt: snapshot.queriedAt,
    };
  }
  return result;
}
