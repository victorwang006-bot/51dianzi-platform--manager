import "dotenv/config";
import mysql from "mysql2/promise";

const conn = await mysql.createConnection(process.env.DATABASE_URL);

console.log("开始填充演示数据...");

// 清理旧演示数据（保留 users）
const tables = ["risk_analyses", "alerts", "settlement_bills", "payment_flows", "refunds", "order_status_logs", "orders", "inventory_logs", "products", "categories", "merchants", "admin_users"];
for (const t of tables) {
  await conn.query(`DELETE FROM \`${t}\``);
}

// ─── 类目 ───
await conn.query(`INSERT INTO categories (id, name, parentId, level, sortOrder) VALUES
  (1, '微控制器', NULL, 1, 1),
  (2, '存储芯片', NULL, 1, 2),
  (3, '模拟芯片', NULL, 1, 3),
  (4, '无线模块', NULL, 1, 4),
  (5, '功率器件', NULL, 1, 5),
  (6, '被动元件', NULL, 1, 6),
  (7, '逻辑芯片', NULL, 1, 7)`);

// ─── 商户 ───
const now = Date.now();
const d = (offsetDays) => new Date(now + offsetDays * 86400000);
await conn.query(`INSERT INTO merchants (id, merchantNo, companyName, contactName, contactPhone, contactEmail, businessLicense, licenseExpiry, status, agreementStatus, settlementAccount, settlementBank, settlementAccountName, commissionRate, createdAt) VALUES
  (1, 'M2026001', '深圳市芯达电子有限公司', '陈志强', '13802881001', 'chenzq@xinda-ele.com', '91440300MA5XXXXX1A', ?, 'approved', 'signed', '4000123456789012', '招商银行深圳分行', '深圳市芯达电子有限公司', 0.0300, ?),
  (2, 'M2026002', '上海隆芯半导体贸易有限公司', '王丽华', '13917662002', 'wanglh@longxin-semi.cn', '91310115MA1XXXXX2B', ?, 'approved', 'signed', '6222021001234567', '工商银行上海分行', '上海隆芯半导体贸易有限公司', 0.0250, ?),
  (3, 'M2026003', '北京华芯微电子科技有限公司', '刘建国', '13601233003', 'liujg@huaxin-micro.com', '91110108MA0XXXXX3C', ?, 'pending', 'unsigned', NULL, NULL, NULL, 0.0300, ?),
  (4, 'M2026004', '广州创元电子商行', '林小梅', '13922334004', 'linxm@chuangyuan.net', '92440101MA9XXXXX4D', ?, 'pending', 'unsigned', NULL, NULL, NULL, 0.0300, ?),
  (5, 'M2026005', '东莞市威腾电子有限公司', '张伟', '13712345005', 'zhangw@weiteng-dg.com', '91441900MA4XXXXX5E', ?, 'supplement', 'unsigned', NULL, NULL, NULL, 0.0300, ?),
  (6, 'M2026006', '苏州恒信元器件贸易有限公司', '赵敏', '13862446006', 'zhaom@hengxin-sz.cn', '91320505MA1XXXXX6F', ?, 'suspended', 'expired', '6217001210001234', '建设银行苏州分行', '苏州恒信元器件贸易有限公司', 0.0350, ?)`,
  [d(200), d(-180), d(320), d(-150), d(90), d(-10), d(400), d(-6), d(45), d(-20), d(25), d(-365)]);

