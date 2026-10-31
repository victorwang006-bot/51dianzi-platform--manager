/** Contact lookup only; accepting a phone here does not bind or authenticate it. */
export const WECHAT_CONTACT_ERROR = "请输入有效微信号或11位手机号";

export function isValidWechatContact(value: string): boolean {
  const contact = value.trim();
  return !contact
    || /^[A-Za-z][A-Za-z0-9_-]{5,19}$/.test(contact)
    || /^1[3-9]\d{9}$/.test(contact);
}
