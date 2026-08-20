/**
 * 异常日志的分类、降噪与攻击识别规则。
 *
 * 放在 shared/ 是因为前台与后台都要用同一套判定：
 * 前台负责采集上报，后台负责入库与展示，两边口径必须一致，
 * 否则会出现「前台判为攻击、后台显示为普通错误」的矛盾。
 *
 * 规则来源于 2026-08-20 对生产日志的实测分析，而非通用模板：
 * - 攻击特征取自真实攻击者 103.215.74.185 的 309 次请求
 * - 噪音规则取自 dianzi51-error-28.log 中 2226 行的实际分布
 */

export type ExceptionCategory =
  | "server_error"
  | "attack_probe"
  | "auth_failure"
  | "rate_limit"
  | "slow_request"
  | "integration";

export type ExceptionSeverity = "critical" | "warning" | "info";

/** 慢请求判定阈值（毫秒）。低于此值不记录，避免正常请求刷屏。 */
export const SLOW_REQUEST_THRESHOLD_MS = 3000;

/** 日志保留天数，超期由后台定时任务清理。 */
export const LOG_RETENTION_DAYS = 30;

/* ────────────────────────────────────────────────────────────────
 * 一、噪音过滤
 * ──────────────────────────────────────────────────────────────── */

/**
 * 已知噪音特征：命中即完全不记录。
 *
 * 判断标准是「这条信息重复出现且无法指导任何行动」。
 * 线上实测：单个日志文件 2226 行中有 115 行是 OAUTH_SERVER_URL 一条，
 * 占比 5%，且该模块（第三方 OAuth 登录）站点根本未启用。
 * 不过滤会导致异常日志页面被无效信息淹没，最终没人愿意看。
 */
const NOISE_PATTERNS: readonly RegExp[] = [
  // 未启用的第三方 OAuth 模块，启动时必然告警
  /OAUTH_SERVER_URL is not configured/i,
  // 浏览器预检请求，属正常协议行为
  /^OPTIONS$/i,
  // 客户端主动断开（用户关闭页面），非服务端故障
  /ECONNRESET|EPIPE|aborted/i,
  // Vite 开发服务器热更新，仅开发环境出现
  /\[vite\]|hmr update/i,
];

/** 判断一条异常信息是否属于应当丢弃的噪音。 */
export function isNoise(message: string | undefined | null): boolean {
  if (!message) return false;
  return NOISE_PATTERNS.some((re) => re.test(message));
}

/* ────────────────────────────────────────────────────────────────
 * 二、攻击探测识别
 * ──────────────────────────────────────────────────────────────── */

/**
 * 敏感路径特征。命中即判定为攻击探测，与状态码无关
 * （攻击者扫描 /.env 时即使返回 404，行为本身也值得记录）。
 */
