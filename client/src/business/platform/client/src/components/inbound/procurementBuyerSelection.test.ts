import { describe, expect, it } from "vitest";
import { emptyInboundBulkRow } from "../../../../shared/inboundBulkImport";
import { attachImportedProcurementBuyer, defaultProcurementBuyer, matchImportedProcurementBuyer, procurementBuyerDraftError, procurementBuyerOptionLabel, readProcurementBuyerScope, selectedProcurementBuyer, type ProcurementBuyerScope } from "./procurementBuyerSelection";

const scope: ProcurementBuyerScope = { actorUserId: 7002, canChooseBuyer: true, teamId: 9, scope: "team", options: [{ userId: 7002, name: "采购甲", username: "buyer-a" }, { userId: 7003, name: "采购乙", username: "Buyer-B" }] };

describe("procurement buyer selection", () => {
  it("accepts the bound front actor, not an admin ID, and rejects malformed candidates", () => {
    expect(readProcurementBuyerScope(scope, 7002)).toEqual(scope);
    expect(readProcurementBuyerScope(scope, 6001)).toBeNull();
    expect(readProcurementBuyerScope({ ...scope, canChooseBuyer: undefined }, 7002)).toBeNull();
    expect(readProcurementBuyerScope({ ...scope, options: [...scope.options, scope.options[0]] }, 7002)).toBeNull();
    expect(readProcurementBuyerScope({ ...scope, options: [{ userId: 0, name: "无效" }] }, 7002)).toBeNull();
    expect(readProcurementBuyerScope(null, 7002)).toBeNull();
  });
  it("defaults only to actor if available, never the first other member", () => {
    expect(defaultProcurementBuyer(scope)?.userId).toBe(7002);
    expect(defaultProcurementBuyer({ ...scope, options: [scope.options[1]] })).toBeNull();
  });
  it("uses canChooseBuyer as the only choice truth and fails closed on missing self", () => {
    const self = { ...scope, canChooseBuyer: false, scope: "self" as const };
    expect(selectedProcurementBuyer(self, "7002")?.name).toBe("采购甲");
    expect(selectedProcurementBuyer(self, "7003")).toBeNull();
    expect(readProcurementBuyerScope({ ...self, options: [scope.options[1]] }, 7002)).toBeNull();
    expect(selectedProcurementBuyer(scope, "7003junk")).toBeNull();
  });
  it("matches unique exact case-insensitive name or username", () => {
    expect(matchImportedProcurementBuyer(" 采购乙 ", scope).buyer?.userId).toBe(7003);
    expect(matchImportedProcurementBuyer(" buyer-b ", scope).buyer?.userId).toBe(7003);
    expect(matchImportedProcurementBuyer("buyer", scope).buyer).toBeNull();
    expect(matchImportedProcurementBuyer("", scope).buyer).toBeNull();
  });
  it("rejects duplicate names and name/username collisions without silently picking first", () => {
    const duplicates = { ...scope, options: [...scope.options, { userId: 7004, name: "采购乙", username: "unique-c" }] };
    expect(matchImportedProcurementBuyer("采购乙", duplicates).error).toContain("重名");
    expect(matchImportedProcurementBuyer("unique-c", duplicates).buyer?.userId).toBe(7004);
    const collision = { ...scope, options: [...scope.options, { userId: 7004, name: "buyer-b" }] };
    expect(matchImportedProcurementBuyer("BUYER-B", collision).buyer).toBeNull();
  });
  it("rejects foreign/inactive/unknown imports and never rewrites other buyer to self", () => {
    const row = { ...emptyInboundBulkRow(2), operator: "采购乙" };
    const imported = attachImportedProcurementBuyer(row, { ...scope, canChooseBuyer: false });
    expect(imported.operator).toBe("采购乙");
    expect(imported.buyerUserId).toBe("");
    expect(imported.buyerImportError).toContain("本人");
    expect(matchImportedProcurementBuyer("外组采购员", scope).error).toContain("不在本次可选范围");
    expect(matchImportedProcurementBuyer("采购甲", null).buyer).toBeNull();
  });
  it("invalidates an existing draft when options or actor permission change", () => {
    const imported = attachImportedProcurementBuyer({ ...emptyInboundBulkRow(2), operator: "buyer-b" }, scope);
    expect(imported).toMatchObject({ buyerUserId: "7003", operator: "采购乙" });
    expect(procurementBuyerDraftError(imported, scope)).toBe("");
    expect(procurementBuyerDraftError(imported, { ...scope, options: [scope.options[0]] })).not.toBe("");
    expect(procurementBuyerDraftError(imported, { ...scope, canChooseBuyer: false })).not.toBe("");
    expect(procurementBuyerDraftError(imported, null)).not.toBe("");
  });
  it("displays the actual API name and username, including username-only candidates", () => {
    expect(procurementBuyerOptionLabel(scope.options[1])).toBe("采购乙（Buyer-B）");
    const usernameOnly = readProcurementBuyerScope({ ...scope, options: [{ userId: 7002, name: "", username: "real-account" }] }, 7002)!;
    expect(defaultProcurementBuyer(usernameOnly)?.name).toBe("real-account");
  });
});
