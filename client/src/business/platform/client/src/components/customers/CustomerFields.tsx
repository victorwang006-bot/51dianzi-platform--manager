import { useEffect, useId, type Dispatch, type ReactNode, type SetStateAction } from "react";
import {
  CUSTOMER_GRADE_LABELS, CUSTOMER_GRADES, CUSTOMER_SCALE_LABELS, CUSTOMER_SCALES,
  CUSTOMER_STAGE_LABELS, CUSTOMER_STAGES, type CustomerMember,
} from "../../../../shared/crmCustomers";
import { Input } from "../ui/input";
import { BeijingDateTimePicker } from "./BeijingDateTimePicker";
import { Textarea } from "../ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import type { CustomerFormState } from "./customerUtils";
import type { CustomerFieldErrors } from "./customerValidation";

const inputClass = "h-8 !h-8 !text-xs bg-white border-slate-300 shadow-none";
type Props = {
  value: CustomerFormState; onChange: Dispatch<SetStateAction<CustomerFormState>>;
  members: CustomerMember[]; canManageAll: boolean; allowAssigneeChange?: boolean;
  currentAssigneeName?: string; includeInitialFollowUp?: boolean; disabled?: boolean;
  fieldErrors?: CustomerFieldErrors; nameError?: string; nameAction?: ReactNode;
  /** Multi-contact routes own contactName/phone/email separately and must not overwrite legacy fields. */
  includeLegacyContactFields?: boolean;
};

