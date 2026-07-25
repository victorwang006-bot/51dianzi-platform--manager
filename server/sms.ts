/**
 * 阿里云短信服务（Dysms）发送模块。
 * 使用 RPC 签名方式直接调用 API（无需引入阿里云 SDK 依赖）。
 * 环境变量：SMS_ACCESS_KEY_ID / SMS_ACCESS_KEY_SECRET / SMS_SIGN_NAME / SMS_TEMPLATE_CODE
 */
import crypto from "crypto";

const SMS_ENDPOINT = "https://dysmsapi.aliyuncs.com/";

export function isSmsConfigured(): boolean {
  return Boolean(
    process.env.SMS_ACCESS_KEY_ID &&
      process.env.SMS_ACCESS_KEY_SECRET &&
      process.env.SMS_SIGN_NAME &&
      process.env.SMS_TEMPLATE_CODE
  );
}

function percentEncode(str: string): string {
  return encodeURIComponent(str)
    .replace(/\+/g, "%20")
    .replace(/\*/g, "%2A")
    .replace(/%7E/g, "~")
    .replace(/!/g, "%21")
    .replace(/'/g, "%27")
    .replace(/\(/g, "%28")
    .replace(/\)/g, "%29");
}

/**
 * 发送短信验证码。
 * @returns 阿里云响应（Code === "OK" 表示成功）
 */
export async function sendSmsCode(
  phone: string,
  code: string
): Promise<{ ok: boolean; code: string; message: string; requestId?: string }> {
  if (!isSmsConfigured()) {
    return { ok: false, code: "NOT_CONFIGURED", message: "短信服务未配置" };
  }

  const params: Record<string, string> = {
    AccessKeyId: process.env.SMS_ACCESS_KEY_ID!,
    Action: "SendSms",
    Format: "JSON",
    PhoneNumbers: phone,
    RegionId: "cn-hangzhou",
    SignName: process.env.SMS_SIGN_NAME!,
    SignatureMethod: "HMAC-SHA1",
    SignatureNonce: crypto.randomUUID(),
    SignatureVersion: "1.0",
    TemplateCode: process.env.SMS_TEMPLATE_CODE!,
    TemplateParam: JSON.stringify({ code }),
    Timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    Version: "2017-05-25",
  };

  const sortedKeys = Object.keys(params).sort();
  const canonicalized = sortedKeys
    .map(k => `${percentEncode(k)}=${percentEncode(params[k])}`)
    .join("&");
  const stringToSign = `POST&${percentEncode("/")}&${percentEncode(canonicalized)}`;
  const signature = crypto
    .createHmac("sha1", `${process.env.SMS_ACCESS_KEY_SECRET!}&`)
    .update(stringToSign)
    .digest("base64");

  const body = `Signature=${percentEncode(signature)}&${canonicalized}`;

  const resp = await fetch(SMS_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const data = (await resp.json()) as { Code?: string; Message?: string; RequestId?: string };
  const ok = data.Code === "OK";
  if (!ok) {
    console.error(`[SMS] 发送失败: Code=${data.Code} Message=${data.Message} phone=${phone}`);
  }
  return {
    ok,
    code: data.Code ?? "UNKNOWN",
    message: data.Message ?? "",
    requestId: data.RequestId,
  };
}
