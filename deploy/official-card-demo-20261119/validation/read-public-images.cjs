#!/usr/bin/env node
'use strict';
const cp = require('node:child_process');
const assert = require('node:assert/strict');
const EXPECTED = 'https://dianzi51-assets.oss-cn-hangzhou.aliyuncs.com/material-images/STM32F103C8T6.png';
function read(method, input) {
  assert.ok(['list', 'detail'].includes(method));
  const u = new URL('https://51dianzi.com/api/trpc/officialMall.' + method);
  u.searchParams.set('input', JSON.stringify({ json: input }));
  const raw = cp.execFileSync('curl', ['-fsS', '--compressed', '--max-time', '15', '-A', 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36', '--resolve', '51dianzi.com:443:127.0.0.1', '-H', 'Origin: https://51dianzi.com', '-H', 'Referer: https://51dianzi.com/search?q=STM32F103C8T6', u.href], { timeout: 20000, maxBuffer: 2097152 });
  const envelope = JSON.parse(raw);
  assert.ok(envelope.result && envelope.result.data && !envelope.error);
  return envelope.result.data.json;
}
(async () => {
  const before = read('list', { partNumber: 'STM32F103C8T6', brand: 'ST', page: 1, pageSize: 100 });
  const exact = before.items.filter(x => x.partNumber === 'STM32F103C8T6' && x.brand === 'ST');
  assert.ok(exact.length > 0, 'EXACT_PUBLIC_OFFICIAL_MATERIAL_REQUIRED');
  let item;
  for (let i = 0; i < 4; i++) {
    const result = read('detail', { publicId: exact[0].publicId });
    item = result.item;
    assert.ok(item && item.publicId === exact[0].publicId && item.revision === exact[0].revision);
    if (item.thumbnailUrl && item.imageKind === 'catalog_reference') break;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  if (process.argv.includes('--require-image')) {
    assert.ok(item.thumbnailUrl && item.imageKind === 'catalog_reference', 'SYSTEM_REFERENCE_IMAGE_REQUIRED');
    const u = new URL(item.thumbnailUrl);
    assert.equal(u.origin + u.pathname, EXPECTED);
    const after = read('list', { partNumber: 'STM32F103C8T6', brand: 'ST', page: 1, pageSize: 100 });
    assert.ok(after.items.some(x => x.publicId === item.publicId && x.thumbnailUrl === item.thumbnailUrl));
  }
  console.log(JSON.stringify({ status: 'public-image-readonly-passed', methods: ['officialMall.list', 'officialMall.detail'], systemImageMatched: item.thumbnailUrl ? new URL(item.thumbnailUrl).origin + new URL(item.thumbnailUrl).pathname === EXPECTED : false, imageKind: item.imageKind || null, readonlyGET: true, browserSessionMinted: false, ordersSubmitted: 0 }));
})().catch(e => { console.error(JSON.stringify({ status: 'failed', reason: e.code || e.message })); process.exitCode = 1; });