// ─── 商品 ───
await conn.query(`INSERT INTO products (id, productNo, merchantId, categoryId, name, brand, model, packageType, spec, price, stockQty, unit, grade, status, banReason, createdAt) VALUES
  (1, 'P20260001', 1, 1, 'STM32F103C8T6 微控制器', 'ST', 'STM32F103C8T6', 'LQFP48', 'ARM Cortex-M3, 72MHz, 64KB Flash', 8.5000, 52000, '片', 'A', 'active', NULL, ?),
  (2, 'P20260002', 1, 2, 'W25Q128JVSIQ NOR Flash', 'Winbond', 'W25Q128JVSIQ', 'SOIC-8', '128Mbit SPI Flash', 3.2000, 120000, '颗', 'A', 'active', NULL, ?),
  (3, 'P20260003', 2, 3, 'LM358DR 运算放大器', 'TI', 'LM358DR', 'SOIC-8', '双路运放, 1MHz', 0.4500, 500000, '片', 'A', 'active', NULL, ?),
  (4, 'P20260004', 2, 4, 'ESP32-WROOM-32E 无线模块', 'Espressif', 'ESP32-WROOM-32E', 'SMD-38', 'WiFi+BT 双模, 4MB Flash', 12.8000, 36000, '个', 'A', 'pending_review', NULL, ?),
  (5, 'P20260005', 1, 5, 'IRFZ44N 功率MOSFET', 'Infineon', 'IRFZ44N', 'TO-220', '55V 49A N沟道', 1.9500, 88000, '只', 'A', 'pending_review', NULL, ?),
  (6, 'P20260006', 6, 2, 'H27U4G8F2ETR NAND Flash（疑似翻新）', 'SK Hynix', 'H27U4G8F2ETR', 'TSOP-48', '4Gbit SLC NAND', 6.2000, 15000, '颗', 'C', 'banned', '抽检发现芯片打磨痕迹，疑似翻新料，已禁售并通知商户整改', ?),
  (7, 'P20260007', 2, 6, 'GRM188R71H104KA93D MLCC电容', 'Murata', 'GRM188R71H104KA93D', '0603', '0.1uF 50V X7R', 0.0280, 2000000, '只', 'A', 'active', NULL, ?),
  (8, 'P20260008', 4, 7, 'SN74HC595DR 移位寄存器', 'TI', 'SN74HC595DR', 'SOIC-16', '8位串入并出', 0.6800, 260000, '片', 'A', 'inactive', NULL, ?)`,
  [d(-120), d(-118), d(-100), d(-2), d(-1), d(-30), d(-95), d(-60)]);

// ─── 订单 ───
await conn.query(`INSERT INTO orders (id, orderNo, buyerName, merchantId, productId, productName, qty, unitPrice, totalAmount, platformFee, merchantAmount, status, abnormalTag, paidAt, completedAt, createdAt) VALUES
  (1, 'SO20260701001', '华强北创新科技', 1, 1, 'STM32F103C8T6 微控制器', 5000, 8.5000, 42500.0000, 1275.0000, 41225.0000, 'completed', NULL, ?, ?, ?),
  (2, 'SO20260703002', '杭州智造电子', 1, 2, 'W25Q128JVSIQ NOR Flash', 20000, 3.2000, 64000.0000, 1920.0000, 62080.0000, 'completed', NULL, ?, ?, ?),
  (3, 'SO20260706003', '成都锐讯通信', 2, 3, 'LM358DR 运算放大器', 100000, 0.4500, 45000.0000, 1125.0000, 43875.0000, 'shipped', NULL, ?, NULL, ?),
  (4, 'SO20260708004', '武汉光电研究所', 2, 7, 'GRM188R71H104KA93D MLCC电容', 500000, 0.0280, 14000.0000, 350.0000, 13650.0000, 'processing', NULL, ?, NULL, ?),
  (5, 'SO20260710005', '深圳市极客硬件', 1, 1, 'STM32F103C8T6 微控制器', 200, 8.5000, 1700.0000, 51.0000, 1649.0000, 'paid', 'stuck_timeout', ?, NULL, ?),
  (6, 'SO20260712006', '广州芯途实业', 6, 6, 'H27U4G8F2ETR NAND Flash', 8000, 6.2000, 49600.0000, 1736.0000, 47864.0000, 'abnormal', 'suspicious_price', ?, NULL, ?),
  (7, 'SO20260713007', '北京航天恒宇', 2, 3, 'LM358DR 运算放大器', 50000, 0.4500, 22500.0000, 562.5000, 21937.5000, 'refunding', NULL, ?, NULL, ?),
  (8, 'SO20260714008', '南京理工電子', 1, 2, 'W25Q128JVSIQ NOR Flash', 5000, 3.2000, 16000.0000, 480.0000, 15520.0000, 'pending_payment', NULL, NULL, NULL, ?),
  (9, 'SO20260715009', '西安微纳传感', 2, 4, 'ESP32-WROOM-32E 无线模块', 3000, 12.8000, 38400.0000, 960.0000, 37440.0000, 'cancelled', NULL, NULL, NULL, ?)`,
  [d(-15), d(-10), d(-15), d(-13), d(-8), d(-13), d(-10), d(-10), d(-8), d(-8), d(-6), d(-6), d(-4), d(-4), d(-3), d(-3), d(-2), d(-1)]);

