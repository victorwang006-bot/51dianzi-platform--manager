import { z } from "zod";

/** 日期只存无时区ISO；界面按日/月/年显示。不对非法日历日期作滚动修正。 */
export function normalizeHkDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  const dmy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text);
  if (!iso && !dmy) return null;
  const [year, month, day] = iso
    ? [Number(iso[1]), Number(iso[2]), Number(iso[3])]
    : [Number(dmy![3]), Number(dmy![2]), Number(dmy![1])];
  const date = new Date(Date.UTC(year, month - 1, day));
  if (year < 1900 || year > 2200 || date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function displayHkDate(value: unknown): string {
  const iso = normalizeHkDate(value);
  return iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : "";
}

export function hkToday(): string {
  return new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

const requiredText = (label: string, max: number) => z.string().trim().min(1, `请输入${label}`).max(max);
const optionalText = (max: number) => z.string().trim().max(max).default("");
const dateField = z.string().transform(normalizeHkDate).pipe(z.string({ error: "请输入有效日期（日/月/年）" }));

export const hkRegistrationDataSchema = z.object({
  companyName: requiredText("企业名称", 128),
  chineseName: optionalText(128),
  businessNature: requiredText("企业性质（业务性质）", 128),
  legalStatus: requiredText("法律地位", 64),
  brn: z.string().trim().regex(/^\d{8}$/, "请输入8位商业登记号码BRN"),
  registrationNumber: z.string().trim().transform(value => value.replace(/\s+/g, "-")).pipe(z.string().regex(/^\d{8}-\d{3}-\d{2}-\d$/, "请输入BR完整登记证号码")),
  brStartDate: dateField,
  brExpiryDate: dateField,
  ciNumber: requiredText("公司注册证编号", 32),
  establishedAt: z.string().trim().default("").refine(v => !v || Boolean(normalizeHkDate(v)), "请输入有效成立日期"),
  regAddress: requiredText("营业地址", 255),
  bankAccountName: requiredText("账户名称", 128),
  /** 香港账号保留前导零和连字符；不使用内地的仅数字清洗。 */
  bankAccountNumber: z.string().trim().min(1, "请输入账户号码").max(64).regex(/^[A-Za-z0-9][A-Za-z0-9 -]*$/, "账户号码格式无效"),
  bankName: requiredText("开户行", 128),
  bankAddress: optionalText(255),
  swift: optionalText(32),
  bankCode: optionalText(32),
  companyRole: optionalText(64),
  salesOwner: optionalText(64),
  salesOwnerCode: optionalText(64),
}).superRefine((data, ctx) => {
  if (data.registrationNumber.slice(0, 8) !== data.brn) ctx.addIssue({ code: "custom", path: ["brn"], message: "BRN必须与完整登记证号码前8位一致" });
  if (data.brStartDate > data.brExpiryDate) ctx.addIssue({ code: "custom", path: ["brExpiryDate"], message: "BR届满日期不能早于生效日期" });
  if (data.brExpiryDate < hkToday()) ctx.addIssue({ code: "custom", path: ["brExpiryDate"], message: "BR已过期，请上传最新有效商业登记证" });
  if (data.brStartDate > hkToday()) ctx.addIssue({ code: "custom", path: ["brStartDate"], message: "BR尚未生效" });
  if (data.establishedAt && normalizeHkDate(data.establishedAt)! > hkToday()) ctx.addIssue({ code: "custom", path: ["establishedAt"], message: "成立日期不能晚于今天" });
  if (/SOLE|PARTNERSHIP|独资|獨資|合伙|合夥/i.test(data.legalStatus)) ctx.addIssue({ code: "custom", path: ["legalStatus"], message: "当前路线仅适用香港注册公司；独资／合伙请联系客服核验主体，无需提供公司CI" });
});

export type HkRegistrationData = z.infer<typeof hkRegistrationDataSchema>;
export type HkDocumentKind = "BR" | "CI" | "BANK";
export type HkExtractedFields = Partial<HkRegistrationData>;

export function hkRegistrationIdentifier(brn: string): string {
  if (!/^\d{8}$/.test(brn)) throw new Error("香港BRN必须为8位数字");
  return `HK:${brn}`;
}

export function companyRegistrationIdentifier(company: { registrationRegion?: string | null; registrationIdentifier?: string | null; creditCode?: string | null }): string | null {
  if (company.registrationRegion === "HK") return /^HK:\d{8}$/.test(company.registrationIdentifier || "") ? company.registrationIdentifier! : null;
  return company.creditCode ? `CN:${company.creditCode.replace(/\s/g, "").toUpperCase()}` : null;
}
