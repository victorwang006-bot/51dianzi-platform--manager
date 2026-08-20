/**
 * 异常日志规则测试。
 *
 * 用例数据取自 2026-08-20 生产日志实测：
 * 攻击者 103.215.74.185 在 09:15:01–09:17:03 发起的 309 次真实请求。
 * 用真实攻击样本而非编造路径，才能保证规则真的拦得住。
 */
import { describe, expect, it } from "vitest";
import {
  buildFingerprint,
  CATEGORY_LABELS,
  classifyByStatus,
  detectAttack,
  isNoise,
  LOG_RETENTION_DAYS,
  sanitizePath,
  SEVERITY_LABELS,
  SLOW_REQUEST_THRESHOLD_MS,
} from "../shared/exceptionRules";

describe("攻击探测识别（样本取自真实攻击）", () => {
  it("识别环境变量文件探测", () => {
    const r = detectAttack("/.env", "GET");
    expect(r.matched).toBe(true);
    expect(r.severity).toBe("critical");
    expect(r.label).toContain("环境变量");
  });

  it("识别 .env 变体路径", () => {
    expect(detectAttack("/.env.production", "GET").matched).toBe(true);
    expect(detectAttack("/api/.env", "GET").matched).toBe(true);
  });

  it("识别 Git 仓库泄露探测", () => {
    expect(detectAttack("/.git/HEAD", "GET").matched).toBe(true);
    expect(detectAttack("/.git/config", "GET").matched).toBe(true);
  });

  it("识别 WordPress 批量接口 RCE 尝试", () => {
    // 对应 2026-07 披露的 WP Core 6.9–7.0.1 预认证 RCE
    const r = detectAttack("/wp-json/batch/v1", "POST");
    expect(r.matched).toBe(true);
    expect(r.severity).toBe("critical");
  });

  it("识别 RCE 的 URL 编码绕过变体", () => {
    // 攻击者实际用过 rest_route=/batch/v1 与 %2F 编码两种写法绕 WAF
    expect(detectAttack("/?rest_route=/batch/v1", "POST").matched).toBe(true);
    expect(detectAttack("/?rest_route=%2Fbatch%2Fv1", "POST").matched).toBe(true);
  });

  it("识别用户名枚举尝试", () => {
    expect(detectAttack("/wp-json/wp/v2/users", "GET").matched).toBe(true);
    expect(detectAttack("/?rest_route=/wp/v2/users", "GET").matched).toBe(true);
  });

  it("识别 WebShell 与配置文件探测", () => {
    expect(detectAttack("/shell.php", "GET").matched).toBe(true);
    expect(detectAttack("/wp-config.php", "GET").matched).toBe(true);
    expect(detectAttack("/phpmyadmin/", "GET").matched).toBe(true);
  });

  it("POST 到认证端点判为 warning 而非 critical", () => {
    // 单次访问可能是正常用户误触，需结合频次判断
    const r = detectAttack("/login", "POST");
    expect(r.matched).toBe(true);
    expect(r.severity).toBe("warning");
  });

  it("GET 访问 /login 不判为攻击", () => {
    // 真实用户会 GET 打开登录页，不能误伤
    expect(detectAttack("/login", "GET").matched).toBe(false);
  });

  it("正常业务路径不误判", () => {
    const normalPaths = [
      "/api/trpc/inventory.list",
      "/search?keyword=STM32",
      "/product/12345",
      "/erp/publish",
      "/api/trpc/wechatAuth.bindingStatus",
    ];
    normalPaths.forEach(p => {
      expect(detectAttack(p, "GET").matched, `${p} 不应判为攻击`).toBe(false);
      expect(detectAttack(p, "POST").matched, `${p} 不应判为攻击`).toBe(false);
    });
  });

  it("acme-challenge 属正常证书校验，不误判", () => {
    // SSL 证书自动续期依赖此路径，误判会掩盖真实问题
    expect(detectAttack("/.well-known/acme-challenge/token123", "GET").matched).toBe(false);
  });
});

