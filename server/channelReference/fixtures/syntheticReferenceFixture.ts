/** Pure offline TEST fixture. This is generated semantic markup, not captured
 * supplier HTML and not evidence of any live price, inventory or producer success.
 * Never imported by a runtime service or packaged as a reference snapshot. */
export const SYNTHETIC_REFERENCE_MPN = "STE145N65M5";
export const SYNTHETIC_LCSC_URL = "https://so.szlcsc.com/global.html?k=STE145N65M5";
const escape = (value: string) => value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
export function syntheticLcscReferencePage(brand = "ST(意法半导体)", partNumber = SYNTHETIC_REFERENCE_MPN): string {
  return `<html><head><title>Synthetic offline LCSC fixture</title></head><body><section><h2>自营商品 1</h2><ul><li class="product-item"><dl>
    <div><dt>商品型号</dt><dd><a href="https://item.szlcsc.com/3362658.html">${escape(partNumber)}</a></dd></div>
    <div><dt>品牌</dt><dd>${escape(brand)}</dd></div>
    <div><dt>立创编号</dt><dd>C2970194</dd></div>
    <div><dt>封装</dt><dd>ISOTOP</dd></div><div><dt>包装</dt><dd>1个/袋</dd></div>
    </dl><div>现货44个</div><div class="pricing"><h4>梯度(含税)</h4><div>
    <div><span>1+</span><span>￥191.09</span></div><div><span>30+</span><span>￥184.21</span></div>
    </div></div><div class="purchase"><input type="number" value="1"/><span>个</span></div>
    </li></ul></section></body></html>`;
}
export function syntheticIckeyReferencePage(brand = "ST(意法半导体)", partNumber = SYNTHETIC_REFERENCE_MPN): string {
  return `<html><head><title>Synthetic offline ICKey fixture</title></head><body>
    <div class="result-header"><div class="search-w-price">价格梯度</div><div class="search-w-hk">中国香港交货</div><div class="search-w-home">内地交货(含增值税)</div></div>
    <div class="result-list clearfix" data-sno="${escape(partNumber)}" data-maf="${escape(brand)}" data-sku="SYNTHETIC-ST-TEST" data-stock="44" data-real-supplier="SYNTHETIC-TEST-SUPPLIER">
    <ul><li>厂牌：<span>${escape(brand)}</span></li><li>封装：<span>ISOTOP</span></li><li class="store-num">库&nbsp;&nbsp;&nbsp;存：<span class="store-num-detail">44</span></li><li>销售单位：<span>个</span></li></ul>
    <div class="search-w-price"><div class="search-result-bor"><span>1+</span></div><div class="search-result-bor"><span>30+</span></div></div>
    <div class="search-w-home"><div class="search-result-bor">￥<span>191.09</span></div><div class="search-result-bor">￥<span>184.21</span></div></div><div class="search-w-hk"></div>
    </div></body></html>`;
}
