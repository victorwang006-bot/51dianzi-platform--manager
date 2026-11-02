import type { Dispatch, SetStateAction } from "react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import {
  CONTACT_METHOD_LABELS,
  CONTACT_METHOD_TYPES,
  emptyContact,
  type ContactDraft,
  type ContactMethodType,
} from "./customerContacts";

const secondary = "h-8 border-slate-300 bg-white px-3 text-xs text-slate-700 shadow-none hover:bg-slate-50 hover:text-slate-900";
const inputClass = "h-8 bg-white text-xs border-slate-300 shadow-none";

type ContactDraftFieldsProps = {
  contact: ContactDraft;
  index?: number;
  disabled?: boolean;
  errors?: Record<string, string>;
  prefix?: string;
  showPrimary?: boolean;
  canRemove?: boolean;
  onChange: (next: ContactDraft) => void;
  onRemove?: () => void;
};

export function CustomerContactDraftFields({
  contact,
  index,
  disabled = false,
  errors = {},
  prefix = "",
  showPrimary = false,
  canRemove = false,
  onChange,
  onRemove,
}: ContactDraftFieldsProps) {
  const update = (patch: Partial<ContactDraft>) => onChange({ ...contact, ...patch });
  const updateMethod = (methodIndex: number, patch: Partial<ContactDraft["methods"][number]>) => {
    update({ methods: contact.methods.map((method, current) => current === methodIndex ? { ...method, ...patch } : method) });
  };
  const inputId = (field: string) => `${prefix || contact.id}-${field}`;
  return <section className="rounded-md border border-slate-200 bg-white p-3" aria-label={index == null ? "联系人" : `联系人 ${index + 1}`}>
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
      <div className="flex items-center gap-3">
        <h3 className="text-xs font-semibold text-slate-800">{index == null ? "联系人资料" : `联系人 ${index + 1}`}</h3>
        {showPrimary ? <label className="flex cursor-pointer items-center gap-1.5 text-xs text-slate-700">
          <input
            type="radio"
            name="customer-primary-contact"
            checked={contact.isPrimary}
            disabled={disabled}
            onChange={() => update({ isPrimary: true })}
          />
          主联系人
        </label> : null}
      </div>
      {canRemove && onRemove ? <button type="button" className="p-1 text-xs text-red-700 hover:underline disabled:text-slate-400" disabled={disabled} onClick={onRemove}>移除此联系人</button> : null}
    </div>
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      <Field label="姓名" required error={errors[`${prefix}name`]} htmlFor={inputId("name")}>
        <Input id={inputId("name")} aria-label={index == null ? "联系人姓名" : `联系人${index + 1}姓名`} className={inputClass} maxLength={64} disabled={disabled} value={contact.name} onChange={event => update({ name: event.target.value })} />
      </Field>
      <Field label="部门" error={errors[`${prefix}department`]} htmlFor={inputId("department")}>
        <Input id={inputId("department")} className={inputClass} maxLength={128} disabled={disabled} value={contact.department} onChange={event => update({ department: event.target.value })} />
      </Field>
      <Field label="职位" error={errors[`${prefix}position`]} htmlFor={inputId("position")}>
        <Input id={inputId("position")} className={inputClass} maxLength={128} disabled={disabled} value={contact.position} onChange={event => update({ position: event.target.value })} />
      </Field>
    </div>
    <div className="mt-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-slate-600"><span className="mr-1 text-red-700">*</span>联系方式</p>
        <button type="button" className="p-1 text-xs text-[#185FA5] hover:underline disabled:text-slate-400" disabled={disabled || contact.methods.length >= 32} onClick={() => update({ methods: [...contact.methods, { type: "mobile", value: "" }] })}>＋ 添加联系方式</button>
      </div>
      <div className="space-y-2">
        {contact.methods.map((method, methodIndex) => <div className="flex flex-wrap items-start gap-2 border-t border-dashed border-slate-200 pt-2 first:border-t-0 first:pt-0" key={`${contact.id}-${methodIndex}`}>
          <select aria-label={index == null ? "联系方式类型" : `联系人${index + 1}联系方式类型`} className="h-8 w-[88px] rounded-md border border-slate-300 bg-white px-2 text-xs text-slate-700" value={method.type} disabled={disabled} onChange={event => updateMethod(methodIndex, { type: event.target.value as ContactMethodType })}>
            {CONTACT_METHOD_TYPES.map(type => <option key={type} value={type}>{CONTACT_METHOD_LABELS[type]}</option>)}
          </select>
          <Input aria-label={index == null ? "联系方式值" : `联系人${index + 1}联系方式值`} className={`${inputClass} min-w-[150px] flex-1`} maxLength={254} disabled={disabled} value={method.value} placeholder={method.type === "email" ? "name@example.com" : "填写联系方式"} onChange={event => updateMethod(methodIndex, { value: event.target.value })} />
          <Input aria-label={index == null ? "联系方式备注" : `联系人${index + 1}联系方式备注`} className={`${inputClass} min-w-[108px] flex-1`} maxLength={64} disabled={disabled} value={method.label ?? ""} placeholder="备注（选填）" onChange={event => updateMethod(methodIndex, { label: event.target.value })} />
          <button type="button" className="h-8 px-1 text-xs text-red-700 hover:underline disabled:text-slate-400" aria-label="删除联系方式" disabled={disabled || contact.methods.length === 1} onClick={() => update({ methods: contact.methods.filter((_, current) => current !== methodIndex) })}>删除</button>
        </div>)}
      </div>
      {errors[`${prefix}methods`] ? <p className="mt-1 text-[11px] text-red-700" role="alert">{errors[`${prefix}methods`]}</p> : null}
      {Object.entries(errors).filter(([key]) => key.startsWith(`${prefix}method-`)).map(([key, message]) => <p className="mt-1 text-[11px] text-red-700" role="alert" key={key}>{message}</p>)}
    </div>
  </section>;
}