describe("噪音过滤", () => {
  it("过滤未启用模块的 OAUTH 告警", () => {
    // 实测：单个日志文件 2226 行中 115 行是这一条
    expect(isNoise("[OAuth] ERROR: OAUTH_SERVER_URL is not configured!")).toBe(true);
  });

  it("过滤客户端主动断开", () => {
    expect(isNoise("Error: read ECONNRESET")).toBe(true);
    expect(isNoise("write EPIPE")).toBe(true);
  });

  it("不过滤真实业务错误", () => {
    expect(isNoise("短信验证码发送失败：签名不匹配")).toBe(false);
    expect(isNoise("服务器错误 500：POST /api/trpc/localAuth.sendSmsCode")).toBe(false);
  });

  it("空值安全", () => {
    expect(isNoise(null)).toBe(false);
    expect(isNoise(undefined)).toBe(false);
    expect(isNoise("")).toBe(false);
  });
});

describe("敏感信息脱敏", () => {
  it("脱敏密码与令牌参数", () => {
    expect(sanitizePath("/api/login?password=abc123")).toBe("/api/login?password=***");
    expect(sanitizePath("/cb?token=eyJhbGci&state=x")).toBe("/cb?token=***&state=x");
  });

  it("保留非敏感参数便于排查", () => {
    expect(sanitizePath("/search?keyword=STM32&page=2")).toBe("/search?keyword=STM32&page=2");
  });

  it("无查询串时原样返回", () => {
    expect(sanitizePath("/api/trpc/inventory.list")).toBe("/api/trpc/inventory.list");
  });

  it("截断超长路径，防止单条日志过大", () => {
    expect(sanitizePath(`/api/${"x".repeat(900)}`).length).toBeLessThanOrEqual(512);
  });
});

describe("异常指纹", () => {
  it("同类问题的不同 ID 归并为一个指纹", () => {
    // 否则 /orders/1001 与 /orders/1002 会被当成两类问题
    const a = buildFingerprint("server_error", "/api/orders/1001", 500);
    const b = buildFingerprint("server_error", "/api/orders/1002", 500);
    expect(a).toBe(b);
  });

  it("忽略查询串差异", () => {
    const a = buildFingerprint("server_error", "/search?keyword=A", 500);
    const b = buildFingerprint("server_error", "/search?keyword=B", 500);
    expect(a).toBe(b);
  });

  it("不同类别不归并", () => {
    const a = buildFingerprint("server_error", "/api/x", 500);
    const b = buildFingerprint("attack_probe", "/api/x", 500);
    expect(a).not.toBe(b);
  });

  it("长度受控，不超出数据库字段上限", () => {
    const fp = buildFingerprint("server_error", `/api/${"y".repeat(500)}`, 500);
    expect(fp.length).toBeLessThanOrEqual(128);
  });
});

describe("状态码分类", () => {
  it("5xx 判为服务器错误且为严重", () => {
    expect(classifyByStatus(500)).toEqual({ category: "server_error", severity: "critical" });
    expect(classifyByStatus(502)).toEqual({ category: "server_error", severity: "critical" });
  });

  it("429 判为限流", () => {
    expect(classifyByStatus(429)?.category).toBe("rate_limit");
  });

  it("401/403 判为认证异常", () => {
    expect(classifyByStatus(401)?.category).toBe("auth_failure");
    expect(classifyByStatus(403)?.category).toBe("auth_failure");
  });

  it("普通 4xx 不记录，避免噪音", () => {
    // 线上 24 小时有 84 次 404，多为爬虫与失效链接，无诊断价值
    expect(classifyByStatus(404)).toBeNull();
    expect(classifyByStatus(400)).toBeNull();
  });

  it("2xx/3xx 不记录", () => {
    expect(classifyByStatus(200)).toBeNull();
    expect(classifyByStatus(302)).toBeNull();
  });
});

describe("常量与展示", () => {
  it("保留期为 30 天（用户确认）", () => {
    expect(LOG_RETENTION_DAYS).toBe(30);
  });

  it("慢请求阈值为 3 秒", () => {
    expect(SLOW_REQUEST_THRESHOLD_MS).toBe(3000);
  });

  it("所有类别都有中文名，界面不出现英文枚举", () => {
    const categories = [
      "server_error",
      "attack_probe",
      "auth_failure",
      "rate_limit",
      "slow_request",
      "integration",
    ] as const;
    categories.forEach(c => {
      expect(CATEGORY_LABELS[c], `${c} 缺少中文名`).toBeTruthy();
      expect(/^[\u4e00-\u9fa5]/.test(CATEGORY_LABELS[c])).toBe(true);
    });
  });

  it("所有严重程度都有中文名", () => {
    (["critical", "warning", "info"] as const).forEach(s => {
      expect(SEVERITY_LABELS[s]).toBeTruthy();
    });
  });
});
