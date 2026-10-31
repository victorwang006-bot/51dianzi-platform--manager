import { INBOUND_BULK_FIELDS, INBOUND_BULK_MAX_ROWS, inboundBulkRowSchema, type InboundBulkDraftRow, type InboundBulkField, type InboundBulkMapping, type InboundBulkRow } from "./inboundBulk";

const cellText=(value:unknown)=>value==null?"":String(value).trim();
const normalizedHeader=(value:string)=>value.normalize("NFKC").toLowerCase().replace(/[\s_\-:：/／()（）.]/g,"");
export function emptyInboundBulkMapping():InboundBulkMapping {
  return Object.fromEntries(INBOUND_BULK_FIELDS.map(field=>[field.key,null])) as InboundBulkMapping;
}
export function emptyInboundBulkRow(sourceRow:number):InboundBulkDraftRow {
  return {...Object.fromEntries(INBOUND_BULK_FIELDS.map(field=>[field.key,""])),rowKey:`row-${sourceRow}`,sourceRow} as InboundBulkDraftRow;
}
export function suggestInboundBulkMapping(headers:string[]):InboundBulkMapping {
  const result=emptyInboundBulkMapping();const used=new Set<number>();
  for(const field of INBOUND_BULK_FIELDS){const choices=[field.label,...field.aliases].map(normalizedHeader);const index=headers.findIndex((header,i)=>!used.has(i)&&choices.includes(normalizedHeader(header)));if(index>=0){result[field.key]=index;used.add(index);}}
  return result;
}
export function validateInboundBulkMapping(headers:string[],mapping:InboundBulkMapping):string[]{
  const seen=new Map<number,string>();const errors:string[]=[];
  for(const field of INBOUND_BULK_FIELDS){const index=mapping[field.key];if(index==null)continue;
    if(!Number.isInteger(index)||index<0||index>=headers.length){errors.push(`${field.label}：请选择有效表头`);continue;}
    const previous=seen.get(index);if(previous)errors.push(`第${index+1}列已对应${previous}，不能重复对应${field.label}`);else seen.set(index,field.label);
  }
  return errors;
}
export function mapInboundBulkRows(rawRows:unknown[][],mapping:InboundBulkMapping,firstSourceRow=2):InboundBulkDraftRow[]{
  const result:InboundBulkDraftRow[]=[];
  rawRows.forEach((raw,index)=>{
    if(!raw.some(cell=>cellText(cell)!==""))return;
    const row=emptyInboundBulkRow(firstSourceRow+index);
    for(const field of INBOUND_BULK_FIELDS){const column=mapping[field.key];row[field.key]=column!=null?cellText(raw[column]):"";}
    result.push(row);
  });
  return result;
}
export type InboundBulkDraftError={rowKey:string;sourceRow:number;field:InboundBulkField;message:string};
function numericCell(text:string,integer:boolean):number {
  const raw=text.normalize("NFKC").trim();
  const pattern=integer?/^(?:\d+|\d{1,3}(?:,\d{3})+)$/:/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,6})?$/;
  if(!pattern.test(raw))return NaN;
  return Number(raw.replace(/,/g,""));
}
export function validateInboundBulkDraft(drafts:InboundBulkDraftRow[],status:"in_transit"|"received"):{rows:InboundBulkRow[];errors:InboundBulkDraftError[];missingPriceRows:InboundBulkDraftRow[]}{
  const rows:InboundBulkRow[]=[];const errors:InboundBulkDraftError[]=[];const missingPriceRows:InboundBulkDraftRow[]=[];
  if(drafts.length>INBOUND_BULK_MAX_ROWS)errors.push({rowKey:drafts[0]?.rowKey||"",sourceRow:drafts[0]?.sourceRow||1,field:"partNumber",message:`每批最多${INBOUND_BULK_MAX_ROWS}行`});
  const used=new Set<number>();
  for(const draft of drafts){
    const missing=!draft.unitCost.trim();if(missing)missingPriceRows.push(draft);
    const candidate={...draft,qty:numericCell(draft.qty,true),unitCost:missing?null:numericCell(draft.unitCost,false)};
    const parsed=inboundBulkRowSchema.safeParse(candidate);
    if(!parsed.success){for(const issue of parsed.error.issues){const key=issue.path[0] as InboundBulkField;const field=INBOUND_BULK_FIELDS.find(item=>item.key===key);errors.push({rowKey:draft.rowKey,sourceRow:draft.sourceRow,field:field?.key||"partNumber",message:key==="qty"?"数量须为1–999999999的整数":key==="unitCost"?"请填有效单价，最多6位小数":issue.message});}}
    if(used.has(draft.sourceRow))errors.push({rowKey:draft.rowKey,sourceRow:draft.sourceRow,field:"partNumber",message:"行号重复"});used.add(draft.sourceRow);
    if(status==="received"&&!draft.location.trim())errors.push({rowKey:draft.rowKey,sourceRow:draft.sourceRow,field:"location",message:"请填仓位"});
    if(parsed.success)rows.push(parsed.data);
  }
  return {rows,errors,missingPriceRows};
}
/** Excel TSV, including quoted tabs/newlines. Header is always the first row. */
export function parseInboundPaste(text:string):{headers:string[];rows:string[][]}{
  const input=text.replace(/^\uFEFF/,"").replace(/\r\n/g,"\n").replace(/\r/g,"\n");
  const records:string[][]=[];let row:string[]=[];let value="";let quoted=false;let atStart=true;
  for(let i=0;i<input.length;i++){
    const c=input[i];
    if(c==='"'){
      if(quoted&&input[i+1]==='"'){value+='"';i++;}
      else if(quoted){quoted=false;}
      else if(atStart){quoted=true;}
      else value+=c;
      atStart=false;
    }else if(!quoted&&(c==='\t'||c==='\n')){
      row.push(value);value="";atStart=true;
      if(c==='\n'){records.push(row);row=[];}
    }else {value+=c;atStart=false;}
  }
  if(quoted)throw new Error("粘贴内容引号未闭合");
  if(row.length||value!==''){row.push(value);records.push(row);}
  while(records.length&&!records[records.length-1].some(v=>v.trim()))records.pop();
  if(!records.length)return {headers:[],rows:[]};
  const headers=records[0].map((v,i)=>v.trim()||`第${i+1}列`);
  return {headers,rows:records.slice(1)};
}
