import { z } from "zod";
import {
  CUSTOMER_GRADES,
  CUSTOMER_SCALES,
  CUSTOMER_STAGES,
  customerRequestIdSchema,
  isCustomerPhone,
} from "./crmCustomers";

export const CONTACT_METHOD_TYPES = ["mobile", "landline", "wechat", "qq", "email", "other"] as const;
export type ContactMethodType = (typeof CONTACT_METHOD_TYPES)[number];

const optionalText = (length: number) => z.string().trim().max(length).default("");

/** Client snapshots only guard identity changes; the server always derives authorization from ctx. */
export const customerContactExpectedIdentitySchema = z.object({
  expectedActorUserId: z.number().int().positive(),
  expectedEnterpriseId: z.number().int().positive(),
}).strict();

/** Customer fields handled independently of a contact's compatibility projection. */
export const customerContactBasicDataSchema = z.object({
  name: z.string().trim().min(1, "请输入客户名称").max(128, "客户名称不能超过128字"),
  province: optionalText(64),
  city: optionalText(64),
  district: optionalText(64),
  address: optionalText(500),
  scale: z.enum(CUSTOMER_SCALES).default("unknown"),
  grade: z.enum(CUSTOMER_GRADES).default("C"),
  stage: z.enum(CUSTOMER_STAGES).default("new"),
  source: optionalText(128),
  nextFollowUpAt: z.string().datetime({ offset: true }).nullable().default(null),
  assignedUserId: z.number().int().positive().optional(),
}).strict();

export const contactMethodSchema = z.object({
  type: z.enum(CONTACT_METHOD_TYPES),
  value: z.string().trim().min(1, "请输入联系方式").max(254, "联系方式不能超过254字"),
  label: z.string().trim().max(64, "联系方式备注不能超过64字").optional(),
}).strict().superRefine((method, context) => {
  if (["mobile", "landline"].includes(method.type) && !isCustomerPhone(method.value)) {
    context.addIssue({
      code: "custom",
      path: ["value"],
      message: "请输入有效手机号、座机或国际号码",
    });
  }
  if (method.type === "email" && !z.string().email().safeParse(method.value).success) {
    context.addIssue({
      code: "custom",
      path: ["value"],
      message: "请输入有效邮箱",
    });
  }
});

export const customerContactSchema = z.object({
  name: z.string().trim().min(1, "请输入联系人").max(64, "联系人不能超过64字"),
  department: optionalText(128),
  position: optionalText(128),
  methods: z.array(contactMethodSchema).min(1, "请至少填写一种联系方式").max(32),
  isPrimary: z.boolean().default(false),
}).strict();

export const customerMutableContactSchema = customerContactSchema.omit({ isPrimary: true });

export const createMultiSchema = customerContactExpectedIdentitySchema.extend({
  data: customerContactBasicDataSchema,
  contacts: z.array(customerContactSchema).min(1).max(100),
  initialFollowUp: z.string().trim().max(4000).default(""),
  requestId: customerRequestIdSchema,
  confirmDuplicate: z.boolean().default(false),
}).strict().superRefine((input, context) => {
  if (input.contacts.filter(contact => contact.isPrimary).length !== 1) {
    context.addIssue({
      code: "custom",
      path: ["contacts"],
      message: "必须且只能选择一位主联系人",
    });
  }
});

export const contactsListSchema = customerContactExpectedIdentitySchema.extend({
  customerId: z.number().int().positive(),
}).strict();

export const contactsSummarySchema = customerContactExpectedIdentitySchema.extend({
  customerIds: z.array(z.number().int().positive()).min(1).max(100),
}).strict().superRefine((input, context) => {
  if (new Set(input.customerIds).size !== input.customerIds.length) {
    context.addIssue({ code: "custom", path: ["customerIds"], message: "客户不能重复" });
  }
});

export const contactsAddSchema = customerContactExpectedIdentitySchema.extend({
  customerId: z.number().int().positive(),
  contact: customerMutableContactSchema,
  requestId: customerRequestIdSchema,
  confirmDuplicate: z.boolean().default(false),
}).strict();

export const contactsEditSchema = customerContactExpectedIdentitySchema.extend({
  customerId: z.number().int().positive(),
  contactId: z.string().min(1).max(36),
  version: z.number().int().positive(),
  contact: customerMutableContactSchema,
  requestId: customerRequestIdSchema,
  confirmDuplicate: z.boolean().default(false),
}).strict();

export const contactsStopSchema = customerContactExpectedIdentitySchema.extend({
  customerId: z.number().int().positive(),
  contactId: z.string().min(1).max(36),
  version: z.number().int().positive(),
  replacementContactId: z.string().min(1).max(36).optional(),
  requestId: customerRequestIdSchema,
}).strict();

export const contactsSetPrimarySchema = customerContactExpectedIdentitySchema.extend({
  customerId: z.number().int().positive(),
  contactId: z.string().min(1).max(36),
  version: z.number().int().positive(),
  requestId: customerRequestIdSchema,
}).strict();

export const updateBasicSchema = customerContactExpectedIdentitySchema.extend({
  customerId: z.number().int().positive(),
  version: z.number().int().positive(),
  data: customerContactBasicDataSchema.omit({ assignedUserId: true }),
  requestId: customerRequestIdSchema,
  confirmDuplicate: z.boolean().default(false),
}).strict();

export type CustomerContactMethod = z.infer<typeof contactMethodSchema>;
export type CustomerContactInput = z.infer<typeof customerContactSchema>;
export type CustomerMutableContactInput = z.infer<typeof customerMutableContactSchema>;
export type CustomerContactBasicData = z.infer<typeof customerContactBasicDataSchema>;
export type CreateMultiInput = z.infer<typeof createMultiSchema>;
export type ContactsListInput = z.infer<typeof contactsListSchema>;
export type ContactsSummaryInput = z.infer<typeof contactsSummarySchema>;
export type ContactsAddInput = z.infer<typeof contactsAddSchema>;
export type ContactsEditInput = z.infer<typeof contactsEditSchema>;
export type ContactsStopInput = z.infer<typeof contactsStopSchema>;
export type ContactsSetPrimaryInput = z.infer<typeof contactsSetPrimarySchema>;
export type UpdateBasicInput = z.infer<typeof updateBasicSchema>;

export type ContactRecord = {
  id: string;
  name: string;
  department: string;
  position: string;
  methods: CustomerContactMethod[];
  isPrimary: boolean;
  legacy: boolean;
  authorUserId: number | null;
  authorName: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  version: number;
  stoppedAt: string | null;
  canEdit: boolean;
};

export type ContactsListResult = {
  customer: {
    id: number;
    name: string;
    assignedUserId: number;
    assignedName: string;
    version: number;
    archivedAt: string | null;
  };
  contacts: ContactRecord[];
  canAdd: boolean;
};

export type ContactSummary = {
  customerId: number;
  contactCount: number;
  primaryContact: Pick<ContactRecord, "id" | "name" | "methods" | "legacy"> | null;
};

export type ContactChangeResult = {
  id: string;
  contactId: string;
  customerId: number;
  version?: number;
  replayed: boolean;
};

export type UpdateBasicResult = {
  id: number;
  customerId: number;
  version: number;
  replayed: boolean;
};
