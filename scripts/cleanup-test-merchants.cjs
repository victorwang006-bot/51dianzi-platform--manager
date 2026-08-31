const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");


const TARGET_MERCHANT_NOS = [
  "M2026000001",
  "M2026000002",
  "M2026000003",
  "M2026000004",
  "M2026000005",
  "M2026000006",
];
const CONFIRMATION = "DELETE_51DIANZI_TEST_MERCHANTS";
const execute = process.argv.includes("--execute");
const confirmArg = process.argv.find(arg => arg.startsWith("--confirm="));
const backupArg = process.argv.find(arg => arg.startsWith("--backup="));
const backupPath = backupArg ? path.resolve(backupArg.slice("--backup=".length)) : "";

function must(condition, message) {
  if (!condition) throw new Error(message);
}

function ids(rows) {
  return rows.map(row => Number(row.id)).filter(value => Number.isInteger(value) && value > 0);
}

function sumRows(snapshot) {
  return Object.fromEntries(Object.entries(snapshot).map(([table, rows]) => [table, rows.length]));
}

function stringify(value) {
  return JSON.stringify(value, (_key, item) => typeof item === "bigint" ? item.toString() : item, 2);
}

async function selectIn(connection, sqlPrefix, values) {
  if (!values.length) return [];
  const [rows] = await connection.query(`${sqlPrefix} (?)`, [values]);
  return rows;
}

async function deleteIn(connection, table, column, values) {
  if (!values.length) return 0;
  const [result] = await connection.query(`DELETE FROM \`${table}\` WHERE \`${column}\` IN (?)`, [values]);
  return Number(result.affectedRows || 0);
}

function databaseUrlFromPm2() {
  const dumpPath = "/root/.pm2/dump.pm2";
  if (!fs.existsSync(dumpPath)) return "";
  const apps = JSON.parse(fs.readFileSync(dumpPath, "utf8"));
  for (const app of apps) {
    const name = String(app.name || app.pm2_env?.name || "");
    const value = app.pm2_env?.DATABASE_URL || app.DATABASE_URL;
    if (name.includes("admin") && typeof value === "string" && value.startsWith("mysql")) return value;
  }
  return "";
}

function loadMysql() {
  const candidates = [
    "mysql2/promise",
    "/opt/apps/dianzi51-admin/node_modules/mysql2/promise",
    "/opt/apps/dianzi51-platform/node_modules/mysql2/promise",
  ];
  for (const candidate of candidates) {
    try { return require(candidate); } catch {}
  }
  throw new Error("mysql2/promise不可用");
}

