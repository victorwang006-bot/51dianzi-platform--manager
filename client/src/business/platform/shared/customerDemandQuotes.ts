import { z } from "zod";
import type { CustomerDemandItem } from "./customerDemands";
const id=z.number().int().positive().max(2147483647);
export const demandQuoteItemSchema=z.object({
  demandItemId:id, qty:z.number().int().positive("报价数量须为正整数").max(2147483647),
  unitPrice:z.string().trim().regex(/^(?:0|[1-9]\d{0,14})(?:\.\d{1,4})?$/,"请填写非负含税单价，最多4位小数"),
  leadTime:z.string().trim().min(1,"请填写交期").max(80), note:z.string().trim().max(500).default(""),
});
export const demandQuoteSaveSchema=z.object({
  demandId:id, id:id.optional(), version:id.optional(),
  /** Required after the first business demand revision; legacy clients remain valid only for revision 1. */
  demandRevision:id.optional(),
  requestId:z.string().min(16).max(80).regex(/^[A-Za-z0-9_-]+$/),
  supplierName:z.string().trim().min(1,"请填写供应商名称").max(128), note:z.string().trim().max(1000).default(""),
  items:z.array(demandQuoteItemSchema).min(1,"请至少填写一行报价").max(100),
}).superRefine((value,ctx)=>{
  if(Boolean(value.id)!==Boolean(value.version))ctx.addIssue({code:"custom",path:["version"],message:"修改报价必须提供当前版本"});
  if(new Set(value.items.map(item=>item.demandItemId)).size!==value.items.length)ctx.addIssue({code:"custom",path:["items"],message:"同一物料不能重复报价"});
});
export const demandQuoteListSchema=z.object({demandId:id,quoteId:id.optional(),audience:z.enum(["sales","procurement"]),page:z.number().int().min(1).default(1),pageSize:z.number().int().min(1).max(50).default(20)});
export const demandQuoteAcceptSchema=z.object({
  demandId:id,
  quoteId:id,
  quoteVersion:id,
  demandRevision:id,
  requestId:z.string().min(16).max(80).regex(/^[A-Za-z0-9_-]+$/),
  note:z.string().trim().max(500).default(""),
  items:z.array(z.object({demandItemId:id,qty:z.number().int().positive("采用数量须为正整数").max(2147483647)})).min(1,"请填写至少一项采用数量").max(100),
}).superRefine((value,ctx)=>{
  if(new Set(value.items.map(item=>item.demandItemId)).size!==value.items.length)ctx.addIssue({code:"custom",path:["items"],message:"同一物料不能重复采用"});
});
export const demandQuoteWithdrawSchema=z.object({quoteId:id,version:id});
export const demandQuoteHistorySchema=z.object({quoteId:id,audience:z.enum(["sales","procurement"]),page:z.number().int().min(1).default(1),pageSize:z.number().int().min(1).max(20).default(10)});
export type DemandQuoteSaveInput=z.infer<typeof demandQuoteSaveSchema>;
export type DemandQuoteListInput=z.infer<typeof demandQuoteListSchema>;
export type DemandQuoteAcceptInput=z.infer<typeof demandQuoteAcceptSchema>;
export type DemandQuoteWithdrawInput=z.infer<typeof demandQuoteWithdrawSchema>;
export type DemandQuoteHistoryInput=z.infer<typeof demandQuoteHistorySchema>;
export type DemandQuoteItem={demandItemId:number;partNumber:string;brand:string;pkg:string;qtyUnit:string;qty:number;unitPrice:string;leadTime:string;note:string;demandQty?:number;acceptedQty?:number;availableToAcceptQty?:number};
export type DemandQuote={id:number;demandId:number;procurementUserId:number;procurementName:string;supplierName:string;note:string;status:"active"|"withdrawn";withdrawnAt?:string|null;version:number;demandRevision?:number;currentDemandRevision?:number;needsReconfirmation?:boolean;isAccepted?:boolean;acceptanceStale?:boolean;acceptedByName?:string;acceptedAt?:string|null;createdAt:string;updatedAt:string;items:DemandQuoteItem[]};
export type DemandQuotePage={items:DemandQuote[];total:number;page:number;pageSize:number};
export type DemandQuoteRevision={id:number;quoteId:number;version:number;demandRevision:number;action:"created"|"updated";supplierName:string;note:string;createdAt:string;items:DemandQuoteItem[]};
export type DemandQuoteRevisionPage={items:DemandQuoteRevision[];total:number;page:number;pageSize:number};
export type QuotableDemandItem=CustomerDemandItem & {id:number};
export type DemandQuoteSaveResult={id:number;version:number;replayed:boolean};
export type DemandQuoteAcceptResult={id:number;quoteId:number;replayed:boolean;acceptedQty:number};
export type DemandQuoteWithdrawResult={quoteId:number;replayed:boolean};
