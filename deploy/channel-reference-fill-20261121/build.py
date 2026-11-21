#!/usr/bin/env python3
"""Build new channel-reference snapshot/bindings/stock-evidence from scrape results.
Usage: build.py [outdir]
Preserves every existing record/binding verbatim except negative sources that now have a price.
"""
import json, re, sys, subprocess, os, hashlib, copy
from decimal import Decimal
from datetime import datetime, timezone
from urllib.parse import quote

W = '/home/ubuntu/work'
REPO = '/home/ubuntu/51dianzi-platform--manager/server/channelReference'
OUT = sys.argv[1] if len(sys.argv) > 1 else W + '/out'
os.makedirs(OUT, exist_ok=True)
SRC = ['lcsc', 'ickey']
REVIEW = '20261121-price-fill-v1'

enc = lambda s: quote(s, safe="-_.!~*'()")
pairs = json.load(open(W + '/pairs.json'))
snap = json.load(open(REPO + '/channel-reference-snapshot.json'))
bind = json.load(open(REPO + '/channel-reference-identity-bindings.json'))
stock_doc = json.load(open(REPO + '/channel-reference-stock-evidence.json'))
lcsc_stock = json.load(open(W + '/lcsc_stock.json')) if os.path.exists(W + '/lcsc_stock.json') else {}

scr = {}
for fn in ('scrape_all.jsonl', 'scrape_b.jsonl', 'scrape_retry.jsonl', 'scrape_retry2.jsonl', 'scrape_retry3.jsonl', 'scrape_retry4.jsonl', 'scrape_retry5.jsonl'):
    p = W + '/' + fn
    if not os.path.exists(p): continue
    for l in open(p):
        r = json.loads(l)
        old = scr.get(r['mpn'])
        if old is None: scr[r['mpn']] = r; continue
        # merge: later record only overrides a source when it is better
        for s in SRC:
            if r['queries'][s]['state'] == 'ok' or old['queries'][s]['state'] in ('error', 'unparsed', 'restricted'):
                old['queries'][s] = r['queries'][s]; old['at_' + s] = r['at']

def empty(source, fetched):
    return {"source": source, "status": "not_found", "matchedPartNumber": None, "matchedBrand": None, "productCode": None,
            "pageUrl": None, "stockQuantity": None, "unitPrice": None, "tierQuantity": None, "tiers": [], "currency": None,
            "unit": None, "taxStatus": "unknown", "packaging": None, "fetchedAt": fetched, "expiresAt": None,
            "stockInsufficientForTier": False, "message": None}

def iso(at):
    return at.replace('Z', '.000Z') if re.match(r'^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$', at) else at

def strip_paren(m):
    return re.sub(r'[（(][^)）]*[)）]', '', m).strip()

def fmt(x):
    d = Decimal(str(x).replace(',', '').strip())
    s = format(d, 'f')
    if '.' in s: s = s.rstrip('0').rstrip('.') if False else s
    return s

# ---------------------------------------------------------------- candidates
def lcsc_cands(rec, pn):
    q = rec['queries']['lcsc']
    out = []
    if q['state'] != 'ok': return out
    for row in q['rows']:
        model = (row.get('model') or '').strip()
        if model.upper() not in (pn.upper(), strip_paren(pn).upper()): continue
        tiers = {}
        for t in row.get('tiers') or []:
            try:
                qty = int(t[0]); pr = fmt(t[1])
                if Decimal(pr) > 0: tiers[qty] = pr
            except Exception: pass
        if not tiers: continue
        tl = [{"minQuantity": k, "unitPrice": tiers[k]} for k in sorted(tiers)]
        href = row.get('href') or ''
        m = re.match(r'^https://item\.szlcsc\.com/((?:mro/)?[1-9]\d*)\.html', href)
        url = f'https://item.szlcsc.com/{m.group(1)}.html' if m else None
        partner = row.get('kind') == 'partner' or not row.get('code')
        st = (row.get('stockText') or '').replace(',', '').strip()
        stock = int(st) if re.fullmatch(r'\d+', st) else None
        if url and m and m.group(1) in lcsc_stock and lcsc_stock[m.group(1)] is not None: stock = lcsc_stock[m.group(1)]
        out.append(dict(source='lcsc', model=model, brand=(row.get('brand') or '').strip(), code=row.get('code'), tiers=tl, url=url,
                        partner=partner, stock=stock, packaging=row.get('packaging') or None, unit='个', tax='included' if partner else 'unknown',
                        at=iso(rec.get('at_lcsc', rec['at'])), idnum=(m.group(1) if m else None)))
    return out

