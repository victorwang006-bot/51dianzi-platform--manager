import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { portalClientMessageIdSchema } from "./portalClientMessageId";

const routerSource = readFileSync(
  fileURLToPath(new URL("./routers.ts", import.meta.url)),
  "utf8",
);

describe("前台客服消息幂等键契约", () => {
  it("门户消息路由使用共享兼容校验而不是纯UUID限制", () => {
    expect(routerSource).toContain("clientMessageId: portalClientMessageIdSchema");
    expect(routerSource).not.toContain("clientMessageId: z.string().uuid()");
  });

  it("兼容纯UUID、带业务前缀UUID和受限浏览器回退格式", () => {
    const values = [
      "1f31f723-b423-4d0c-a0d2-55228491838e",
      "chat-1f31f723-b423-4d0c-a0d2-55228491838e",
      "chat-m0abc123-0123456789abcdef01234567",
      "inq_test-20260906-abcDEF123",
    ];

    for (const value of values) {
      expect(portalClientMessageIdSchema.parse(value)).toBe(value);
    }
  });

  it("继续允许旧调用省略幂等键", () => {
    expect(portalClientMessageIdSchema.parse(undefined)).toBeUndefined();
    expect(portalClientMessageIdSchema.parse(null)).toBeNull();
  });

  it("拒绝空值、空白、路径、控制字符和超长输入", () => {
    const invalidValues = [
      "",
      "chat id",
      "chat/id",
      "chat:id",
      "chat\nidentifier",
      "a".repeat(65),
    ];

    for (const value of invalidValues) {
      expect(() => portalClientMessageIdSchema.parse(value)).toThrow();
    }
  });
});
