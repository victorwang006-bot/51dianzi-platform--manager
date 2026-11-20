import fs from 'node:fs';
import crypto from 'node:crypto';
import ts from '/home/ubuntu/work/resume-frontend/platform/node_modules/typescript/lib/typescript.js';
const root='/home/ubuntu/work/resume-frontend/platform';
const out='/home/ubuntu/work/self-row-redesign/detail-implementation';
const read=p=>fs.readFileSync(`${root}/${p}`,'utf8');
const sha=s=>crypto.createHash('sha256').update(s).digest('hex');
const assert=(ok,message)=>{if(!ok)throw new Error(message)};
const source=read('client/src/components/OfficialMallSearchResults.tsx');
const file=ts.createSourceFile('OfficialMallSearchResults.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const card=file.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='OfficialSearchCard');
const eventNames=new Set(['onClick','onChange','onBlur','onFavorite']);
const callbacks=[];
function walk(n){
  if(ts.isJsxAttribute(n)&&eventNames.has(n.name.getText(file))&&n.initializer&&ts.isJsxExpression(n.initializer)&&n.initializer.expression&&ts.isArrowFunction(n.initializer.expression))callbacks.push([n.name.getText(file),n.initializer.expression.getText(file)]);
  ts.forEachChild(n,walk);
}
walk(card);
const expected=[
 ['onClick','() => { if (target !== null) setRawQuantity(String(target)); }'],
 ['onFavorite','() => void materials.toggleFavorite(item.publicId)'],
 ['onClick','() => setTiersOpen(open => !open)'],
 ['onClick','() => quantity !== null && setRawQuantity(String(quantity - step))'],
 ['onChange','event => setRawQuantity(event.target.value)'],
 ['onBlur','() => { if (quantity !== null) setRawQuantity(String(quantity)); }'],
 ['onClick','() => quantity !== null && setRawQuantity(String(quantity + step))'],
 ['onClick','() => { if (canAdd && quoteCurrent() && quantity !== null) onAddOfficialDraft?.(item, quantity); }'],
];
const sort=a=>a.map(x=>JSON.stringify(x)).sort();
assert(JSON.stringify(sort(callbacks))===JSON.stringify(sort(expected)),'Original eight card event callbacks changed/duplicated');
const originalFinancial=`  const [rawQuantity, setRawQuantity] = useState(() => String(initialOfficialQuantity(item)));
  const [tiersOpen, setTiersOpen] = useState(false);
  const tiersExpanded = tiersOpen && item.ladderPrices.length > 3;
  const remainingTiersId = \`omr-remaining-tiers-\${item.publicId}\`;
  const quantity = parseOfficialQuantity(rawQuantity);
  const price = applicableOfficialPrice(item, quantity);
  const subtotal = officialSubtotal(price, quantity);
  const step = positiveOfficialQuantity(item.spq) ? item.spq : 1;
  const minimum = initialOfficialQuantity(item);
  const maximum = typeof item.qtyOnSale === "number" ? Math.min(item.qtyOnSale, OFFICIAL_QUANTITY_MAX) : OFFICIAL_QUANTITY_MAX;
  const canAdd = quoteReady && officialCheckoutReady === true && typeof onAddOfficialDraft === "function" && officialDraftReady(item, quantity);
  const disabledReason = !quoteReady ? "报价更新中，请稍后再加入购物车" : officialCheckoutReady !== true || !onAddOfficialDraft ? "自营结算暂不可用"
    : !positiveOfficialQuantity(item.moq) || (item.spq !== null && !positiveOfficialQuantity(item.spq)) || !positiveOfficialQuantity(item.qtyOnSale)
      ? "起订、包装或可售信息待确认" : "请填写满足起订量、包装倍数及可售数量的有效数量与报价";
  let activeTier: number | null = null;
  if (price !== null && quantity !== null) {
    for (const tier of item.ladderPrices) if (tier.minQty <= quantity && (activeTier === null || tier.minQty > activeTier)) activeTier = tier.minQty;
  }
`;
const financial=source.slice(source.indexOf('  const [rawQuantity, setRawQuantity]'),source.indexOf('  const tierRow ='));
assert(financial===originalFinancial,'Original card financial state/calculation/eligibility block changed');
const before=fs.readFileSync(`${out}/ProductDetail.before.txt`,'utf8').split('export default function ProductDetail() {')[1];
const after=read('client/src/pages/ProductDetail.tsx').split('function MerchantProductDetail() {')[1];
assert(before===after,'Complete merchant body changed');
const files=[
 'client/src/pages/ProductDetail.tsx',
 'client/src/pages/OfficialProductDetail.tsx',
 'client/src/components/OfficialMallSearchResults.tsx',
 'client/src/components/OfficialMaterialResources.tsx',
 'client/src/pages/OfficialProductDetail.test.tsx',
 'client/src/pages/ProductDetail.route.test.tsx',
 'client/src/components/OfficialMaterialResources.SearchPage.test.tsx',
];
const hashes=Object.fromEntries(files.map(p=>[p,sha(read(p))]));
const report={status:'OFFLINE_SOURCE_ONLY',merchantBodyExact:true,merchantBeforeBodySHA256:sha(before),merchantAfterBodySHA256:sha(after),cardEightOriginalEventCallbacksExact:true,eventCallbackCount:callbacks.length,callbackHashes:callbacks.map(([name,text])=>({name,sha256:sha(text)})),cardOriginalFinancialDeclarationsExact:true,financialDeclarationsSHA256:sha(financial),files:hashes,aggregateSourceSHA256:sha(JSON.stringify(hashes)),notDeploymentEvidence:true};
fs.writeFileSync(`${out}/source-verification.json`,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