const ATTACK_PATH_PATTERNS: readonly { re: RegExp; label: string }[] = [
  // 配置文件与凭证窃取——危害最高，命中即 critical
  { re: /\/\.env($|[/?])|\/\.env\./i, label: "环境变量文件探测" },
  { re: /\/\.git(\/|$)/i, label: "Git 仓库泄露探测" },
  { re: /wp-config\.php|configuration\.php|\/config\.(php|json|yml)/i, label: "配置文件探测" },
  { re: /\/\.(aws|ssh|npmrc|htpasswd)/i, label: "凭证文件探测" },

  // 远程代码执行尝试
  // 对应 WordPress Core 6.9-7.0.1 预认证 RCE（2026-07 披露）
  { re: /wp-json\/batch\/v1|rest_route=.*batch(%2F|\/)v1/i, label: "WordPress 批量接口 RCE 尝试" },
  { re: /\/(shell|cmd|eval|exec|backdoor)\.(php|jsp|asp)/i, label: "WebShell 探测" },
  { re: /\/livewire\/update/i, label: "Laravel Livewire 漏洞探测" },

  // CMS 与管理后台探测
  { re: /\/wp-(admin|login|content|includes)/i, label: "WordPress 后台探测" },
  { re: /phpmyadmin|adminer\.php|\/pma\//i, label: "数据库管理工具探测" },
  { re: /\/wp-json\/wp\/v2\/users|rest_route=.*wp(%2F|\/)v2(%2F|\/)users/i, label: "用户名枚举尝试" },

  // 常见框架漏洞
  { re: /\/actuator\/|\/druid\/|\/solr\/|\/_ignition\//i, label: "框架管理端点探测" },
  { re: /\/\.well-known\/(?!acme-challenge|security\.txt)/i, label: "异常协议路径探测" },
];

/**
 * 认证端点探测：单独一类。
 * 单次访问可能是正常用户，需结合频次判断，故默认 warning 而非 critical。
 */
const AUTH_PROBE_PATTERN =
  /^\/(login|signin|signup|register|account|dashboard|admin|auth\/callback|api\/auth\/signin)\/?$/i;

export type AttackMatch = {
  matched: boolean;
  label: string;
  severity: ExceptionSeverity;
};

/**
 * 判定请求是否为攻击探测。
 *
 * @param path   请求路径（含查询串）
 * @param method HTTP 方法
 */
export function detectAttack(path: string, method?: string): AttackMatch {
  for (const { re, label } of ATTACK_PATH_PATTERNS) {
    if (re.test(path)) {
      return { matched: true, label, severity: "critical" };
    }
  }
  // POST 到不存在的认证端点：真实用户不会这样做
  if (method?.toUpperCase() === "POST" && AUTH_PROBE_PATTERN.test(path.split("?")[0])) {
    return { matched: true, label: "认证端点探测", severity: "warning" };
  }
  return { matched: false, label: "", severity: "info" };
}

/* ────────────────────────────────────────────────────────────────
 * 三、敏感信息脱敏
 * ──────────────────────────────────────────────────────────────── */

/**
 * 清理路径中的敏感查询参数，避免密码、令牌等被写进日志。
 * 异常日志本身是安全设施，不能反过来成为泄露源。
 */
export function sanitizePath(rawPath: string): string {
  const [base, query] = rawPath.split("?");
  if (!query) return base.slice(0, 512);

  const SENSITIVE = /^(password|passwd|pwd|token|secret|key|code|sign|auth|session)$/i;
  const cleaned = query
    .split("&")
    .map((pair) => {
      const [k, ...rest] = pair.split("=");
      return SENSITIVE.test(k) ? `${k}=***` : `${k}=${rest.join("=")}`;
    })
    .join("&");
  return `${base}?${cleaned}`.slice(0, 512);
}

/* ────────────────────────────────────────────────────────────────
 * 四、指纹与展示
 * ──────────────────────────────────────────────────────────────── */

/**
 * 生成异常指纹，用于把同一根因的多次发生归并。
 * 路径中的数字 ID 会被替换为占位符，
 * 否则 `/orders/1001` 与 `/orders/1002` 会被当成两类问题。
 */
export function buildFingerprint(
  category: ExceptionCategory,
  path: string | undefined,
  statusOrLabel: string | number | undefined,
): string {
  const normalized = (path ?? "")
    .split("?")[0]
    .replace(/\/\d+/g, "/{id}")
    .replace(/\/[0-9a-f]{16,}/gi, "/{hash}")
    .slice(0, 80);
  return `${category}:${normalized}:${statusOrLabel ?? ""}`.slice(0, 128);
}

/** 类别的中文展示名。 */
export const CATEGORY_LABELS: Record<ExceptionCategory, string> = {
  server_error: "服务器错误",
  attack_probe: "攻击探测",
  auth_failure: "认证异常",
  rate_limit: "触发限流",
  slow_request: "慢请求",
  integration: "外部服务故障",
};

/** 严重程度的中文展示名。 */
export const SEVERITY_LABELS: Record<ExceptionSeverity, string> = {
  critical: "严重",
  warning: "警告",
  info: "提示",
};

/**
 * 根据 HTTP 状态码推断类别与严重程度。
 * 仅用于未被更具体规则命中的兜底场景。
 */
export function classifyByStatus(status: number): {
  category: ExceptionCategory;
  severity: ExceptionSeverity;
} | null {
  if (status >= 500) {
    return { category: "server_error", severity: "critical" };
  }
  if (status === 429) {
    return { category: "rate_limit", severity: "warning" };
  }
  if (status === 401 || status === 403) {
    return { category: "auth_failure", severity: "warning" };
  }
  // 4xx 中的其余情况多为客户端问题，不记录以免噪音
  return null;
}
