/**
 * 支付流程错误。
 *
 * 单独成文件而不是放在 paymentService.ts 里，是为了让支付宝与微信两条
 * 支付链路都能引用它，同时避免 paymentService 与 wechatPaymentService
 * 相互 import 形成循环依赖。
 */
export class PaymentFlowError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "PaymentFlowError";
    this.code = code;
  }
}