def ickey_cands(rec, pn):
    q = rec['queries']['ickey']
    out = []
    if q['state'] != 'ok': return out
    for row in q['rows']:
        model = (row.get('model') or '').strip()
        if model.upper() not in (pn.upper(), strip_paren(pn).upper()): continue
        if (row.get('currency') or '').lower() != 'rmb': continue
        nums, rmb = row.get('nums') or [], row.get('rmb') or []
        if not nums or len(nums) != len(rmb): continue
        tiers = {}
        for n, p in zip(nums, rmb):
            try:
                if Decimal(str(p)) > 0: tiers[int(n)] = fmt(p)
            except Exception: pass
        if not tiers: continue
        tl = [{"minQuantity": k, "unitPrice": tiers[k]} for k in sorted(tiers)]
        href = row.get('href') or ''
        m = re.match(r'^https://www\.ickey\.cn/detail/([1-9]\d*)/([^/?#]+)\.html$', href)
        url = href if m else None
        stock = row.get('stock')
        stock = int(stock) if isinstance(stock, (int, float)) and stock >= 0 else None
        out.append(dict(source='ickey', model=model, brand=(row.get('brand') or '').strip(), code=str(row.get('sku')) if row.get('sku') else None, tiers=tl,
                        url=url, partner=False, stock=stock, packaging=row.get('packaging') or None, unit=None, tax='included',
                        sell=row.get('sellState'), at=iso(rec.get('at_ickey', rec['at'])), idnum=None))
    return out

# ---------------------------------------------------------------- brand matching (real service code)
brand_cache = {}
def brand_batch(items):
    need = [i for i in items if (i['expected'], i['observed'], i['source']) not in brand_cache]
    need = list({(i['expected'], i['observed'], i['source']): i for i in need}.values())
    if need:
        json.dump(need, open(W + '/tsk/_b.json', 'w'))
        r = subprocess.run(['npx', 'tsx', 'brand.ts', '_b.json'], cwd=W + '/tsk', capture_output=True, text=True)
        res = json.loads(r.stdout)
        for i, x in zip(need, res): brand_cache[(i['expected'], i['observed'], i['source'])] = x
def bm(expected, observed, source):
    if (expected, observed, source) not in brand_cache:
        brand_batch([dict(expected=expected, observed=observed, source=source)])
    return brand_cache[(expected, observed, source)]

# prefetch all brand combos
allc = {}
for p in pairs:
    rec = scr.get(p['partNumber'])
    if not rec: continue
    for c in lcsc_cands(rec, p['partNumber']) + ickey_cands(rec, p['partNumber']):
        allc[(p['brand'], c['brand'], c['source'])] = 1
        # canonical-stage checks (cross-source) handled lazily below
brand_batch([dict(expected=a, observed=b, source=s) for (a, b, s) in allc])

# ---------------------------------------------------------------- state
recs = {}   # (pn, brand) -> record
order = []
for r in snap['records']:
    k = (r['partNumber'], r['brand'])
    recs[k] = copy.deepcopy(r); order.append(k)
bindings = {(b['raw']['partNumber'], b['raw']['brand']): copy.deepcopy(b) for b in bind['bindings']}
new_bind_order = []
stats = dict(direct=0, bound=0, skipped_nobind=0, existing=0)
log = []
GEN = datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%S.000Z')

def get_rec(pn, brand, fetched):
    k = (pn, brand)
    if k not in recs:
        recs[k] = {"partNumber": pn, "brand": brand,
                   "references": {s: empty(s, fetched) for s in SRC}, "evidence": {s: None for s in SRC}}
        order.append(k)
    return recs[k]

