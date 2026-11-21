#!/usr/bin/env python3
"""Fetch exact LCSC stock ("现货：N") from item pages for rows chosen by build.py candidates.
Usage: stock.py [workers]; resumable, writes lcsc_stock.json {id: stock|null}"""
import asyncio, json, re, sys, os, glob, random
from playwright.async_api import async_playwright
W = '/home/ubuntu/work'
UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
OUTF = W + '/lcsc_stock.json'
res = json.load(open(OUTF)) if os.path.exists(OUTF) else {}
ids = []
for fn in glob.glob(W + '/scrape_*.jsonl'):
    for l in open(fn):
        r = json.loads(l)
        q = r['queries']['lcsc']
        for row in q.get('rows', []):
            if (row.get('model') or '').strip().upper() != (q.get('query') or r['mpn']).upper(): continue
            m = re.match(r'^https://item\.szlcsc\.com/((?:mro/)?[1-9]\d*)\.html', row.get('href') or '')
            if not m: continue
            st = (row.get('stockText') or '').replace(',', '').strip()
            if re.fullmatch(r'\d+', st): continue          # exact already
            ids.append(m.group(1))
ids = [i for i in dict.fromkeys(ids) if i not in res or res[i] is None and False]
ids = [i for i in ids if i not in res]
print('to fetch', len(ids), flush=True)

async def one(ctx, i):
    pg = await ctx.new_page()
    try:
        await pg.goto(f'https://item.szlcsc.com/{i}.html', wait_until='domcontentloaded', timeout=45000)
        try:
            await pg.wait_for_function("/现货[:：]\\s*[\\d,]+/.test(document.body.innerText) || /库存总量/.test(document.body.innerText) && /暂无|缺货/.test(document.body.innerText)", timeout=25000)
        except Exception: pass
        await pg.wait_for_timeout(1500)
        t = await pg.inner_text('body')
        m = re.search(r'现货[:：]\s*([\d,]+)', t) or re.search(r'库存[:：]\s*([\d,]+)', t)
        if m: return int(m.group(1).replace(',', ''))
        if re.search(r'暂无现货|无现货|缺货', t): return 0
        return None
    except Exception:
        return 'err'
    finally:
        await pg.close()

async def main(workers):
    q = asyncio.Queue()
    for i in ids: q.put_nowait(i)
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/chromium', args=['--no-sandbox'])
        async def w():
            ctx = await b.new_context(user_agent=UA, locale='zh-CN')
            while True:
                try: i = q.get_nowait()
                except asyncio.QueueEmpty: break
                v = await one(ctx, i)
                if v == 'err':
                    await asyncio.sleep(2); v = await one(ctx, i)
                if v != 'err':
                    res[i] = v
                    if len(res) % 10 == 0: json.dump(res, open(OUTF, 'w'))
                await asyncio.sleep(random.uniform(0.2, 0.8))
            await ctx.close()
        await asyncio.gather(*[w() for _ in range(workers)])
        await b.close()
    json.dump(res, open(OUTF, 'w'))
    print('done', len(res), 'null', sum(1 for v in res.values() if v is None))
asyncio.run(main(int(sys.argv[1]) if len(sys.argv) > 1 else 6))
