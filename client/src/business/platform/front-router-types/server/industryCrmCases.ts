import { type Connection, type RowDataPacket } from "mysql2/promise";
import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { customerDataSchema } from "../../shared/crmCustomers";
import { createMultiSchema } from "../../shared/customerContacts";
import { getDb } from "./db";
import { listHandoffCustomers, transferHandoffCustomers } from "./services/crmCustomerHandoff";
import {
  addCustomerFollowUp, archiveCustomer, createCustomer, getCustomer, listCustomers,
  prepareCrmCustomerCreateExtension, restoreCustomer, searchCustomerOwnership, transferCustomer,
  updateCustomer, type CustomerServerScope,
} from "./services/crmCustomers";
import { contactsAdd, contactsEdit, contactsList, contactsSetPrimary, contactsStop, createMulti, updateBasic } from "./services/customerContacts";

const owner: CustomerServerScope = { enterpriseId: 1, actorUserId: 1, canManageAll: true };
const alice: CustomerServerScope = { enterpriseId: 1, actorUserId: 2, canManageAll: false };
const manager: CustomerServerScope = { enterpriseId: 1, actorUserId: 3, canManageAll: true };
const foreign: CustomerServerScope = { enterpriseId: 2, actorUserId: 4, canManageAll: true };
const expected = (scope = alice) => ({ expectedActorUserId: scope.actorUserId, expectedEnterpriseId: scope.enterpriseId });
const rid = (suffix: string) => `industry-sql-${suffix.padEnd(28, "x")}`;
const basicData = (industryCode = "semiconductor", name = "行业SQL客户") => ({ name, industryCode });
const oldData = (industryCode = "semiconductor", name = "旧链路行业客户") => customerDataSchema.parse({ name, industryCode, contactName: "陈工", phone: "13800138000" });
const multiInput = (industryCode: unknown = "semiconductor", suffix = "multi", scope = alice, name = "多联系人行业客户") => ({
  ...expected(scope), data: { name, industryCode },
  contacts: [{ name: "邮件主联系人", methods: [{ type: "email", value: scope.actorUserId === 2 ? "industry@example.test" : `industry-${scope.actorUserId}@example.test` }], isPrimary: true }],
  requestId: rid(suffix), confirmDuplicate: false,
});