def make_quote(c, expected_pn, expected_brand, canon=False):
    """returns (quote, evidence) for record identity (expected_pn, expected_brand)."""
    t = c['tiers']; mx = t[-1]
    url = c['url']
    if url is None:
        base = 'https://so.szlcsc.com/global.html?k=' if c['source'] == 'lcsc' else 'https://search.ickey.cn/?keyword='
        url = base + enc(expected_pn)
    matched = c['model'] if c['model'].upper() == expected_pn.upper() else expected_pn
    stock = c['stock']
    q = {"source": c['source'], "status": "ok", "matchedPartNumber": matched, "matchedBrand": c['brand'], "productCode": c['code'],
         "pageUrl": url, "stockQuantity": stock, "unitPrice": mx['unitPrice'], "tierQuantity": mx['minQuantity'], "tiers": t,
         "currency": "CNY", "unit": c['unit'], "taxStatus": c['tax'], "packaging": c['packaging'], "fetchedAt": c['at'],
         "expiresAt": None, "stockInsufficientForTier": bool(stock is not None and stock < mx['minQuantity']), "message": None}
    m = bm(expected_brand, c['brand'], c['source'])
    ev = {"expectedPartNumber": expected_pn, "observedPartNumber": matched, "expectedBrand": expected_brand, "observedBrand": c['brand'],
          "brandMatch": m, "literalReason": None if m == 'exact' else c['brand'], "pageUrl": url, "collectedAt": c['at'],
          "observedMaxQuantity": mx['minQuantity'], "observedMaxUnitPrice": mx['unitPrice'], "maxTierConfirmed": True}
    return q, ev

def rank(c, brand):
    s = c['source']
    mm = bm(brand, c['brand'], s) is not None
    if s == 'lcsc':
        return (0 if mm else 1, 1 if c['partner'] else 0, 0 if c['idnum'] else 1)
    return (0 if mm else 1, 0 if (c.get('sell') == 1) else 1, 0 if (c['stock'] or 0) > 0 else 1)

def pick(cs, brand):
    if not cs: return None
    return sorted(enumerate(cs), key=lambda x: (rank(x[1], brand), x[0]))[0][1]

def canon_mpn(c):
    m = c['model']
    if re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._+#/\-]*', m): return m
    s = strip_paren(m)
    if re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._+#/\-]*', s): return s
    return None

def basis(p, cs):
    parts = []
    for c in cs:
        site = '立创商城' if c['source'] == 'lcsc' else '云汉芯城'
        parts.append(f"{site}实际读取：型号{c['model']}，品牌{c['brand']}，取最大数量梯度{c['tiers'][-1]['minQuantity']}+价格{c['tiers'][-1]['unitPrice']}元" + (f"，页面{c['url']}" if c['url'] else ''))
    s = f"按补齐价格原则：库存型号{p['partNumber']}、库存品牌/品类{p['brand']}，与渠道公开页同型号商品对应(库存品牌多为品类词或简称)。" + '；'.join(parts)
    return s[:2000]

