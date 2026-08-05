import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  formatMaterialNo,
  PLATFORM_MATERIAL_CODE_PATTERN,
  PLATFORM_MATERIAL_SEQUENCE_KEY,
  PLATFORM_MATERIAL_SEQUENCE_MAX,
} from "./materialCode";

describe("平台物料编码格式", () => {
  it("使用固定 51E 前缀和 8 位全局流水", () => {
    expect(formatMaterialNo(1)).toBe("51E-00000001");
    expect(formatMaterialNo(10_983)).toBe("51E-00010983");
    expect(formatMaterialNo(PLATFORM_MATERIAL_SEQUENCE_MAX)).toBe("51E-99999999");
    expect(PLATFORM_MATERIAL_CODE_PATTERN.test(formatMaterialNo(42))).toBe(true);
    expect(PLATFORM_MATERIAL_SEQUENCE_KEY).toBe("platform_material");
  });

  it.each([0, -1, 1.5, Number.NaN, PLATFORM_MATERIAL_SEQUENCE_MAX + 1])(
    "拒绝非法序列值 %s",
    value => {
      expect(() => formatMaterialNo(value)).toThrow("MATERIAL_SEQUENCE_OUT_OF_RANGE");
    },
  );
});

describe("平台物料编码发号契约", () => {
  const dbSource = readFileSync(fileURLToPath(new URL("./db.ts", import.meta.url)), "utf8");
  const routerSource = readFileSync(fileURLToPath(new URL("./routers.ts", import.meta.url)), "utf8");
  const materialsPageSource = readFileSync(
    fileURLToPath(new URL("../client/src/pages/Materials.tsx", import.meta.url)),
    "utf8",
  );

  it("在数据库事务内锁定全局序列行，不再按分类或 MAX(materialNo) 推号", () => {
    expect(dbSource).toContain("db.transaction");
    expect(dbSource).toContain('.for("update")');
    expect(dbSource).toContain("materialNumberSequences");
    expect(dbSource).not.toContain("CATEGORY_CODE_MAP");
    expect(dbSource).not.toMatch(/MAX\(materialNo\)/i);
  });

  it("拒绝通过普通更新修改已分配的平台码", () => {
    expect(dbSource).toContain('hasOwnProperty.call(data, "materialNo")');
    expect(dbSource).toContain("MATERIAL_CODE_IMMUTABLE");
  });

  it("生产环境禁止物理删除，旧 remove 路由仅软归档并保留主档", () => {
    expect(dbSource).toContain("export async function deleteMaterial(_id: number): Promise<never>");
    expect(dbSource).toContain("MATERIAL_PHYSICAL_DELETE_FORBIDDEN");
    expect(dbSource).toContain('process.env.VITEST !== "true"');
    expect(dbSource).toContain("archiveMaterial");
    expect(routerSource).toContain("await db.archiveMaterial");
    expect(routerSource).not.toContain("await db.deleteMaterial(input.id)");
  });

  it("物料创建、修改与停用原子写入审计日志，后台不再展示物理删除入口", () => {
    expect(dbSource).toContain("tx.insert(auditLogs)");
    expect(dbSource).toContain('action: "material.create"');
    expect(dbSource).toContain('action: "material.archive"');
    expect(materialsPageSource).not.toContain("trpc.material.remove.useMutation");
    expect(materialsPageSource).not.toContain("确认删除物料");
  });
});