/** Registered inside the existing real-contact SQL suite, reusing its strict loopback fixture and hooks. */
export function registerIndustryCrmCases(connection: () => Connection) {
  const snapshot = async () => {
    const names = ["crm_customers", "crm_customer_contacts", "crm_customer_followups", "crm_customer_requests", "crm_customer_audits", "crm_customer_contact_profiles", "crm_customer_contact_methods", "crm_customer_contact_primary", "crm_customer_contact_requests", "crm_customer_contact_audits", "enterprise_team_record_assignments"];
    const result: unknown[] = [];
    for (const table of names) {
      const [rows] = await connection().query(`SELECT * FROM ${table} ORDER BY ${table === "crm_customer_contact_primary" ? "customerId" : "id"}`);
      result.push({ table, rows });
    }
    return JSON.stringify(result);
  };
  const storedIndustry = async (id: number) => {
    const [rows] = await connection().query<RowDataPacket[]>("SELECT industryCode FROM crm_customers WHERE id=?", [id]);
    return rows[0]?.industryCode;
  };
  const legacy = async (name = "历史无行业客户") => {
    const [insert] = await connection().query("INSERT INTO crm_customers(enterpriseId,assignedUserId,createdByUserId,updatedByUserId,name,nameNormalized) VALUES(1,2,2,2,?,?)", [name, name.toLowerCase()]);
    const id = Number((insert as { insertId: number }).insertId);
    await connection().query("INSERT INTO crm_customer_contacts(customerId,contactName,phone,phoneNormalized,isPrimary) VALUES(?,?,?, ?,1)", [id, "历史联系人", "0755-12345678", "075512345678"]);
    return id;
  };

  describe("所属行业：真实 SQL 持久化与兼容回归", () => {
    it("多联系人创建持久行业，列表/详情/联系人DTO一致且邮箱主联系人不伪造电话", async () => {
      const input = multiInput("medical", "persist");
      const created = await createMulti(alice, input);
      expect(await storedIndustry(created.id)).toBe("medical");
      expect((await getCustomer(alice, created.id)).customer).toMatchObject({ industryCode: "medical", phone: "", email: "industry@example.test" });
      const list = await listCustomers(alice, { keyword: "", scope: "mine", archived: false, due: "all", page: 1, pageSize: 20 });
      expect(list.items).toEqual([expect.objectContaining({ id: created.id, industryCode: "medical" })]);
      expect((await contactsList(alice, { ...expected(), customerId: created.id })).customer.industryCode).toBe("medical");
      const [audits] = await connection().query<RowDataPacket[]>("SELECT afterData FROM crm_customer_contact_audits WHERE customerId=? AND action='created_multi'", [created.id]);
      expect(JSON.parse(String(audits[0].afterData)).industryCode).toBe("medical");
    });

    it("旧create服务强制行业且同键变更行业冲突，并发同键只创建一条", async () => {
      const input = { data: oldData(), requestId: rid("old-create"), initialFollowUp: "", confirmDuplicate: false };
      const results = await Promise.all([createCustomer(alice, input), createCustomer(alice, input), createCustomer(alice, input)]);
      expect(new Set(results.map(row => row.id)).size).toBe(1);
      expect(results.filter(row => !row.replayed)).toHaveLength(1);
      expect(await storedIndustry(results[0].id)).toBe("semiconductor");
      const before = await snapshot();
      await expect(createCustomer(alice, { ...input, data: { ...input.data, industryCode: "medical" } })).rejects.toMatchObject({ code: "CONFLICT" });
      expect(await snapshot()).toBe(before);
    });

    it("旧create和当前createMulti均拒绝缺失/空/null/非法行业，零业务写入", async () => {
      const before = await snapshot();
      for (const code of [undefined, null, "", " ", "invalid_industry", "半导体与集成电路"]) {
        const data = { ...oldData(), industryCode: code };
        if (code === undefined) delete (data as { industryCode?: unknown }).industryCode;
        await expect(createCustomer(alice, { data: data as never, requestId: rid("invalid-old"), initialFollowUp: "", confirmDuplicate: false }))
          .rejects.toMatchObject({ code: "BAD_REQUEST", message: "请选择所属行业" });
        await expect(createMulti(alice, multiInput(code === undefined ? "placeholder" : code, "invalid-multi")))
          .rejects.toMatchObject({ issues: expect.arrayContaining([expect.objectContaining({ path: ["data", "industryCode"], message: "请选择所属行业" })]) });
      }
      const missing = multiInput();
      delete (missing.data as { industryCode?: unknown }).industryCode;
      await expect(createMulti(alice, missing)).rejects.toMatchObject({ issues: expect.any(Array) });
      expect(await snapshot()).toBe(before);
    });

    it("可信多联系人扩展也不能绕过行业校验，但不把邮箱-only误作电话必填", async () => {
      const before = await snapshot();
      const extension = prepareCrmCustomerCreateExtension({ payloadHash: "a".repeat(64), afterCustomerCreated: async () => { throw new Error("不应执行"); } });
      await expect(createCustomer(alice, {
        data: { ...oldData(), industryCode: undefined } as never, requestId: rid("extension-invalid"), initialFollowUp: "", confirmDuplicate: false,
      }, extension)).rejects.toMatchObject({ code: "BAD_REQUEST", message: "请选择所属行业" });
      expect(await snapshot()).toBe(before);
      expect((await createMulti(alice, multiInput("communications", "email-only"))).replayed).toBe(false);
    });

    it("updateBasic强制有效行业，缺失非法请求完全不变更旧NULL行/审计/幂等", async () => {
      const id = await legacy();
      const before = await snapshot();
      for (const code of [undefined, null, "", " ", "invalid_industry"]) {
        await expect(updateBasic(alice, {
          ...expected(), customerId: id, version: 1, data: { name: "历史无行业客户", industryCode: code }, requestId: rid("basic-invalid"),
        })).rejects.toMatchObject({ issues: expect.arrayContaining([expect.objectContaining({ path: ["data", "industryCode"], message: "请选择所属行业" })]) });
      }
      const missing = { name: "历史无行业客户" };
      await expect(updateBasic(alice, { ...expected(), customerId: id, version: 1, data: missing, requestId: rid("basic-missing") })).rejects.toMatchObject({ issues: expect.any(Array) });
      expect(await storedIndustry(id)).toBeNull();
      expect(await snapshot()).toBe(before);
    });

    it("updateBasic行业变更进入CAS/幂等哈希和before/after审计，重放不重复写", async () => {
      const created = await createMulti(alice, multiInput());
      const input = { ...expected(), customerId: created.id, version: 1, data: basicData("automotive", "多联系人行业客户"), requestId: rid("basic-cas") };
      const first = await updateBasic(alice, input);
      expect(first).toMatchObject({ version: 2, replayed: false });
      const beforeReplay = await snapshot();
      expect(await updateBasic(alice, input)).toMatchObject({ version: 2, replayed: true });
      expect(await snapshot()).toBe(beforeReplay);
      await expect(updateBasic(alice, { ...input, data: basicData("medical", input.data.name) })).rejects.toMatchObject({ code: "CONFLICT" });
      await expect(updateBasic(alice, { ...input, requestId: rid("basic-stale"), data: basicData("medical", input.data.name) })).rejects.toMatchObject({ code: "CONFLICT" });
      expect(await snapshot()).toBe(beforeReplay);
      expect(await storedIndustry(created.id)).toBe("automotive");
      const [audits] = await connection().query<RowDataPacket[]>("SELECT beforeData,afterData FROM crm_customer_contact_audits WHERE customerId=? AND action='basic_updated'", [created.id]);
      expect(audits).toHaveLength(1);
      expect(JSON.parse(String(audits[0].beforeData))).toEqual({ industryCode: "semiconductor" });
      expect(JSON.parse(String(audits[0].afterData))).toEqual({ industryCode: "automotive" });
    });

    it("旧update强制行业、CAS并记录变化，不能抹掉profile主联系人投影", async () => {
      const created = await createMulti(alice, multiInput());
      const before = await snapshot();
      for (const code of [undefined, null, "", " ", "invalid_industry"]) {
        await expect(updateCustomer(alice, { id: created.id, version: 1, data: { ...oldData(), industryCode: code } as never, confirmDuplicate: false }))
          .rejects.toMatchObject({ code: "BAD_REQUEST", message: "请选择所属行业" });
      }
      expect(await snapshot()).toBe(before);
      await updateCustomer(alice, { id: created.id, version: 1, data: oldData("lighting", "多联系人行业客户"), confirmDuplicate: false });
      await expect(updateCustomer(alice, { id: created.id, version: 1, data: oldData("medical", "多联系人行业客户"), confirmDuplicate: false })).rejects.toMatchObject({ code: "CONFLICT" });
      const detail = await getCustomer(alice, created.id);
      expect(detail.customer).toMatchObject({ industryCode: "lighting", contactName: "邮件主联系人", phone: "", email: "industry@example.test", version: 2 });
      expect(detail.audits.some(audit => audit.note.includes("semiconductor") && audit.note.includes("lighting"))).toBe(true);
    });

    it("历史NULL/未知code读取不猜填，单纯查询不写库且显式基本编辑才补行业", async () => {
      const id = await legacy();
      const before = await snapshot();
      expect((await getCustomer(alice, id)).customer.industryCode).toBeNull();
      expect((await contactsList(alice, { ...expected(), customerId: id })).customer.industryCode).toBeNull();
      expect((await listCustomers(alice, { keyword: "", scope: "mine", archived: false, due: "all", page: 1, pageSize: 20 })).items[0].industryCode).toBeNull();
      expect((await searchCustomerOwnership(alice, { companyName: "历史无行业客户" })).matches).toHaveLength(1);
      expect(await snapshot()).toBe(before);
      await connection().query("UPDATE crm_customers SET industryCode='legacy_future_code' WHERE id=?", [id]);
      expect((await getCustomer(alice, id)).customer.industryCode).toBe("legacy_future_code");
      await connection().query("UPDATE crm_customers SET industryCode=NULL WHERE id=?", [id]);
      await updateBasic(alice, { ...expected(), customerId: id, version: 1, data: basicData("education_research", "历史无行业客户"), requestId: rid("legacy-complete") });
      expect(await storedIndustry(id)).toBe("education_research");
      const [audits] = await connection().query<RowDataPacket[]>("SELECT beforeData FROM crm_customer_contact_audits WHERE customerId=? AND action='basic_updated'", [id]);
      expect(JSON.parse(String(audits[0].beforeData))).toEqual({ industryCode: null });
    });

    it("旧NULL客户的联系人增改停用/主联系人投影、跟进、转交及归档不要求补行业", async () => {
      const id = await legacy();
      const added = await contactsAdd(alice, { ...expected(), customerId: id, contact: { name: "新增联系人", methods: [{ type: "email", value: "new@example.test" }] }, requestId: rid("legacy-add") });
      await contactsSetPrimary(alice, { ...expected(), customerId: id, contactId: added.contactId, version: 1, requestId: rid("legacy-primary") });
      await contactsEdit(alice, { ...expected(), customerId: id, contactId: added.contactId, version: 1, contact: { name: "行业未设置照常编辑", methods: [{ type: "email", value: "edited@example.test" }] }, requestId: rid("legacy-edit") });
      const contacts = await contactsList(alice, { ...expected(), customerId: id });
      const historical = contacts.contacts.find(contact => !contact.isPrimary)!;
      await contactsStop(alice, { ...expected(), customerId: id, contactId: historical.id, version: historical.version, requestId: rid("legacy-stop") });
      expect((await getCustomer(alice, id)).customer).toMatchObject({ industryCode: null, contactName: "行业未设置照常编辑", email: "edited@example.test" });
      await addCustomerFollowUp(alice, { customerId: id, requestId: rid("legacy-follow"), method: "email", content: "旧NULL继续跟进", occurredAt: "2026-11-03T10:00:00+08:00", nextFollowUpAt: null });
      let record = (await getCustomer(alice, id)).customer;
      await transferCustomer(owner, { id, version: record.version, assignedUserId: 3, reason: "旧NULL照常交接" });
      record = (await getCustomer(manager, id)).customer;
      expect(record.industryCode).toBeNull();
      await archiveCustomer(owner, { id, version: record.version, reason: "旧NULL归档" });
      record = (await getCustomer(manager, id)).customer;
      await restoreCustomer(owner, { id, version: record.version });
      expect(await storedIndustry(id)).toBeNull();
      await expect(getCustomer(alice, id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("合法行业不扩大本人/跨企业/显式只读/撤权范围，拒绝请求零业务变更", async () => {
      const mine = await createMulti(alice, multiInput("medical", "my-private"));
      const colleague = await createMulti(owner, multiInput("lighting", "owner-private", owner, "企业主私有客户"));
      const other = await createMulti(foreign, multiInput("automotive", "foreign", foreign, "外企业客户"));
      let before = await snapshot();
      const update = (id: number, scope = alice) => updateBasic(scope, { ...expected(scope), customerId: id, version: 1, data: basicData("other"), requestId: rid(`forbidden-${id}`), confirmDuplicate: true });
      await expect(update(colleague.id, { ...alice, canManageAll: true })).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(update(other.id, owner)).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(updateCustomer({ ...alice, canManageAll: true }, { id: colleague.id, version: 1, data: oldData("other"), confirmDuplicate: true })).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(updateCustomer(owner, { id: other.id, version: 1, data: oldData("other"), confirmDuplicate: true })).rejects.toMatchObject({ code: "NOT_FOUND" });
      expect(await snapshot()).toBe(before);
      await connection().query("INSERT INTO enterprise_member_module_access(enterpriseId,userId,module,readAllowed,writeAllowed,dataScope,revision) VALUES(1,2,'customers',1,0,'self',1)");
      before = await snapshot();
      await expect(update(mine.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(await snapshot()).toBe(before);
      await connection().query("DELETE FROM enterprise_member_module_access WHERE userId=2");
      await connection().query("DELETE FROM enterprise_member_permissions WHERE enterpriseMemberId=12");
      before = await snapshot();
      await expect(update(mine.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(await snapshot()).toBe(before);
      expect(await storedIndustry(mine.id)).toBe("medical");
    });

    it("冻结同团队显式授权可编辑行业，其他团队/无授权不得越界", async () => {
      await connection().query("INSERT INTO enterprise_teams(id,enterpriseId,status) VALUES(10,1,'active'),(20,1,'active')");
      await connection().query("INSERT INTO enterprise_team_members(enterpriseId,teamId,userId,teamRole) VALUES(1,10,2,'member'),(1,10,3,'leader'),(1,20,1,'leader')");
      await connection().query("INSERT INTO enterprise_member_module_access(enterpriseId,userId,module,readAllowed,writeAllowed,dataScope,revision) VALUES(1,3,'customers',1,1,'team',1)");
      const sameTeam = await createMulti(alice, multiInput("medical", "same-team"));
      const otherTeam = await createMulti(owner, multiInput("lighting", "other-team", owner, "其他团队客户"));
      await updateBasic(manager, { ...expected(manager), customerId: sameTeam.id, version: 1, data: basicData("renewable_energy"), requestId: rid("leader-edit") });
      expect(await storedIndustry(sameTeam.id)).toBe("renewable_energy");
      const before = await snapshot();
      await expect(updateBasic(manager, { ...expected(manager), customerId: otherTeam.id, version: 1, data: basicData("other"), requestId: rid("leader-outside") })).rejects.toMatchObject({ code: "NOT_FOUND" });
      expect(await snapshot()).toBe(before);
      const list = await listCustomers(manager, { keyword: "", scope: "all", archived: false, due: "all", page: 1, pageSize: 20 });
      expect(list.items.map(record => record.id)).toEqual([sameTeam.id]);
    });

    it("并发基本信息修改只允许一个版本获胜，不会产生分叉行业或重复审计", async () => {
      const created = await createMulti(alice, multiInput());
      const results = await Promise.allSettled(["medical", "automotive"].map((code, index) => updateBasic(alice, {
        ...expected(), customerId: created.id, version: 1, data: basicData(code, "多联系人行业客户"), requestId: rid(`parallel-${index}`),
      })));
      expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
      const failed = results.find(result => result.status === "rejected") as PromiseRejectedResult;
      expect(failed.reason).toMatchObject({ code: "CONFLICT" });
      expect(["medical", "automotive"]).toContain(await storedIndustry(created.id));
      const [audits] = await connection().query<RowDataPacket[]>("SELECT COUNT(*) AS count FROM crm_customer_contact_audits WHERE customerId=? AND action='basic_updated'", [created.id]);
      expect(Number(audits[0].count)).toBe(1);
      expect((await getCustomer(alice, created.id)).customer.version).toBe(2);
    });

    it("成员客户批量交接保留旧NULL与既有行业，不要求旧记录补全", async () => {
      const nullId = await legacy();
      const known = await createMulti(alice, multiInput("medical", "member-handoff"));
      const db = await getDb();
      if (!db) throw new Error("专用测试数据库未就绪");
      const count = await db.transaction(async tx => {
        await tx.execute(sql`SELECT id FROM enterprises WHERE id=1 FOR UPDATE`);
        await tx.execute(sql`SELECT id FROM enterprise_members WHERE enterpriseId=1 ORDER BY userId FOR UPDATE`);
        const customers = await listHandoffCustomers(tx, 1, 2, true);
        return transferHandoffCustomers(tx, { enterpriseId: 1, actorUserId: 1, previousUserId: 2, nextUserId: 3, requestId: rid("member-handoff-transfer"), customers });
      });
      expect(count).toBe(2);
      expect(await storedIndustry(nullId)).toBeNull();
      expect(await storedIndustry(known.id)).toBe("medical");
      expect((await getCustomer(manager, nullId)).customer.assignedUserId).toBe(3);
      expect((await getCustomer(manager, known.id)).customer.assignedUserId).toBe(3);
      const [audits] = await connection().query<RowDataPacket[]>("SELECT COUNT(*) AS count FROM crm_customer_audits WHERE action='member_handoff' AND requestId=?", [rid("member-handoff-transfer")]);
      expect(Number(audits[0].count)).toBe(2);
      await expect(getCustomer(alice, nullId)).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("createMulti同键改变行业冲突，原哈希重放仍精确返回原客户", async () => {
      const input = multiInput("semiconductor", "multi-idempotent");
      const created = await createMulti(alice, input);
      const before = await snapshot();
      await expect(createMulti(alice, { ...input, data: { ...input.data, industryCode: "medical" } })).rejects.toMatchObject({ code: "CONFLICT" });
      expect(await snapshot()).toBe(before);
      expect(await createMulti(alice, createMultiSchema.parse(input))).toEqual({ id: created.id, replayed: true });
      expect(await snapshot()).toBe(before);
    });
  });
}
