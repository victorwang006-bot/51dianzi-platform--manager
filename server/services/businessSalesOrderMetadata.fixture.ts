import { MySqlDialect } from "drizzle-orm/mysql-core";
import type { SQL } from "drizzle-orm";

/** Fictional fixture only. No credentials, sockets, original order tables or platform calls. */
export const METADATA_FIXTURE_PROVENANCE = { merchantId: 991201, orderId: 991701, orderNumber: "FICTIONAL-SALES-991701", customerId: 991801 };
export const METADATA_FIXTURE_ACTOR = { adminUserId: 991301, frontUserId: 991501, bindingVersion: 7, scopeVersion: 3 };
type Row = Record<string, any>;
type State = { bases: Row[]; receivers: Row[]; cases: Row[]; requests: Row[]; audits: Row[]; nextCaseId: number };
export class MetadataMemoryDb {
  state: State = { bases: [], receivers: [], cases: [], requests: [], audits: [], nextCaseId: 992001 };
  calls: { sql: string; params: unknown[]; transaction: number }[] = [];
  events: string[] = [];
  failAudit = false;
  failRequestCompletion = false;
  forceCasMiss = false;
  malformedSelect = false;
  unavailableTransaction = false;
  private txCounter = 0;
  private currentTx = 0;
  private tail: Promise<unknown> = Promise.resolve();
  private timestampCounter = 0;
  private now() { return new Date(Date.UTC(2026, 10, 13, 14, 20, 0, this.timestampCounter++)); }
  private tuple(params: unknown[], offset = 0) {
    const [merchantId, orderId, orderNumber, customerId] = params.slice(offset);
    return { merchantId, orderId, orderNumber, customerId };
  }
  transaction = async <T>(run: (tx: { execute: (query: SQL) => Promise<unknown> }) => Promise<T>): Promise<T> => {
    const task = this.tail.catch(() => {}).then(async () => {
      if (this.unavailableTransaction) throw new Error("fictional-private-db-path");
      const previous = structuredClone(this.state);
      this.currentTx = ++this.txCounter;
      this.events.push("begin");
      try {
        const result = await run({ execute: this.execute });
        this.events.push("commit");
        return result;
      } catch (error) {
        this.state = previous;
        this.events.push("rollback");
        throw error;
      } finally { this.currentTx = 0; }
    });
    this.tail = task;
    return task;
  };
  execute = async (query: SQL): Promise<unknown> => {
    if (!this.currentTx) throw new Error("fixture_execute_outside_transaction");
    const compiled = new MySqlDialect().sqlToQuery(query);
    const text = compiled.sql.replace(/\s+/g, " ").trim();
    const params = compiled.params;
    this.calls.push({ sql: text, params, transaction: this.currentTx });
    const header = (affectedRows = 1, insertId = 0) => [{ affectedRows, insertId }, []];
    const rows = (items: Row[]) => this.malformedSelect ? [{}] : [structuredClone(items), []];
    const sameOrder = (row: Row, merchantId: unknown, orderId: unknown) => row.merchantId === merchantId && row.orderId === orderId;
    if (text.startsWith("INSERT INTO business_sales_order_metadata_orders")) {
      const p = this.tuple(params);
      if (this.state.bases.some(row => row.merchantId === p.merchantId && (row.orderId === p.orderId || row.orderNumber === p.orderNumber))) return header(0);
      this.state.bases.push({ ...p, createdAt: this.now() });
      return header();
    }
    if (text.includes("FROM business_sales_order_metadata_orders")) {
      return rows(this.state.bases.filter(row => row.merchantId === params[0] && (row.orderId === params[1] || row.orderNumber === params[2])));
    }
    if (text.startsWith("INSERT INTO business_sales_order_metadata_requests")) {
      const [merchantId, orderId, orderNumber, customerId, actorAdminId, requestId, action, payloadSha256] = params;
      if (this.state.requests.some(row => sameOrder(row, merchantId, orderId) && row.actorAdminId === actorAdminId && row.requestId === requestId)) return header(0);
      this.state.requests.push({ merchantId, orderId, orderNumber, customerId, actorAdminId, requestId, action, payloadSha256, resultJson: null });
      return header();
    }
    if (text.includes("FROM business_sales_order_metadata_requests")) {
      return rows(this.state.requests.filter(row => sameOrder(row, params[0], params[1]) && row.actorAdminId === params[2] && row.requestId === params[3]));
    }
    if (text.startsWith("UPDATE business_sales_order_metadata_requests")) {
      if (this.failRequestCompletion) return header(0);
      const [resultJson, merchantId, orderId, actorAdminId, requestId, payloadSha256] = params;
      const request = this.state.requests.find(row => sameOrder(row, merchantId, orderId) && row.actorAdminId === actorAdminId && row.requestId === requestId && row.payloadSha256 === payloadSha256 && row.resultJson === null);
      if (!request) return header(0);
      request.resultJson = resultJson;
      return header();
    }
    if (text.includes("FROM business_sales_order_receivers")) {
      return rows(this.state.receivers.filter(row => sameOrder(row, params[0], params[1])));
    }
    if (text.startsWith("INSERT INTO business_sales_order_receivers")) {
      const p = this.tuple(params);
      const [receiver, receiverPhone, receiverAddress, note] = params.slice(4);
      if (this.state.receivers.some(row => sameOrder(row, p.merchantId, p.orderId))) throw Object.assign(new Error("duplicate receiver"), { code: "ER_DUP_ENTRY" });
      const now = this.now();
      this.state.receivers.push({ ...p, receiver, receiverPhone, receiverAddress, note, version: 1, createdAt: now, updatedAt: now });
      return header();
    }
    if (text.startsWith("UPDATE business_sales_order_receivers")) {
      const [receiver, receiverPhone, receiverAddress, note, merchantId, orderId, orderNumber, customerId, version] = params;
      const row = this.state.receivers.find(row => sameOrder(row, merchantId, orderId) && row.orderNumber === orderNumber && row.customerId === customerId && row.version === version);
      if (!row || this.forceCasMiss) return header(0);
      Object.assign(row, { receiver, receiverPhone, receiverAddress, note, version: row.version + 1, updatedAt: this.now() });
      return header();
    }
    if (text.startsWith("INSERT INTO business_sales_order_after_sales")) {
      const p = this.tuple(params);
      const [kind, reason] = params.slice(4);
      const id = this.state.nextCaseId++;
      const now = this.now();
      this.state.cases.push({ id, ...p, kind, reason, status: "open", resolution: "", version: 1, createdAt: now, updatedAt: now, closedAt: null });
      return header(1, id);
    }
    if (text.includes("FROM business_sales_order_after_sales")) {
      return rows(this.state.cases.filter(row => sameOrder(row, params[0], params[1]) && (params.length === 2 || row.id === params[2])).sort((a, b) => a.id - b.id));
    }
    if (text.startsWith("UPDATE business_sales_order_after_sales")) {
      const [status, resolution, merchantId, orderId, orderNumber, customerId, id, version] = params;
      const row = this.state.cases.find(row => sameOrder(row, merchantId, orderId) && row.orderNumber === orderNumber && row.customerId === customerId && row.id === id && row.version === version);
      if (!row || this.forceCasMiss) return header(0);
      const closedAt = text.includes("closedAt = closedAt") ? row.closedAt : status === "closed" ? this.now() : null;
      Object.assign(row, { status, resolution, version: row.version + 1, updatedAt: this.now(), closedAt });
      return header();
    }
    if (text.startsWith("INSERT INTO business_sales_order_metadata_audits")) {
      if (this.failAudit) throw new Error("fictional-private-audit-sql-secret");
      const p = this.tuple(params);
      const [caseId, action, actorAdminId, actorFrontUserId, bindingVersion, scopeVersion, requestId, beforeJson, afterJson] = params.slice(4);
      this.state.audits.push({ ...p, caseId, action, actorAdminId, actorFrontUserId, bindingVersion, scopeVersion, requestId, beforeJson, afterJson });
      return header();
    }
    throw new Error(`unsupported_fictional_sql: ${text}`);
  };
}
