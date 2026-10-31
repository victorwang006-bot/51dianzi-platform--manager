import { createRequire } from "node:module";

export type PublicInventoryLocationSource = "warehouse" | "supplier_region" | "unknown";

export type PublicInventoryLocation = {
  label: string | null;
  source: PublicInventoryLocationSource;
};

type RegionNode = {
  name: string;
  children?: RegionNode[];
};

const require = createRequire(import.meta.url);
const regionLevels = require("@province-city-china/level/level.json") as RegionNode[];

const DIRECT_REGION_PROVINCES = new Set([
  "北京市",
  "上海市",
  "天津市",
  "重庆市",
  "香港特别行政区",
  "澳门特别行政区",
]);
const SAFE_AREA_WAREHOUSES = /^(?:华东|华南|华北|华中|西南|西北|东北|全国|境外)(?:总)?仓$/;

function publicRegionLabel(fullName: string) {
  return fullName.replace(/(?:特别行政区|自治州|地区|市|盟)$/, "");
}

/**
 * 全国省市区标准数据中的城市/地级行政区白名单。
 * 只会返回字典中已经存在的标签，不从用户输入中自由截取任意汉字。
 */
const PUBLIC_REGIONS = regionLevels
  .flatMap(province => {
    if (DIRECT_REGION_PROVINCES.has(province.name)) {
      return [{ fullName: province.name, label: publicRegionLabel(province.name) }];
    }
    return (province.children ?? [])
      .map(region => ({ fullName: region.name, label: publicRegionLabel(region.name) }))
      .filter(region => region.label && region.label !== "市辖区" && region.label !== "县");
  })
  .sort((left, right) => right.fullName.length - left.fullName.length);

function normalized(value: string | null | undefined) {
  return String(value ?? "").normalize("NFKC").replace(/\s+/g, "").trim();
}

function coarseRegion(value: string | null | undefined) {
  const text = normalized(value);
  if (!text) return null;
  const matched = PUBLIC_REGIONS.find(region =>
    text.includes(region.fullName)
    || text === region.label
    || text.startsWith(`${region.label}仓`)
  );
  return matched?.label || null;
}

function safeWarehouseLabel(value: string | null | undefined) {
  const text = normalized(value);
  if (!text) return null;
  const region = coarseRegion(text);
  if (region) return `${region}仓`;
  if (SAFE_AREA_WAREHOUSES.test(text)) return text;
  return null;
}

/**
 * 生成可在匿名行情页公开的粗粒度库存位置。
 *
 * 原始 warehouseAddress 可能来自历史编辑数据并包含完整门牌或联系方式，
 * 因此绝不原样返回：优先匹配全国标准地区字典并压缩为城市/仓名；
 * 无法安全匹配时，仅尝试从已公开企业注册地址匹配同一标准地区字典。
 */
export function buildPublicInventoryLocation(
  warehouseAddress: string | null | undefined,
  supplierAddress: string | null | undefined,
): PublicInventoryLocation {
  const warehouse = safeWarehouseLabel(warehouseAddress);
  if (warehouse) return { label: warehouse, source: "warehouse" };

  const supplierRegion = coarseRegion(supplierAddress);
  if (supplierRegion) return { label: supplierRegion, source: "supplier_region" };

  return { label: null, source: "unknown" };
}

/**
 * 从一条行情库存记录中移除全部原始地址，只留下脱敏位置。
 * 返回对象可直接用于匿名 market.detail 响应，调用方不得再扩散原始 row。
 */
export function redactMarketInventoryLocation<
  T extends { warehouseAddress: string | null; supplierAddress: string | null },
>(row: T) {
  const { warehouseAddress, supplierAddress, ...publicRow } = row;
  const publicLocation = buildPublicInventoryLocation(warehouseAddress, supplierAddress);
  return {
    ...publicRow,
    inventoryLocation: publicLocation.label,
    inventoryLocationSource: publicLocation.source,
  };
}
