export type OfficialMaterialResource = {
  publicId: string; revision: number; partNumber: string; brand: string; pkg: string;
  category: string | null; description: string | null;
  parameters: Array<{ name: string; value: string }>; datasheetUrl: string | null;
};
export type OfficialMaterialDictionary = {
  partNumber: string; brand: string; package: string;
  name: string; category: string; description: string;
  specs: Record<string, string>; datasheetUrl?: string;
} | null;
