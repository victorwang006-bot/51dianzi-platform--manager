export const ENV = {
  appId: process.env.VITE_APP_ID ?? "",
  cookieSecret: process.env.JWT_SECRET ?? "",
  databaseUrl: process.env.DATABASE_URL ?? "",
  oAuthServerUrl: process.env.OAUTH_SERVER_URL ?? "",
  ownerOpenId: process.env.OWNER_OPEN_ID ?? "",
  isProduction: process.env.NODE_ENV === "production",
  forgeApiUrl: process.env.BUILT_IN_FORGE_API_URL ?? "",
  forgeApiKey: process.env.BUILT_IN_FORGE_API_KEY ?? "",
  ossAccessKeyId: process.env.ALI_OSS_ACCESS_KEY_ID ?? "",
  ossAccessKeySecret: process.env.ALI_OSS_ACCESS_KEY_SECRET ?? "",
  ossBucket: process.env.ALI_OSS_BUCKET ?? "",
  ossRegion: process.env.ALI_OSS_REGION ?? "",
  ocrAccessKeyId: process.env.ALIYUN_OCR_ACCESS_KEY_ID ?? "",
  ocrAccessKeySecret: process.env.ALIYUN_OCR_ACCESS_KEY_SECRET ?? "",
  ocrEndpoint: process.env.ALIYUN_OCR_ENDPOINT ?? "ocr-api.cn-hangzhou.aliyuncs.com",
  ocrRegionId: process.env.ALIYUN_OCR_REGION_ID ?? "cn-hangzhou",
  /** 支付宝二维码支付仅在显式开启时调用真实网关。 */
  alipayEnabled: process.env.ALIPAY_ENABLED === "true",
  alipayMode: process.env.ALIPAY_MODE ?? "production",
  alipayAppId: process.env.ALIPAY_APP_ID ?? "",
  alipaySellerId: process.env.ALIPAY_SELLER_ID ?? "",
  alipayNotifyUrl: process.env.ALIPAY_NOTIFY_URL ?? "",
  alipayEndpoint: process.env.ALIPAY_ENDPOINT ?? "",
  alipayKeyType: process.env.ALIPAY_KEY_TYPE ?? "PKCS8",
  alipayPrivateKey: process.env.ALIPAY_PRIVATE_KEY ?? "",
  alipayPrivateKeyPath: process.env.ALIPAY_PRIVATE_KEY_PATH ?? "",
  alipayPublicKey: process.env.ALIPAY_PUBLIC_KEY ?? "",
  alipayPublicKeyPath: process.env.ALIPAY_PUBLIC_KEY_PATH ?? "",
  alipayAppCertPath: process.env.ALIPAY_APP_CERT_PATH ?? "",
  alipayPublicCertPath: process.env.ALIPAY_PUBLIC_CERT_PATH ?? "",
  alipayRootCertPath: process.env.ALIPAY_ROOT_CERT_PATH ?? "",
  /** 微信 Native 扫码支付仅在显式开启且凭据完整时调用真实 API v3。 */
  wechatPayEnabled: process.env.WECHAT_PAY_ENABLED === "true",
  wechatPayNativeAppId: process.env.WECHAT_PAY_NATIVE_APP_ID ?? "",
  wechatPayMiniProgramAppId: process.env.WECHAT_PAY_MINIPROGRAM_APP_ID ?? "",
  wechatPayMchId: process.env.WECHAT_PAY_MCH_ID ?? "",
  wechatPayNotifyUrl: process.env.WECHAT_PAY_NOTIFY_URL ?? "",
  wechatPayEndpoint: process.env.WECHAT_PAY_ENDPOINT ?? "",
  wechatPayApiV3Key: process.env.WECHAT_PAY_API_V3_KEY ?? "",
  wechatPayApiV3KeyPath: process.env.WECHAT_PAY_API_V3_KEY_PATH ?? "",
  wechatPayMerchantSerialNo: process.env.WECHAT_PAY_MERCHANT_SERIAL_NO ?? "",
  wechatPayMerchantPrivateKey: process.env.WECHAT_PAY_MERCHANT_PRIVATE_KEY ?? "",
  wechatPayMerchantPrivateKeyPath: process.env.WECHAT_PAY_MERCHANT_PRIVATE_KEY_PATH ?? "",
  wechatPayMerchantCertificate: process.env.WECHAT_PAY_MERCHANT_CERTIFICATE ?? "",
  wechatPayMerchantCertificatePath: process.env.WECHAT_PAY_MERCHANT_CERTIFICATE_PATH ?? "",
  wechatPayPublicKeyId: process.env.WECHAT_PAY_PUBLIC_KEY_ID ?? "",
  wechatPayPublicKey: process.env.WECHAT_PAY_PUBLIC_KEY ?? "",
  wechatPayPublicKeyPath: process.env.WECHAT_PAY_PUBLIC_KEY_PATH ?? "",
  /**
   * 微信小程序登录（jscode2session）。
   *
   * AppSecret 与支付凭证是**两套不同的东西**：
   * 支付用商户证书/私钥做 API v3 签名，
   * 而登录必须用 AppID + AppSecret 调 jscode2session 换 openid，
   * 两者不可互代。
   *
   * AppID 复用 wechatPayMiniProgramAppId：
   * 已核实生产配置的该值（wx147f...）就是小程序「51电子网」的 AppID，
   * 且已在商户号下完成关联授权，无需另配。
   */
  wechatMiniProgramAppSecret: process.env.WECHAT_MINIPROGRAM_APP_SECRET ?? "",
  wechatMiniProgramLoginEndpoint:
    process.env.WECHAT_MINIPROGRAM_LOGIN_ENDPOINT ??
    "https://api.weixin.qq.com/sns/jscode2session",
  /**
   * 快递100 实时物流查询。
   *
   * 官方明确要求同一运单查询间隔不得低于半小时（否则会锁单），
   * 因此缓存窗口虽可配，但强制不小于 30 分钟，避免误配导致账号被锁。
   */
  kuaidi100Enabled: process.env.KUAIDI100_ENABLED === "true",
  kuaidi100Key: process.env.KUAIDI100_KEY ?? "",
  kuaidi100Customer: process.env.KUAIDI100_CUSTOMER ?? "",
  kuaidi100Endpoint:
    process.env.KUAIDI100_ENDPOINT ?? "https://poll.kuaidi100.com/poll/query.do",
  kuaidi100CacheMinutes: Math.max(
    30,
    Number(process.env.KUAIDI100_CACHE_MINUTES ?? "30") || 30,
  ),
  /**
   * 快递100 面单 OCR 识别。
   *
   * 与实时查询共用同一个授权 key，但是独立产品、单独计费（实时扣费），
   * 因此开关也独立：潜在的额度耗尽只影响 OCR，不应连带关闭物流查询。
   *
   * OCR 接口不需要 customer 与 sign，只传 key + param。
   */
  kuaidi100OcrEnabled: process.env.KUAIDI100_OCR_ENABLED === "true",
  /**
   * 官方文档写的是 `http://api.kuaidi100.com/elec/detocr`，但实测 base64 直传时
   * http 端点会直接断连（Remote end closed connection without response），
   * 换 https 立即正常。因此默认值用 https。
   */
  kuaidi100OcrEndpoint:
    process.env.KUAIDI100_OCR_ENDPOINT ?? "https://api.kuaidi100.com/elec/detocr",
  /**
   * 单张面单图片上限（字节）。快递100 要求 base64 编码后不超 4M，
   * base64 会膨胀约 4/3，因此原图限制为 3M 留计。
   */
  kuaidi100OcrMaxBytes: Math.max(
    262144,
    Number(process.env.KUAIDI100_OCR_MAX_BYTES ?? "3145728") || 3145728,
  ),
};