async function main() {
  const databaseUrl = process.env.ADMIN_DB_URL || process.env.DATABASE_URL || databaseUrlFromPm2();
  must(databaseUrl, "缺少后台数据库连接配置");
  const mysql = loadMysql();
  if (execute) {
    must(confirmArg === `--confirm=${CONFIRMATION}`, `执行模式必须提供 --confirm=${CONFIRMATION}`);
    must(backupPath, "执行模式必须提供 --backup=/absolute/path.json");
  }

  const connection = await mysql.createConnection(databaseUrl);

  try {
    await connection.query("SET TRANSACTION ISOLATION LEVEL SERIALIZABLE");
    await connection.beginTransaction();

    const [merchants] = await connection.query(
      `SELECT * FROM merchants WHERE merchantNo IN (?) ORDER BY merchantNo FOR UPDATE`,
      [TARGET_MERCHANT_NOS],
    );
    const merchantIds = ids(merchants);
    const foundNos = merchants.map(row => row.merchantNo);
    const unexpected = foundNos.filter(value => !TARGET_MERCHANT_NOS.includes(value));
    must(unexpected.length === 0, "查询结果包含白名单之外的商户，已中止");

    const products = await selectIn(connection, "SELECT * FROM products WHERE merchantId IN", merchantIds);
    const productIds = ids(products);
    const orders = await selectIn(connection, "SELECT * FROM orders WHERE merchantId IN", merchantIds);
    const orderIds = ids(orders);
    const orderNos = orders.map(row => row.orderNo).filter(Boolean);
    const settlementBillIds = orders.map(row => Number(row.settlementBillId)).filter(value => Number.isInteger(value) && value > 0);
    const messageThreads = await selectIn(connection, "SELECT * FROM message_threads WHERE merchantId IN", merchantIds);
    const threadIds = ids(messageThreads);

    const snapshot = {
      metadata: [{
        createdAt: new Date().toISOString(),
        mode: execute ? "execute" : "dry-run",
        targetMerchantNos: TARGET_MERCHANT_NOS,
        foundMerchantNos: foundNos,
        missingMerchantNos: TARGET_MERCHANT_NOS.filter(value => !foundNos.includes(value)),
      }],
      merchants,
      products,
      inventory_logs: await selectIn(connection, "SELECT * FROM inventory_logs WHERE merchantId IN", merchantIds),
      orders,
      order_status_logs: await selectIn(connection, "SELECT * FROM order_status_logs WHERE orderId IN", orderIds),
      refunds_by_merchant: await selectIn(connection, "SELECT * FROM refunds WHERE merchantId IN", merchantIds),
      refunds_by_order: await selectIn(connection, "SELECT * FROM refunds WHERE orderId IN", orderIds),
      payment_flows_by_merchant: await selectIn(connection, "SELECT * FROM payment_flows WHERE merchantId IN", merchantIds),
      payment_flows_by_order: await selectIn(connection, "SELECT * FROM payment_flows WHERE orderId IN", orderIds),
      settlement_bills: await selectIn(connection, "SELECT * FROM settlement_bills WHERE merchantId IN", merchantIds),
      crm_owner_rebind_logs: await selectIn(connection, "SELECT * FROM crm_owner_rebind_logs WHERE merchantId IN", merchantIds),
      message_threads: messageThreads,
      messages: await selectIn(connection, "SELECT * FROM messages WHERE threadId IN", threadIds),
      risk_analyses_merchants: merchantIds.length
        ? (await connection.query("SELECT * FROM risk_analyses WHERE targetType='merchant' AND targetId IN (?)", [[...merchantIds.map(String), ...foundNos]]))[0]
        : [],
      risk_analyses_orders: orderIds.length
        ? (await connection.query("SELECT * FROM risk_analyses WHERE targetType='order' AND targetId IN (?)", [[...orderIds.map(String), ...orderNos]]))[0]
        : [],
      risk_analyses_refunds: [],
      alerts_merchants: merchantIds.length
        ? (await connection.query("SELECT * FROM alerts WHERE relatedType='merchant' AND relatedId IN (?)", [[...merchantIds.map(String), ...foundNos]]))[0]
        : [],
      alerts_orders: orderIds.length
        ? (await connection.query("SELECT * FROM alerts WHERE relatedType='order' AND relatedId IN (?)", [[...orderIds.map(String), ...orderNos]]))[0]
        : [],
      audit_logs_preserved: merchantIds.length
        ? (await connection.query("SELECT * FROM audit_logs WHERE targetType='merchant' AND targetId IN (?)", [[...merchantIds.map(String), ...foundNos]]))[0]
        : [],
    };

    if (orderNos.length) {
      const [refundRisk] = await connection.query(
        "SELECT ra.* FROM risk_analyses ra INNER JOIN refunds r ON ra.targetType='refund' AND ra.targetId=CAST(r.id AS CHAR) WHERE r.orderNo IN (?)",
        [orderNos],
      );
      snapshot.risk_analyses_refunds = refundRisk;
    }

    const counts = sumRows(snapshot);
    const publicSummary = {
      mode: execute ? "execute" : "dry-run",
      targetMerchantCount: TARGET_MERCHANT_NOS.length,
      foundMerchantCount: merchants.length,
      missingMerchantNos: TARGET_MERCHANT_NOS.filter(value => !foundNos.includes(value)),
      rowCounts: counts,
      note: "audit_logs_preserved仅备份统计，不删除",
    };

    if (!execute) {
      await connection.rollback();
      console.log(stringify(publicSummary));
      return;
    }

    fs.mkdirSync(path.dirname(backupPath), { recursive: true, mode: 0o700 });
    fs.chmodSync(path.dirname(backupPath), 0o700);
    const backupJson = stringify(snapshot) + "\n";
    fs.writeFileSync(backupPath, backupJson, { mode: 0o600, flag: "wx" });
    fs.chmodSync(backupPath, 0o600);
    const backupHash = crypto.createHash("sha256").update(backupJson).digest("hex");

    const deleteCounts = {};
    deleteCounts.messages = await deleteIn(connection, "messages", "threadId", threadIds);
    deleteCounts.message_threads = await deleteIn(connection, "message_threads", "id", threadIds);
    deleteCounts.risk_analyses_refunds = await deleteIn(connection, "risk_analyses", "id", ids(snapshot.risk_analyses_refunds));
    deleteCounts.risk_analyses_orders = await deleteIn(connection, "risk_analyses", "id", ids(snapshot.risk_analyses_orders));
    deleteCounts.risk_analyses_merchants = await deleteIn(connection, "risk_analyses", "id", ids(snapshot.risk_analyses_merchants));
    deleteCounts.alerts_orders = await deleteIn(connection, "alerts", "id", ids(snapshot.alerts_orders));
    deleteCounts.alerts_merchants = await deleteIn(connection, "alerts", "id", ids(snapshot.alerts_merchants));
    deleteCounts.order_status_logs = await deleteIn(connection, "order_status_logs", "orderId", orderIds);
    deleteCounts.refunds_by_order = await deleteIn(connection, "refunds", "orderId", orderIds);
    deleteCounts.refunds_by_merchant = await deleteIn(connection, "refunds", "merchantId", merchantIds);
    deleteCounts.payment_flows_by_order = await deleteIn(connection, "payment_flows", "orderId", orderIds);
    deleteCounts.payment_flows_by_merchant = await deleteIn(connection, "payment_flows", "merchantId", merchantIds);
    deleteCounts.inventory_logs = await deleteIn(connection, "inventory_logs", "merchantId", merchantIds);
    deleteCounts.orders = await deleteIn(connection, "orders", "id", orderIds);
    deleteCounts.settlement_bills_from_orders = await deleteIn(connection, "settlement_bills", "id", settlementBillIds);
    deleteCounts.settlement_bills = await deleteIn(connection, "settlement_bills", "merchantId", merchantIds);
    deleteCounts.crm_owner_rebind_logs = await deleteIn(connection, "crm_owner_rebind_logs", "merchantId", merchantIds);
    deleteCounts.products = await deleteIn(connection, "products", "id", productIds);
    deleteCounts.merchants = await deleteIn(connection, "merchants", "id", merchantIds);

    must(deleteCounts.merchants === merchants.length, "商户删除数量与锁定快照不一致，已回滚");
    must(deleteCounts.orders === orders.length, "订单删除数量与锁定快照不一致，已回滚");
    must(deleteCounts.products === products.length, "商品删除数量与锁定快照不一致，已回滚");
    must(deleteCounts.message_threads === messageThreads.length, "消息线程删除数量与锁定快照不一致，已回滚");
    const [remainingRows] = await connection.query(
      "SELECT COUNT(*) AS count FROM merchants WHERE merchantNo IN (?)",
      [TARGET_MERCHANT_NOS],
    );
    must(Number(remainingRows?.[0]?.count ?? 0) === 0, "仍存在目标测试商户，已回滚");

    await connection.commit();
    console.log(stringify({ ...publicSummary, backupPath, backupSha256: backupHash, deleteCounts }));
  } catch (error) {
    try { await connection.rollback(); } catch {}
    throw error;
  } finally {
    await connection.end();
  }
}

main().catch(error => {
  console.error("[cleanup-test-merchants]", error && error.message ? error.message : error);
  process.exit(1);
});
