import { describe, expect, it } from "vitest";
import {
  mergeOfficialInventoryPermissions,
  officialPayloadHash,
} from "./officialTeams";
import {
  normalizeAssignedAdminPermissions,
  resolveAdminPermissions,
} from "../../shared/adminPermissions";

describe("官方团队原生权限合并（隔离）", () => {
  it("新增 write/publish/note 时均按原生归一化补 officialInventory.read", () => {
    for (const permission of [
      "officialInventory.write",
      "officialInventory.publish",
      "officialInventory.note",
    ]) {
      expect(normalizeAssignedAdminPermissions([permission])).toEqual(
        expect.arrayContaining([
          permission,
          "officialInventory.read",
          "profile.manage",
        ])
      );
    }
  });

  it("四项官方权限可分配，而 officialTeams.manage 永远不进入普通可分配集", () => {
    const normalized = normalizeAssignedAdminPermissions([
      "officialInventory.publish",
      "officialTeams.manage",
    ]);
    expect(normalized).toContain("officialInventory.publish");
    expect(normalized).toContain("officialInventory.read");
    expect(normalized).not.toContain("officialTeams.manage");
    expect(
      resolveAdminPermissions("operation", ["officialTeams.manage"])
    ).not.toContain("officialTeams.manage");
  });

  it("初次为无显式记录的旧账号设置官方权限时，保留其既有角色有效权限", () => {
    const result = mergeOfficialInventoryPermissions(
      "operation",
      [],
      ["officialInventory.publish"]
    );
    expect(result.permissions).toEqual(
      expect.arrayContaining([
        "materials.read",
        "materials.write",
        "merchants.read",
        "officialInventory.read",
        "officialInventory.publish",
        "profile.manage",
      ])
    );
    expect(result.officialPermissions).toEqual([
      "officialInventory.publish",
      "officialInventory.read",
    ]);
  });

  it("替换四项官方权限时保留已有其他显式原生授权并去除未选择的官方项", () => {
    const result = mergeOfficialInventoryPermissions(
      "merchant_mgr",
      [
        "merchants.read",
        "orders.read",
        "officialInventory.write",
        "officialInventory.read",
        "profile.manage",
      ],
      ["officialInventory.note"]
    );
    expect(result.permissions).toEqual(
      expect.arrayContaining([
        "merchants.read",
        "orders.read",
        "officialInventory.note",
        "officialInventory.read",
        "profile.manage",
      ])
    );
    expect(result.permissions).not.toContain("officialInventory.write");
  });

  it("审计 payload hash 与键插入顺序无关，但字段差异必然冲突", () => {
    expect(officialPayloadHash({ b: 2, a: { z: true, x: 1 } })).toBe(
      officialPayloadHash({ a: { x: 1, z: true }, b: 2 })
    );
    expect(officialPayloadHash({ action: "setMember", teamId: 1 })).not.toBe(
      officialPayloadHash({ action: "setMember", teamId: 2 })
    );
  });
});