// ─── 订单状态日志 ───
await conn.query(`INSERT INTO order_status_logs (orderId, fromStatus, toStatus, operatorName, note, createdAt) VALUES
  (1, 'pending_payment', 'paid', '系统', '买家完成支付', ?),
  (1, 'paid', 'shipped', '深圳市芯达电子有限公司', '顺丰发货 SF1390001234567', ?),
  (1, 'shipped', 'completed', '系统', '买家确认收货', ?),
  (5, 'pending_payment', 'paid', '系统', '买家完成支付', ?),
  (6, 'paid', 'abnormal', '平台运营', '价格明显低于市场价，且商户处于暂停状态，标记异常待风控分析', ?),
  (7, 'shipped', 'refunding', '客服-小李', '买家反馈批次不符申请退款', ?)`,
  [d(-15), d(-14), d(-10), d(-8), d(-5), d(-3)]);

// ─── 退款 ───
await conn.query(`INSERT INTO refunds (id, refundNo, orderId, orderNo, merchantId, refundAmount, refundReason, evidenceUrls, status, reviewNote, createdAt) VALUES
  (1, 'RF20260713001', 7, 'SO20260713007', 2, 22500.0000, '收到货物批次与订单不符，买家提供开箱视频及批次照片', '["https://example.com/evidence/rf001-1.jpg", "https://example.com/evidence/rf001-2.mp4"]', 'pending', NULL, ?),
  (2, 'RF20260710002', 5, 'SO20260710005', 1, 1700.0000, '订单长时间未发货，买家申请全额退款', '["https://example.com/evidence/rf002-1.png"]', 'reviewing', '已联系商户核实发货情况', ?),
  (3, 'RF20260705003', 2, 'SO20260703002', 1, 3200.0000, '部分物料引脚氧化，协商退货1000颗', '["https://example.com/evidence/rf003-1.jpg"]', 'completed', '审核通过，已完成部分退款', ?),
  (4, 'RF20260708004', 6, 'SO20260712006', 6, 49600.0000, '疑似翻新料，买家要求全额退款并投诉', '["https://example.com/evidence/rf004-1.jpg", "https://example.com/evidence/rf004-2.jpg"]', 'failed', '商户结算账户被冻结，退款执行失败，需人工介入', ?)`,
  [d(-3), d(-5), d(-9), d(-2)]);

