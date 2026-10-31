import { z } from "zod";
import { INBOUND_PRICE_BASES, MAX_INBOUND_UNIT_COST, MAX_INBOUND_TAX_RATE } from "./inboundPricing";
import { MAX_INBOUND_QTY } from "./inboundPayment";

export const INBOUND_BULK_MAX_ROWS = 200;
export const INBOUND_BULK_FILE_MAX_BYTES = 5 * 1024 * 1024;
export const INBOUND_BULK_FIELDS = [
  {key:"partNumber",label:"料号",required:true,maxLength:128,aliases:["型号","物料型号","产品型号","料号/型号","料号／型号","pn","partnumber","model"]},
  {key:"qty",label:"数量",required:true,maxLength:20,aliases:["到货数量","计划到货数量","入库数量","采购数量","qty","quantity"]},
  {key:"prodYear",label:"年份/DC",required:true,maxLength:16,aliases:["年份","dc","datecode","生产周期","批次年份"]},
  {key:"unitCost",label:"采购单价",required:false,maxLength:30,aliases:["采购价格","采购价","单价","含税单价","未税单价","unitcost","unitprice","price"]},
  {key:"operator",label:"采购员",required:true,maxLength:64,aliases:["经办人","采购人","经手人","buyer","operator"]},
  {key:"supplierName",label:"供应商",required:true,maxLength:128,aliases:["供应商名称","供货公司","供货商","supplier"]},
  {key:"location",label:"仓位",required:false,maxLength:64,aliases:["存放仓位","货位","库位","location","bin"]},
  {key:"brand",label:"品牌",required:false,maxLength:64,aliases:["厂牌","制造商","品牌/制造商","brand","manufacturer"]},
  {key:"supplierContact",label:"供应商联系人",required:false,maxLength:64,aliases:["对接人","联系人","suppliercontact","contact"]},
  {key:"procurementRegion",label:"采购地区",required:false,maxLength:128,aliases:["采购地","供应商地区","采购区域","地区","procurementregion"]},
  {key:"note",label:"备注",required:false,maxLength:500,aliases:["物料备注","说明","note","remark"]},
] as const;
export type InboundBulkField = typeof INBOUND_BULK_FIELDS[number]["key"];
export type InboundBulkMapping = Record<InboundBulkField, number | null>;
export type InboundBulkDraftRow = Record<InboundBulkField, string> & { rowKey:string; sourceRow:number };
const text = (max:number) => z.string().trim().max(max).default("");
export function validInboundDate(value:string):boolean {
  if(!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
  const d=new Date(value+"T00:00:00.000Z");return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===value && value >= "1000-01-01";
}
export const inboundBulkRowSchema=z.object({
  sourceRow:z.number().int().positive().max(1048576),
  partNumber:z.string().max(128).transform(v=>v.normalize("NFKC").trim().toUpperCase()).pipe(z.string().min(1,"请填料号").max(128)),
  brand:text(64),qty:z.number().int("数量须为整数").positive("数量须大于0").max(MAX_INBOUND_QTY),
  prodYear:z.string().trim().min(1,"请填年份/DC").max(16),
  unitCost:z.number().nonnegative("单价不能为负数").max(MAX_INBOUND_UNIT_COST).nullable(),
  // Rolling-release compatibility only. New clients do not expose or map this
  // duplicate field, while an old in-flight client can still save its value.
  warehouseAddress:z.string().trim().max(255).optional(),operator:z.string().trim().min(1,"请填采购员").max(64),
  supplierName:z.string().trim().min(1,"请填供应商").max(128),supplierContact:text(64),procurementRegion:text(128),
  location:text(64),note:text(500),
});
export const inboundBulkCreateSchema=z.object({
  clientRequestId:z.string().regex(/^[A-Za-z0-9-]{16,64}$/,"请求标识无效"),
  status:z.enum(["in_transit","received"]),
  inboundDate:z.string().refine(validInboundDate,"日期无效"),
  unitCostBasis:z.enum(INBOUND_PRICE_BASES),
  taxRate:z.number().min(0).max(MAX_INBOUND_TAX_RATE).multipleOf(0.1),
  acceptMissingPrices:z.boolean().default(false),
  rows:z.array(inboundBulkRowSchema).min(1,"请录入物料").max(INBOUND_BULK_MAX_ROWS,`每批最多${INBOUND_BULK_MAX_ROWS}行`),
}).superRefine((value,ctx)=>{
  const missing=value.rows.filter(r=>r.unitCost===null);
  if(missing.length&&!value.acceptMissingPrices)ctx.addIssue({code:z.ZodIssueCode.custom,path:["acceptMissingPrices"],message:`有${missing.length}条物料未填写价格，请确认按0元录入`});
  const seen=new Set<number>();value.rows.forEach((row,index)=>{
    if(seen.has(row.sourceRow))ctx.addIssue({code:z.ZodIssueCode.custom,path:["rows",index,"sourceRow"],message:"行号重复"});seen.add(row.sourceRow);
    if(value.status==="received"&&!row.location)ctx.addIssue({code:z.ZodIssueCode.custom,path:["rows",index,"location"],message:"请填仓位"});
  });
});
export type InboundBulkRow=z.infer<typeof inboundBulkRowSchema>;
export type InboundBulkCreateInput=z.infer<typeof inboundBulkCreateSchema>;
export type InboundBulkCreateResult={success:true;replayed:boolean;batchId:number;count:number;missingPriceCount:number;items:{sourceRow:number;id:number;slipNo:string;status:"in_transit"|"received"}[]};
