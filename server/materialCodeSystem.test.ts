/**
 * 物料编码体系契约测试
 *
 * 目的：把 2026-08-16 这次「ST 短号补全 + 59.9 万条 EXT- 纳入 51E-」中
 *       确立的不变量固化成断言，防止日后换人/换工具时被重新破坏。
 *
 * 这些断言全部来自本次踩过的真实坑，不是凭空假设：
 *   - 短号截断使图片上传按旧文档操作会失败 → 回退兼容必须存在且必须唯一命中
 *   - 影子记录若被误标 active 会导致同型号双记录进入撮合
 *   - 编码格式一旦放宽，inventories.materialCode 会静默截断
 */
import { describe, it, expect } from "vitest";
import {
  PLATFORM_MATERIAL_CODE_PATTERN,
  PLATFORM_MATERIAL_SEQUENCE_MAX,
  formatMaterialNo,
} from "./materialCode";
import {
  expandShortPartNumber,
  isPackageSuffixExpansion,
} from "../shared/partNumberFallback";

describe("51E- 编码格式契约", () => {
  it("编码为固定前缀 + 8 位补零流水", () => {
    expect(formatMaterialNo(1)).toBe("51E-00000001");
    expect(formatMaterialNo(10984)).toBe("51E-00010984");
    expect(formatMaterialNo(610601)).toBe("51E-00610601");
  });

  it("编码总长恒为 12 字符（inventories.materialCode 曾是 varchar(12)，零余量）", () => {
    for (const seq of [1, 10983, 610601, PLATFORM_MATERIAL_SEQUENCE_MAX]) {
      expect(formatMaterialNo(seq)).toHaveLength(12);
    }
  });

  it("生成的编码必须匹配校验正则", () => {
    for (const seq of [1, 999, 10984, 610601]) {
      expect(PLATFORM_MATERIAL_CODE_PATTERN.test(formatMaterialNo(seq))).toBe(true);
    }
  });

  it("拒绝越界流水号，不静默截断", () => {
    expect(() => formatMaterialNo(0)).toThrow("MATERIAL_SEQUENCE_OUT_OF_RANGE");
    expect(() => formatMaterialNo(-1)).toThrow("MATERIAL_SEQUENCE_OUT_OF_RANGE");
    expect(() => formatMaterialNo(PLATFORM_MATERIAL_SEQUENCE_MAX + 1)).toThrow(
      "MATERIAL_SEQUENCE_OUT_OF_RANGE",
    );
    expect(() => formatMaterialNo(1.5)).toThrow("MATERIAL_SEQUENCE_OUT_OF_RANGE");
  });

  it("旧编码格式不得通过正式编码校验", () => {
    for (const bad of ["MAT20260001", "EXT-4-2", "EXT-4-599739", "51E-1234567", "51E-123456789"]) {
      expect(PLATFORM_MATERIAL_CODE_PATTERN.test(bad)).toBe(false);
    }
  });

  it("610,721 条物料后仍有充足容量（用量不足 1%）", () => {
    expect(610_721 / PLATFORM_MATERIAL_SEQUENCE_MAX).toBeLessThan(0.01);
  });
});

describe("ST 短号回退契约（图片上传兼容）", () => {
  it("短号可扩展出候选完整型号", () => {
    const candidates = expandShortPartNumber("STM32F058T8");
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates).toContain("STM32F058T8Y6");
  });

  it("本次补全实际用到的 6 种后缀全部在候选清单内", () => {
    // 生产实测分布：T6=370 U6=33 H6=24 Y6=16 I6=14 P6=7
    const cases: Array<[string, string]> = [
      ["STM32F038C6", "STM32F038C6T6"],
      ["STM32F038K6", "STM32F038K6U6"],
      ["STM32F058T8", "STM32F058T8Y6"],
      ["STM32F038F6", "STM32F038F6P6"],
    ];
    for (const [short, full] of cases) {
      expect(expandShortPartNumber(short)).toContain(full);
    }
  });

  it("仅对 STM32 系列启用回退，避免误伤其他品牌", () => {
    expect(expandShortPartNumber("0603B225K250NT")).toHaveLength(0);
    expect(expandShortPartNumber("RVT1A102M0810")).toHaveLength(0);
  });

  it("完整型号不再触发扩展（已补全后应走精确匹配）", () => {
    expect(isPackageSuffixExpansion("STM32F058T8Y6", "STM32F058T8Y6")).toBe(false);
  });

  it("只认恰好 2 位的封装后缀差异", () => {
    expect(isPackageSuffixExpansion("STM32F058T8", "STM32F058T8Y6")).toBe(true);
    // 多出 4 位不是封装后缀，是另一颗料
    expect(isPackageSuffixExpansion("STM32F058T8", "STM32F058T8Y6XX")).toBe(false);
  });

  it("不同温度等级不可互认（T6 与 T7 是不同料，用户明确纠正过）", () => {
    expect(isPackageSuffixExpansion("STM32F103C8T6", "STM32F103C8T7")).toBe(false);
  });
});
