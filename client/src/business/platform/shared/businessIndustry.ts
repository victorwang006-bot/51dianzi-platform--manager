import { z } from "zod";

export const BUSINESS_INDUSTRY_OPTIONS = [
  { value: "semiconductor", label: "半导体与集成电路" },
  { value: "electronic_components", label: "电子元器件" },
  { value: "consumer_electronics", label: "消费电子" },
  { value: "communications", label: "通信与网络设备" },
  { value: "computers_servers", label: "计算机与服务器" },
  { value: "automotive", label: "汽车电子" },
  { value: "industrial_automation", label: "工业自动化" },
  { value: "instrumentation", label: "仪器仪表" },
  { value: "medical", label: "医疗电子" },
  { value: "renewable_energy", label: "新能源与储能" },
  { value: "power_electronics", label: "电力电子" },
  { value: "iot_smart_hardware", label: "物联网与智能硬件" },
  { value: "security", label: "安防设备" },
  { value: "lighting", label: "照明" },
  { value: "home_appliances", label: "家电" },
  { value: "aerospace_defense", label: "航空航天" },
  { value: "rail_transportation", label: "轨道交通" },
  { value: "electronic_manufacturing", label: "电子制造与代工" },
  { value: "component_distribution", label: "元器件分销" },
  { value: "software_it", label: "软件与信息服务" },
  { value: "education_research", label: "教育科研" },
  { value: "other", label: "其他" },
] as const;

export type BusinessIndustryCode = (typeof BUSINESS_INDUSTRY_OPTIONS)[number]["value"];
export const BUSINESS_INDUSTRY_CODES = BUSINESS_INDUSTRY_OPTIONS.map(option => option.value) as [BusinessIndustryCode, ...BusinessIndustryCode[]];
export const businessIndustryCodeSchema = z.enum(BUSINESS_INDUSTRY_CODES, { error: "请选择所属行业" });

/** Preserve legacy NULL and unknown stored codes without guessing a historical industry. */
export function getBusinessIndustryLabel(code: string | null | undefined): string {
  if (!code?.trim()) return "未设置";
  return BUSINESS_INDUSTRY_OPTIONS.find(option => option.value === code)?.label ?? "未识别行业";
}
