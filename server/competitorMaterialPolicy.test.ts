import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  containsCompetitorDisplayName,
  sanitizeCompetitorDisplayText,
} from "../shared/competitorDisplayPolicy";
import { materialInput } from "./routers";

const read = (relative: string) => readFileSync(new URL(relative, import.meta.url), "utf8");
const db = read("./db.ts");
const migration = read("../drizzle/0023_hide_competitor_materials.sql");
const runner = read("../scripts/apply-competitor-material-policy.mjs");
const deploy = read("../deploy/deploy-admin.sh");
const journal = read("../drizzle/meta/_journal.json");

describe("manager competitor material policy", () => {
  it("detects normalized competitor names and keeps unrelated manufacturers", () => {
    for (const value of ["嘉立创专用劳保", "立创服务", "LCSC", "SZLCSC", "szlcsc.com", "jlc-pcb", "JLC EDA"]) {
      expect(containsCompetitorDisplayName(value)).toBe(true);
      expect(sanitizeCompetitorDisplayText(value)).toBe("");
    }
    expect(containsCompetitorDisplayName("STMicroelectronics")).toBe(false);
    expect(containsCompetitorDisplayName("立讯精密")).toBe(false);
  });

  it("blocks future manager material writes containing competitor metadata", () => {
    const valid = {
      partNumber: "STM32F103C8T6",
      name: "微控制器",
      brand: "ST",
      category: "芯片IC",
      description: "32 位 MCU",
    };
    expect(materialInput.safeParse(valid).success).toBe(true);
    expect(materialInput.safeParse({ ...valid, category: "嘉立创专用实验品" }).success).toBe(false);
    expect(materialInput.safeParse({ ...valid, description: "Imported from LCSC" }).success).toBe(false);
  });

  it("filters list, detail, lookup, specification, category, brand, and public search outputs", () => {
    expect(db).toContain("function safeMaterialMetadataCondition()");
    expect(db).toContain("const conditions = [safeMaterialMetadataCondition()]");
    expect(db).toContain("and(eq(materials.id, id), safeMaterialMetadataCondition())");
    expect(db.match(/safeMaterialMetadataCondition\(\)/g)?.length).toBeGreaterThanOrEqual(8);
    expect(db).toContain("sanitizeCompetitorDisplayText(r.category)");
    expect(db).toContain("sanitizeCompetitorDisplayText(r.brand)");
  });

  it("registers and runs an idempotent pre-switch cleanup that leaves zero enabled matches", () => {
    expect(migration).toContain("UPDATE `materials`");
    expect(migration).toContain("SET `status` = 'disabled'");
    expect(migration).toContain("LIKE '%立创%'");
    expect(migration).toContain("LIKE '%lcsc%'");
    expect(runner).toContain("dianzi51_competitor_material_policy_v1");
    expect(runner).toContain("enabledAfter");
    expect(runner).toContain("remaining !== 0");
    expect(deploy).toContain("apply-competitor-material-policy.mjs");
    expect(deploy.indexOf("apply-competitor-material-policy.mjs")).toBeLessThan(deploy.indexOf("=== 5. 原子切换软链 ==="));
    expect(journal).toContain('"tag": "0023_hide_competitor_materials"');
  });
});