// ─── 支付流水 ───
await conn.query(`INSERT INTO payment_flows (flowNo, orderId, orderNo, merchantId, flowType, amount, channel, channelFlowNo, status, createdAt) VALUES
  ('PAY20260701001', 1, 'SO20260701001', 1, 'payment', 42500.0000, '微信支付', 'WX4200001234567890', 'success', ?),
  ('PAY20260703002', 2, 'SO20260703002', 1, 'payment', 64000.0000, '支付宝', 'ALI2026070322001', 'success', ?),
  ('PAY20260706003', 3, 'SO20260706003', 2, 'payment', 45000.0000, '企业网银', 'B2B20260706001', 'success', ?),
  ('PAY20260708004', 4, 'SO20260708004', 2, 'payment', 14000.0000, '微信支付', 'WX4200009876543210', 'success', ?),
  ('PAY20260710005', 5, 'SO20260710005', 1, 'payment', 1700.0000, '支付宝', 'ALI2026071022002', 'success', ?),
  ('PAY20260712006', 6, 'SO20260712006', 6, 'payment', 49600.0000, '企业网银', 'B2B20260712002', 'success', ?),
  ('PAY20260713007', 7, 'SO20260713007', 2, 'payment', 22500.0000, '微信支付', 'WX4200005556667770', 'success', ?),
  ('FEE20260701001', 1, 'SO20260701001', 1, 'platform_fee', 1275.0000, '平台内扣', NULL, 'success', ?),
  ('FEE20260703002', 2, 'SO20260703002', 1, 'platform_fee', 1920.0000, '平台内扣', NULL, 'success', ?),
  ('RFD20260705003', 2, 'SO20260703002', 1, 'refund', 3200.0000, '支付宝', 'ALIRF2026070501', 'success', ?),
  ('RFD20260708004', 6, 'SO20260712006', 6, 'refund', 49600.0000, '企业网银', NULL, 'failed', ?)`,
  [d(-15), d(-13), d(-10), d(-8), d(-8), d(-6), d(-4), d(-15), d(-13), d(-8), d(-1)]);

// ─── 告警 ───
await conn.query(`INSERT INTO alerts (alertType, severity, title, content, relatedType, relatedId, status, notificationSent, createdAt) VALUES
  ('stuck_order', 'warning', '订单 SO20260710005 支付后超过72小时未发货', '订单已支付但商户超过72小时未发货，买家已提交退款申请，请运营人员跟进催促或协助取消。', 'order', '5', 'open', 1, ?),
  ('refund_abnormal', 'critical', '退款单 RF20260708004 执行失败', '商户「苏州恒信元器件贸易有限公司」结算账户被冻结，退款 ¥49,600 执行失败，需财务人工介入处理。', 'refund', '4', 'open', 1, ?),
  ('license_expiry', 'warning', '商户「东莞市威腾电子有限公司」营业执照即将到期', '该商户营业执照将于45天后到期，请通知商户及时更新资质材料，逾期将自动暂停其经营权限。', 'merchant', '5', 'open', 1, ?),
  ('license_expiry', 'critical', '商户「苏州恒信元器件贸易有限公司」营业执照25天后到期', '该商户当前处于暂停状态且协议已过期，营业执照即将到期，建议启动清退评估流程。', 'merchant', '6', 'acknowledged', 1, ?),
  ('risk_merchant', 'critical', '订单 SO20260712006 被识别为高风险', '该订单商品单价明显低于市场行情，关联商品已被禁售（疑似翻新料），商户处于暂停状态，存在欺诈风险。', 'order', '6', 'acknowledged', 1, ?),
  ('settlement_failed', 'info', '7月上旬结算批次已全部完成', '本批次共2个结算单，全部打款成功，无异常。', 'settlement', NULL, 'resolved', 0, ?)`,
  [d(-5), d(-1), d(-2), d(-1), d(-5), d(-7)]);

