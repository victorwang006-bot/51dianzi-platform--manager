import { describe, expect, it } from "vitest";
import {
  expandShortPartNumber,
  isPackageSuffixExpansion,
  ST_PACKAGE_TEMP_SUFFIXES,
} from "../shared/partNumberFallback";

/**
 * 契约测试：图片上传短号兼容。
 *
 * 守护的真实风险：
 * 2026-08 将 464 条 ST 物料 partNumber 由短号补全为完整型号后，
 * 图片上传 API 文档仍记载「库内型号不含封装后缀」，运营按短号上传。
 * 若回退能力被移除或放宽，后果分别是：
 *   - 移除 → 所有图片上传报「型号不存在」，链路中断
 *   - 放宽 → 图片可能挂到另一颗真实存在的料上，造成错图
 * 两者都必须拦住。
 */
describe("图片上传短号兼容契约", () => {
  describe("短号扩展", () => {
    it("短号能扩展出完整型号候选", () => {
      const candidates = expandShortPartNumber("STM32F038K6");
      expect(candidates).toContain("STM32F038K6U6");
      expect(candidates).toContain("STM32F038K6T6");
      expect(candidates.length).toBe(ST_PACKAGE_TEMP_SUFFIXES.length);
    });

    it("大小写不敏感", () => {
      expect(expandShortPartNumber("stm32f038k6")).toContain("STM32F038K6U6");
    });

    it("已是完整长度的型号不再扩展（避免无意义候选）", () => {
      expect(expandShortPartNumber("STM32F103C8T6")).toEqual([]);
    });

    it("非 STM32 系列不扩展（防止为无关型号生成大量候选）", () => {
      expect(expandShortPartNumber("CC0402MRX5R5BB475")).toEqual([]);
      expect(expandShortPartNumber("1N4148")).toEqual([]);
      expect(expandShortPartNumber("TPS54331DR")).toEqual([]);
    });

    it("空值安全", () => {
      expect(expandShortPartNumber("")).toEqual([]);
      expect(expandShortPartNumber("   ")).toEqual([]);
    });
  });

  describe("扩展关系校验", () => {
    it("生产库真实样例全部成立", () => {
      // 来源：生产库 464 条实测，图片文件名即完整型号
      const cases: [string, string][] = [
        ["STM32F058T8", "STM32F058T8Y6"],
        ["STM32F038C6", "STM32F038C6T6"],
        ["STM32F038K6", "STM32F038K6U6"],
        ["STM32F038G6", "STM32F038G6U6"],
        ["STM32F098VC", "STM32F098VCT6"],
        ["STM32F038F6", "STM32F038F6P6"],
      ];
      for (const [short, full] of cases) {
        expect(isPackageSuffixExpansion(short, full)).toBe(true);
      }
    });

    it("多出的位数不在后缀清单内则不成立", () => {
      // XX 不是已知封装后缀
      expect(isPackageSuffixExpansion("STM32F038C6", "STM32F038C6XX")).toBe(false);
      // 多出 3 位不符合固定 2 位规则
      expect(isPackageSuffixExpansion("STM32F038C6", "STM32F038C6T6A")).toBe(false);
    });

    it("不同基础型号不成立（防止挂错料）", () => {
      expect(isPackageSuffixExpansion("STM32F038C6", "STM32F038C8T6")).toBe(false);
      expect(isPackageSuffixExpansion("STM32F038C6", "STM32F103C8T6")).toBe(false);
    });

    it("反向与等长不成立", () => {
      expect(isPackageSuffixExpansion("STM32F038C6T6", "STM32F038C6")).toBe(false);
      expect(isPackageSuffixExpansion("STM32F038C6", "STM32F038C6")).toBe(false);
    });
  });

  describe("与撮合白名单的语义隔离", () => {
    it("T6/T7 在本模块必须被接受（同一记录的两种写法）", () => {
      /**
       * 关键区别：撮合场景下 T6/T7 是【不同料】（温度等级不同，
       * 混推会造成选型事故），故 front/shared/partNumber.ts 明确排除它们。
       * 但本模块处理的是【同一条记录】补全前后的两种写法，必须接受。
       * 这两份清单语义相反，绝不可合并共用。
       */
      expect(ST_PACKAGE_TEMP_SUFFIXES).toContain("T6");
      expect(isPackageSuffixExpansion("STM32F038C6", "STM32F038C6T6")).toBe(true);
    });

    it("后缀清单必须全为 2 位（ST 命名规则）", () => {
      for (const s of ST_PACKAGE_TEMP_SUFFIXES) {
        expect(s.length).toBe(2);
      }
    });
  });
});
