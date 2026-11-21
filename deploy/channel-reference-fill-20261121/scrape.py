#!/usr/bin/env python3
"""Scrape szlcsc.com + ickey.cn public search for a list of MPNs. Raw candidates go to a JSONL file.
Usage: scrape.py mpns.txt out.jsonl [workers]
Resumable: MPNs already in out.jsonl (both sources) are skipped."""
import asyncio, sys, json, re, random, time, os
from urllib.parse import quote
from playwright.async_api import async_playwright

UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'

def variants(mpn):
    v = [mpn.strip()]
    s = re.sub(r'[（(][^)）]*[)）]', '', mpn).strip()          # drop "(0402)" style package notes
    if s and s not in v: v.append(s)
    return v

def parse_lcsc(text, hrefs):
    lines = [l.strip() for l in text.split('\n') if l.strip()]
    if any('未找到相匹配' in l for l in lines):
        return {'state': 'no_result', 'rows': []}
    # self-operated section ends where overseas-agency rows begin
    end = len(lines)
    for i, l in enumerate(lines):
        if l == '海外代购':
            end = i; break
    start = 0
    for i, l in enumerate(lines):
        if l == '操作': start = i + 1; break
    else:
        for i, l in enumerate(lines):
            if l == '搜索关键字': start = i + 2; break
    sec = lines[start:end]
    idx = [i for i in range(len(sec) - 2) if sec[i + 1] == '品牌']
    rows = []
    for n, i in enumerate(idx):
        j = idx[n + 1] if n + 1 < len(idx) else len(sec)
        blk = sec[i:j]
        model, brand = blk[0], blk[2] if len(blk) > 2 else ''
        code = None
        if '编号' in blk:
            k = blk.index('编号'); code = blk[k + 1] if k + 1 < len(blk) else None
        tiers = []
        for k in range(len(blk) - 1):
            m = re.fullmatch(r'(\d+)\+', blk[k]); p = re.fullmatch(r'[￥¥]([\d.]+)', blk[k + 1])
            if m and p: tiers.append([int(m.group(1)), p.group(1)])
        stock = None; kind = 'partner'
        for k, l in enumerate(blk):
            if l == '现货' and k + 1 < len(blk) and re.fullmatch(r'[\d.,]+[KkMm万wW]*\+?', blk[k + 1]):
                stock = blk[k + 1]; kind = 'self'; break
        if stock is None:
            for k, l in enumerate(blk):
                if l == '库存' and k + 1 < len(blk) and re.fullmatch(r'[\d.,]+[KkMm万wW]*\+?', blk[k + 1]):
                    stock = blk[k + 1]; break
        pkg = None
        for l in blk:
            if re.search(r'个/(圆盘|盘|管|袋|卷|盒)|^(编带|袋装|管装|托盘|盒装)', l): pkg = l; break
        rows.append({'model': model, 'brand': brand, 'code': code, 'tiers': tiers, 'stockText': stock,
                     'packaging': pkg, 'kind': kind, 'href': hrefs.get(model)})
    return {'state': 'ok' if rows else 'unparsed', 'rows': rows}

async def lcsc_query(ctx, mpn):
    pg = await ctx.new_page()
    try:
        await pg.goto('https://so.szlcsc.com/global.html?k=' + quote(mpn), wait_until='domcontentloaded', timeout=45000)
        try:
            await pg.wait_for_function("document.body.innerText.includes('未找到相匹配') || document.body.innerText.includes('价格梯度') || document.body.innerText.includes('验证')", timeout=25000)
        except Exception: pass
        await pg.wait_for_timeout(1500)
        text = await pg.inner_text('body')
        hrefs = await pg.evaluate("""() => { const m = {}; document.querySelectorAll('a[href*="item.szlcsc.com"]').forEach(a => { const t = (a.innerText||'').trim(); if (t && !m[t]) m[t] = a.href; }); return m; }""")
        if (re.search(r'验证码|滑动验证|访问过于频繁|安全验证|用户登录中心', text) or 'login' in pg.url) and '价格梯度' not in text and '未找到相匹配' not in text:
            return {'state': 'restricted', 'rows': []}
        res = parse_lcsc(text, hrefs)
        i0 = text.find('搜索关键字'); i1 = text.find('购物指南')
        res['raw'] = text[i0:i1][:6000] if i0 >= 0 else text[:3000]
        return res
    except Exception as e:
        return {'state': 'error', 'error': str(e)[:200], 'rows': []}
    finally:
        await pg.close()