// ─── 风控分析示例 ───
await conn.query(`INSERT INTO risk_analyses (targetType, targetId, riskLevel, riskSummary, suggestions, analyzedBy, status, createdAt) VALUES
  ('order', '6', 'critical', '该订单存在多重高风险信号：其一，商品「H27U4G8F2ETR NAND Flash」已因疑似翻新料被平台禁售，但订单在禁售前成交；其二，成交单价6.2元明显低于该型号市场行情价（约8.5-9.2元），偏离幅度超过27%；其三，卖方商户「苏州恒信元器件贸易有限公司」当前处于暂停状态且协议已过期。综合判断该笔交易存在销售翻新料的欺诈嫌疑，且买家已发起全额退款并投诉。', '1. 立即冻结该订单对应商户的所有待结算款项；\\n2. 优先人工处理关联退款单 RF20260708004，通过备用渠道向买家垫付退款；\\n3. 对该商户名下所有在售及历史商品启动批量抽检；\\n4. 收集翻新料证据链，评估是否启动商户清退及法律追责流程。', 'llm', 'pending', ?),
  ('merchant', '6', 'high', '商户「苏州恒信元器件贸易有限公司」风险画像显著恶化：协议已过期未续签、营业执照即将到期、名下商品出现疑似翻新料被禁售、关联订单退款执行失败且涉及大额资金（¥49,600）。该商户近期交易集中于禁售商品，存在利用平台清库存的可疑动机。', '1. 维持商户暂停状态，禁止新增商品与接单；\\n2. 全面审计该商户近90天交易流水；\\n3. 要求商户限期补充资质与整改说明，逾期启动清退；\\n4. 将该商户法人信息纳入平台黑名单关联监控。', 'llm', 'reviewed', ?)`,
  [d(-1), d(-1)]);

// ─── 管理员账户示例 ───
const [users] = await conn.query(`SELECT id FROM users ORDER BY id LIMIT 1`);
const ownerId = users[0]?.id ?? 1;
await conn.query(`INSERT INTO admin_users (userId, username, displayName, email, phone, adminRole, status, mfaEnabled, lastLoginAt) VALUES
  (?, 'admin', '平台超管', 'admin@51dianzi.com', '13800000001', 'super_admin', 'active', 1, ?),
  (0, 'yunying01', '运营-张明', 'zhangming@51dianzi.com', '13800000002', 'operation', 'active', 0, ?),
  (0, 'shanghu01', '商户管理-李娜', 'lina@51dianzi.com', '13800000003', 'merchant_mgr', 'active', 0, ?),
  (0, 'kefu01', '客服-王芳', 'wangfang@51dianzi.com', '13800000004', 'customer_svc', 'active', 0, ?),
  (0, 'fengkong01', '风控-刘洋', 'liuyang@51dianzi.com', '13800000005', 'risk_control', 'active', 1, ?),
  (0, 'caiwu01', '财务-陈静', 'chenjing@51dianzi.com', '13800000006', 'finance', 'active', 1, ?),
  (0, 'shenji01', '审计-赵磊', 'zhaolei@51dianzi.com', '13800000007', 'auditor', 'disabled', 0, NULL)`,
  [ownerId, d(0), d(0), d(-1), d(0), d(-2), d(-1)]);

// ─── 审计日志示例 ───
await conn.query(`INSERT INTO audit_logs (operatorName, operatorRole, action, module, targetType, targetId, beforeValue, afterValue, result, note, createdAt) VALUES
  ('平台超管', 'admin', '商户审核通过', '商户管理', 'merchant', '1', '{"status":"pending"}', '{"status":"approved"}', 'success', '资质齐全，审核通过', ?),
  ('平台超管', 'admin', '商品禁售', '商品管理', 'product', '6', '{"status":"active"}', '{"status":"banned"}', 'success', '抽检发现芯片打磨痕迹，疑似翻新料', ?),
  ('平台超管', 'admin', '订单状态变更为abnormal', '订单中心', 'order', '6', '{"status":"paid"}', '{"status":"abnormal"}', 'success', '价格异常，标记待风控分析', ?),
  ('平台超管', 'admin', '发起订单智能风控分析', '智能风控', 'order', '6', NULL, NULL, 'success', NULL, ?),
  ('平台超管', 'admin', '退款失败', '售后退款', 'refund', '4', '{"status":"executing"}', '{"status":"failed"}', 'success', '商户结算账户被冻结', ?)`,
  [d(-180 + 2), d(-30), d(-5), d(-1), d(-1)]);

console.log("演示数据填充完成");
await conn.end();