export function CustomerFields({ value, onChange, members, canManageAll, allowAssigneeChange = true,
  currentAssigneeName, includeInitialFollowUp = false, disabled = false, fieldErrors = {}, nameError, nameAction,
  includeLegacyContactFields = true }: Props) {
  const prefix = useId();
  const errors = { ...fieldErrors, ...(nameError ? { name: nameError } : {}) };
  const set = <K extends keyof CustomerFormState>(key: K, next: CustomerFormState[K]) => onChange(current => ({ ...current, [key]: next }));
  const props = (key: keyof CustomerFormState, label: string, required = false) => ({
    id: `${prefix}-${key}`, "data-customer-field": key, "aria-label": label,
    "aria-required": required, "aria-invalid": Boolean(errors[key]),
    "aria-describedby": errors[key] ? `${prefix}-${key}-error` : undefined, disabled,
  });
  useEffect(() => {
    const keys = Object.keys(fieldErrors);
    if (!keys.length) return;
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => {
        const node = document.getElementById(`${prefix}-${keys[0]}`);
        node?.focus();
        node?.scrollIntoView({ block: "nearest" });
      });
    });
    return () => { cancelAnimationFrame(first); cancelAnimationFrame(second); };
  }, [fieldErrors, prefix]);
  const field = (key: keyof CustomerFormState, label: string, child: ReactNode, required = false, spanClass = "") => <div className={`min-w-0 ${spanClass}`}>
    <label htmlFor={`${prefix}-${key}`} className="mb-1 block text-xs text-slate-600">{required && <span className="mr-1 text-red-700">*</span>}{label}</label>
    {child}
    {errors[key] && <p id={`${prefix}-${key}-error`} className="mt-1 text-[11px] text-red-700" role="alert">{errors[key]}</p>}
  </div>;
  const dropdown = (key: "grade" | "scale" | "stage", label: string, values: readonly string[], labels: Record<string, string>) => field(key, label,
    <Select value={value[key]} disabled={disabled} onValueChange={next => set(key, next as typeof value[typeof key])}>
      <SelectTrigger {...props(key, label)} className={`${inputClass} w-full`}><SelectValue /></SelectTrigger>
      <SelectContent>{values.map(item => <SelectItem key={item} value={item}>{labels[item]}</SelectItem>)}</SelectContent>
    </Select>);

  return <div className="customer-fields" data-testid="customer-fields-expanded">
    <div className="grid grid-cols-1 gap-x-3 gap-y-3 sm:grid-cols-2 lg:grid-cols-4">
      {field("name", "客户名称", <div className="flex items-center gap-2"><Input {...props("name", "客户名称", true)} className={`${inputClass} min-w-0 flex-1`} maxLength={128} placeholder="请输入公司或客户名称" value={value.name} onChange={e => set("name", e.target.value)} />{nameAction}</div>, true, "sm:col-span-2")}
      {includeLegacyContactFields ? <>
        {field("contactName", "联系人", <Input {...props("contactName", "联系人", true)} className={inputClass} maxLength={64} placeholder="联系人姓名" value={value.contactName} onChange={e => set("contactName", e.target.value)} />, true)}
        {field("phone", "联系电话", <Input {...props("phone", "联系电话", true)} className={inputClass} type="tel" maxLength={64} placeholder="手机、座机或国际号码" value={value.phone} onChange={e => set("phone", e.target.value)} />, true)}
        {field("email", "邮箱", <Input {...props("email", "邮箱")} className={inputClass} type="email" maxLength={254} placeholder="name@example.com" value={value.email} onChange={e => set("email", e.target.value)} />)}
      </> : null}
      {dropdown("grade", "客户等级", CUSTOMER_GRADES, CUSTOMER_GRADE_LABELS)}
      {dropdown("scale", "员工规模", CUSTOMER_SCALES, CUSTOMER_SCALE_LABELS)}
      {dropdown("stage", "当前阶段", CUSTOMER_STAGES, CUSTOMER_STAGE_LABELS)}
      {field("assignedUserId", "销售负责人", canManageAll && allowAssigneeChange ? <Select value={value.assignedUserId || "self"} disabled={disabled} onValueChange={next => set("assignedUserId", next === "self" ? "" : next)}>
        <SelectTrigger {...props("assignedUserId", "销售负责人")} className={`${inputClass} w-full`}><SelectValue /></SelectTrigger><SelectContent><SelectItem value="self">本人</SelectItem>{members.map(member => <SelectItem key={member.userId} value={String(member.userId)}>{member.name}</SelectItem>)}</SelectContent>
      </Select> : <div className="flex h-8 items-center rounded-md border border-slate-200 bg-slate-50 px-3 text-xs text-slate-600">{currentAssigneeName || "本人"}</div>)}
      {field("source", "来源", <Input {...props("source", "来源")} className={inputClass} maxLength={128} placeholder="展会、老客户转介绍等" value={value.source} onChange={e => set("source", e.target.value)} />)}
      {field("nextFollowUpAt", "下次跟进（北京时间）", <BeijingDateTimePicker {...props("nextFollowUpAt", "下次跟进（北京时间）")} className="max-w-[228px]" value={value.nextFollowUpAt} onChange={next => set("nextFollowUpAt", next)} />, false, "sm:col-span-2")}
    </div>
    <div className="mt-3 grid grid-cols-1 gap-x-3 gap-y-3 sm:grid-cols-3 lg:grid-cols-6">
      {field("province", "省 / 自治区", <Input {...props("province", "省 / 自治区")} className={inputClass} maxLength={64} placeholder="如：广东省" value={value.province} onChange={e => set("province", e.target.value)} />)}
      {field("city", "城市", <Input {...props("city", "城市")} className={inputClass} maxLength={64} placeholder="如：深圳市" value={value.city} onChange={e => set("city", e.target.value)} />)}
      {field("district", "区县", <Input {...props("district", "区县")} className={inputClass} maxLength={64} placeholder="如：南山区" value={value.district} onChange={e => set("district", e.target.value)} />)}
      {field("address", "详细地址", <Input {...props("address", "详细地址")} className={inputClass} maxLength={500} placeholder="街道、园区、楼层等" value={value.address} onChange={e => set("address", e.target.value)} />, false, "sm:col-span-3")}
    </div>
    {includeInitialFollowUp && <div className="mt-3">{field("initialFollowUp", "首次跟进备注", <Textarea {...props("initialFollowUp", "首次跟进备注")} className="min-h-20 !text-xs border-slate-300 shadow-none" maxLength={4000} placeholder="本次沟通情况、需求或下一步安排（选填）" value={value.initialFollowUp} onChange={e => set("initialFollowUp", e.target.value)} />)}</div>}
  </div>;
}