async def ickey_query(ctx, mpn):
    pg = await ctx.new_page()
    got = []
    async def on(r):
        if 'get-search-res' in r.url:
            try: got.append(await r.json())
            except Exception: pass
    pg.on('response', on)
    try:
        await pg.goto('https://search.ickey.cn/?keyword=' + quote(mpn), wait_until='networkidle', timeout=60000)
        await pg.wait_for_timeout(4000)
        def best():
            c = [o for o in got if (o.get('data') or {}).get('total_number', 0) > 0]
            return c[-1] if c else None
        if not best():
            await pg.wait_for_timeout(5000)
        b = best()
        if not b:
            return {'state': 'no_result' if got else 'error', 'rows': []}
        rows = []
        for g in b['data']['group_products']:
            for p in (g.get('products') or []) + (g.get('products_more') or []):
                rows.append({'model': p.get('pro_sno'), 'brand': p.get('std_mfr_short') or p.get('mfr_name'),
                             'sku': p.get('sku'), 'stock': p.get('stock'), 'nums': p.get('nums'), 'rmb': p.get('rmb'),
                             'currency': p.get('currency'), 'packaging': p.get('packaging'), 'package': p.get('package'),
                             'href': ('https:' + p['detail_url']) if p.get('detail_url', '').startswith('//') else p.get('detail_url'),
                             'leadTime': p.get('lead_time_cn'), 'sellState': p.get('sell_state'), 'isLogin': b['data'].get('is_login')})
        return {'state': 'ok', 'rows': rows}
    except Exception as e:
        return {'state': 'error', 'error': str(e)[:200], 'rows': []}
    finally:
        await pg.close()

async def worker(name, browser, queue, out, done):
    ctx = await browser.new_context(user_agent=UA, locale='zh-CN')
    while True:
        try: mpn = queue.get_nowait()
        except asyncio.QueueEmpty: break
        rec = {'mpn': mpn, 'at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), 'queries': {}}
        t0=time.time()
        for src, fn in (('lcsc', lcsc_query), ('ickey', ickey_query)):
            res = None
            for v in variants(mpn):
                for attempt in range(4):
                    res = await fn(ctx, v)
                    if res['state'] == 'restricted' or (fn is ickey_query and res['state'] == 'error'):
                        await ctx.close(); await asyncio.sleep(15 * (attempt + 1) + random.uniform(0, 10))
                        ctx = await browser.new_context(user_agent=UA, locale='zh-CN'); continue
                    break
                res['query'] = v
                exact = [r for r in res['rows'] if (r.get('model') or '').strip().upper() == v.upper()]
                if exact or res['state'] in ('restricted',): break
                if res['state'] == 'error':
                    await asyncio.sleep(2); res = await fn(ctx, v); res['query'] = v
                    if res['rows']: break
            rec['queries'][src] = res
            res['sec'] = round(time.time()-t0,1); t0=time.time()
            await asyncio.sleep(random.uniform(0.3, 1.0))
        out.write(json.dumps(rec, ensure_ascii=False) + '\n'); out.flush()
        done[0] += 1
        if done[0] % 10 == 0: print(f'[{time.strftime("%H:%M:%S")}] done {done[0]}', flush=True)
    await ctx.close()

async def main(mpn_file, out_file, workers):
    mpns = [l.strip() for l in open(mpn_file, encoding='utf8') if l.strip()]
    seen = set()
    if os.path.exists(out_file):
        for l in open(out_file, encoding='utf8'):
            try: seen.add(json.loads(l)['mpn'])
            except Exception: pass
    todo = [m for m in mpns if m not in seen]
    print('total', len(mpns), 'todo', len(todo), flush=True)
    q = asyncio.Queue()
    for m in todo: q.put_nowait(m)
    done = [0]
    async with async_playwright() as p:
        browser = await p.chromium.launch(executable_path='/usr/bin/chromium', args=['--no-sandbox'])
        with open(out_file, 'a', encoding='utf8') as out:
            await asyncio.gather(*[worker(i, browser, q, out, done) for i in range(workers)])
        await browser.close()
    print('FINISHED', done[0], flush=True)

if __name__ == '__main__':
    asyncio.run(main(sys.argv[1], sys.argv[2], int(sys.argv[3]) if len(sys.argv) > 3 else 4))