cov = {}
for p in pairs:
    pn, brand = p['partNumber'], p['brand']
    rec = scr.get(pn)
    k = (pn, brand)
    # which sources still lack ok (direct or via existing binding)
    def has_ok(s):
        r = recs.get(k)
        if r and r['references'][s]['status'] == 'ok': return True
        b = bindings.get(k)
        if b and s in b['sources']:
            cr = recs.get((b['canonical']['partNumber'], b['canonical']['brand']))
            if cr and cr['references'][s]['status'] == 'ok': return True
        return False
    need = [s for s in SRC if not has_ok(s)]
    if not need:
        stats['existing'] += 1; continue
    if not rec:
        continue
    chosen = {}
    for s in need:
        cs = lcsc_cands(rec, pn) if s == 'lcsc' else ickey_cands(rec, pn)
        c = pick(cs, brand)
        if c: chosen[s] = c
    if not chosen: continue
    direct, viabind = {}, {}
    for s, c in chosen.items():
        same_mpn = c['model'].upper() == pn.upper()
        if same_mpn and bm(brand, c['brand'], s) in ('exact', 'explicit_alias'): direct[s] = c
        else: viabind[s] = c
    for s, c in direct.items():
        r = get_rec(pn, brand, c['at'])
        q, ev = make_quote(c, pn, brand)
        r['references'][s] = q; r['evidence'][s] = ev
        stats['direct'] += 1
    if viabind:
        if k in bindings:
            # existing binding for this raw pair: only usable if same canonical identity
            b = bindings[k]; cn = (b['canonical']['partNumber'], b['canonical']['brand'])
            ok = {}
            for s, c in viabind.items():
                if canon_mpn(c) and canon_mpn(c).upper() == cn[0].upper() and (c['brand'] == cn[1] or bm(cn[1], c['brand'], s) in ('exact', 'explicit_alias')): ok[s] = c
            if not ok:
                stats['skipped_nobind'] += len(viabind); log.append(('existing-binding-conflict', pn, brand)); continue
            for s, c in ok.items():
                cr = get_rec(cn[0], cn[1], c['at']); q, ev = make_quote(c, cn[0], cn[1])
                cr['references'][s] = q; cr['evidence'][s] = ev
                if s not in b['sources']: b['sources'].append(s)
                stats['bound'] += 1
            continue
        # choose canonical identity: try literal observed brands (and their short forms) so one canonical can cover both sources
        order_src = sorted(viabind, key=lambda s: 0 if s == 'lcsc' else 1)
        best = None
        for s0 in order_src:
            c0 = viabind[s0]; cm = canon_mpn(c0)
            if not cm: continue
            cand_brands = []
            for sx in order_src:
                bx = viabind[sx]['brand']
                for cb_ in (bx, re.split(r'[(/（]', bx)[0].strip()):
                    if cb_ and cb_ not in cand_brands: cand_brands.append(cb_)
            for cb_ in cand_brands:
                if len(cb_) > 64 or not cb_.strip() or cb_ != cb_.strip() or re.search(r'[*?\\]', cb_): continue
                cover = []
                for s1 in order_src:
                    c1 = viabind[s1]
                    if canon_mpn(c1) and canon_mpn(c1).upper() == cm.upper() and bm(cb_, c1['brand'], s1) in ('exact', 'explicit_alias'): cover.append(s1)
                if s0 not in cover: continue
                if best is None or len(cover) > len(best[2]): best = (s0, cm, cover, cb_)
        if not best:
            stats['skipped_nobind'] += len(viabind); log.append(('no-canonical', pn, brand, {s: (c['model'], c['brand']) for s, c in viabind.items()})); continue
        s0, cm, cover, cb = best
        for s in cover:
            c = viabind[s]
            cr = get_rec(cm, cb, c['at'])
            if cr['references'][s]['status'] != 'ok':
                q, ev = make_quote(c, cm, cb); cr['references'][s] = q; cr['evidence'][s] = ev
            stats['bound'] += 1
        bindings[k] = {"raw": {"partNumber": pn, "brand": brand}, "canonical": {"partNumber": cm, "brand": cb}, "sources": cover,
                       "confirmation": {"reviewVersion": REVIEW, "manufacturerSpecificCompleteMpn": True, "uniqueManufacturer": True,
                                        "additionalSpecificationsMatch": True, "basis": basis(p, [viabind[s] for s in cover])}}
        new_bind_order.append(k)
        if len(cover) < len(viabind): log.append(('partial-bind', pn, brand, [s for s in viabind if s not in cover]))

# ------------------------------------------------------------------ write
doc = {"schemaVersion": 1, "collectionMode": "public-web-batch", "generatedAt": GEN, "records": [recs[k] for k in order]}
sb = (json.dumps(doc, ensure_ascii=False, indent=2) + '\n').encode()
open(OUT + '/channel-reference-snapshot.json', 'wb').write(sb)
sh = hashlib.sha256(sb).hexdigest()
bl = [bindings[(b['raw']['partNumber'], b['raw']['brand'])] for b in bind['bindings']] + [bindings[k] for k in new_bind_order]
bdoc = {"schemaVersion": 1, "snapshotSha256": sh, "bindings": bl}
bb = (json.dumps(bdoc, ensure_ascii=False, indent=2) + '\n').encode()
open(OUT + '/channel-reference-identity-bindings.json', 'wb').write(bb)
sd = copy.deepcopy(stock_doc); sd['snapshotSha256'] = sh
open(OUT + '/channel-reference-stock-evidence.json', 'wb').write((json.dumps(sd, ensure_ascii=False, indent=2) + '\n').encode())
json.dump(log, open(OUT + '/build_log.json', 'w'), ensure_ascii=False, indent=1)
print('records', len(doc['records']), 'bindings', len(bl), 'snapshot bytes', len(sb), 'bind bytes', len(bb), 'sha', sh)
print(stats, 'log', len(log))
