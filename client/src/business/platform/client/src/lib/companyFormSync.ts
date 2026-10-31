/**
 * company.get 重新请求时，只能在用户尚未手动编辑且 OCR 尚未回填的情况下同步。
 * 这会阻止 invalidate 的旧/空资料覆盖待确认的企业或银行识别结果。
 */
export function shouldSynchronizeCompanyFormFromQuery(input: {
  aiFilled: boolean;
  formEdited: boolean;
}): boolean {
  return !input.aiFilled && !input.formEdited;
}
