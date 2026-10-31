/** 仅删除账号分组空格和不可见空格，不转换数字、截断账号或修改其他字符。 */
export function normalizeBankAccountNumber(value: string): string {
  return value.replace(/[\s\u200B-\u200D\u2060\uFEFF]/g, "");
}
