import { z } from "zod";

/**
 * 前台客服消息的可靠重试幂等键。
 *
 * 线上 Web 客户端会生成 `chat-<uuid>`；旧客户端可能发送纯 UUID，
 * 受限 WebView 则退回 `chat-<timestamp>-<random>`。三种格式均仅包含
 * ASCII 字母、数字、下划线和连字符，且前台消息表上限为 64 字符。
 *
 * 这里不能使用 z.string().uuid()：UUID 只是键的一部分，而不是完整值。
 */
export const portalClientMessageIdSchema = z
  .string()
  .min(1, "消息幂等键不能为空")
  .max(64, "消息幂等键不能超过64个字符")
  .regex(/^[A-Za-z0-9_-]+$/, "消息幂等键格式不正确")
  .optional()
  .nullable();