type CustomerContactsDraftsProps = {
  contacts: ContactDraft[];
  setContacts: Dispatch<SetStateAction<ContactDraft[]>>;
  disabled?: boolean;
  errors?: Record<string, string>;
};

export function CustomerContactsDrafts({ contacts, setContacts, disabled = false, errors = {} }: CustomerContactsDraftsProps) {
  const updateContact = (index: number, next: ContactDraft) => {
    setContacts(current => current.map((contact, currentIndex) => {
      if (currentIndex === index) return next;
      return next.isPrimary ? { ...contact, isPrimary: false } : contact;
    }));
  };
  const removeContact = (target: number) => {
    setContacts(current => {
      const remaining = current.filter((_, index) => index !== target);
      return remaining.some(contact => contact.isPrimary)
        ? remaining
        : remaining.map((contact, index) => ({ ...contact, isPrimary: index === 0 }));
    });
  };
  return <section className="border-t border-slate-100 px-3 py-3 sm:px-4" data-testid="customer-contacts-drafts">
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
      <div>
        <h3 className="text-xs font-semibold text-slate-800">联系人</h3>
        <p className="mt-1 text-[11px] text-muted-foreground">姓名和至少一种有效联系方式必填；请且仅选择一位主联系人。</p>
      </div>
      <Button type="button" size="sm" variant="outline" className={secondary} disabled={disabled || contacts.length >= 100} onClick={() => setContacts(current => [...current, emptyContact(false)])}>＋ 添加联系人</Button>
    </div>
    {errors.primary ? <p className="mb-2 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700" role="alert">{errors.primary}</p> : null}
    {errors.contacts ? <p className="mb-2 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700" role="alert">{errors.contacts}</p> : null}
    <div className="space-y-2">
      {contacts.map((contact, index) => <CustomerContactDraftFields key={contact.id} contact={contact} index={index} disabled={disabled} errors={errors} prefix={`contact-${index}-`} showPrimary canRemove={contacts.length > 1} onChange={next => updateContact(index, next)} onRemove={() => removeContact(index)} />)}
    </div>
  </section>;
}

function Field({ label, required = false, error, htmlFor, children }: { label: string; required?: boolean; error?: string; htmlFor: string; children: React.ReactNode }) {
  return <div className="min-w-0">
    <label htmlFor={htmlFor} className="mb-1 block text-xs text-slate-600">{required ? <span className="mr-1 text-red-700">*</span> : null}{label}</label>
    {children}
    {error ? <p className="mt-1 text-[11px] text-red-700" role="alert">{error}</p> : null}
  </div>;
}
