import crypto from 'node:crypto';
import assert from 'node:assert/strict';
export const RELEASE = '20261105-admin-navigation-priority-v1';
export const sha = x => crypto.createHash('sha256').update(x).digest('hex');
export const BASELINE = Object.freeze({
  'index.html': 'be09a54a98a8818489747f126b842eb190e9aeb51cd434b4418d8aa48d86e53e',
  'BusinessWorkbenchPage-channel-topnav-8a87eab5f4411680.js': '8a87eab5f44116805d58f8f1c4e67dd3aa343fadb64c89c298a66472d291f7db',
  'DashboardLayout-hierarchy-0d8df8ea8ac13048.js': '0d8df8ea8ac13048b624c2a58a69fbc205d684c7ec00c16e8e03aa24e51ec97e',
  'index-CG0lkwm6.js': '602034896c9cb13cf9ad805dc07aae113ea907cb4291cff09189398f2c727bd8',
  'index-C0vPar7R.css': '871768387861545514e30d482d34a3cf7a15a0f783bde72c998ab89e2863b5d2',
  'channel-inventory-management-6180ba0776bef02e.css': '6180ba0776bef02e9c256c349be63feeb15235246fb3340121d9dbd2b7cd9980',
  'workbench-dropdown-db9a38c798c52dd6.css': 'db9a38c798c52dd6c905db76fb7224eb36db221339db4a4dfb610b2dd3d9e96e',
  'workspace-hierarchy-e7d8dc9d788ea1bb.css': 'e7d8dc9d788ea1bb9710dac406fd972067957d49b83ce2e5a901703d0547ab69',
});
export function assembleHtml(old, built, namespace) {
  const original = old;
  assert.equal(sha(old), BASELINE['index.html'], 'HTML baseline drift');
  assert.match(namespace, new RegExp(`^${RELEASE}-[a-f0-9]{12}$`));
  assert.ok(!built.includes('/admin/assets/'), 'root subdomain base required');
  const edits = [];
  function replaceOne(before, after, reason) {
    assert.ok(before && old.split(before).length === 2, `single HTML edit required: ${reason}`);
    const start = old.indexOf(before);
    edits.push({ start, before, after, reason }); old = old.slice(0, start) + after + old.slice(start + before.length);
  }
  for (const marker of ['ci-management-v1', 'workbench-dropdown-nav-v1', 'workspace-hierarchy-nav-v1']) {
    const pattern = new RegExp(`<!-- ${marker}:start -->[\\s\\S]*?<!-- ${marker}:end -->\\n`, 'g');
    const hits = [...old.matchAll(pattern)]; assert.equal(hits.length, 1, `expected one ${marker} block`);
    replaceOne(hits[0][0], '', `remove superseded ${marker} importmap/CSS activation only`);
  }
  const entry = [...built.matchAll(/<script\b[^>]*\btype="module"[^>]*\bsrc="([^"]+)"[^>]*><\/script>/g)];
  assert.equal(entry.length, 1, 'single production entry required');
  const links = [...built.matchAll(/<link\b[^>]*\brel="(?:stylesheet|modulepreload)"[^>]*>/g)].map(m => m[0]);
  assert.ok(links.some(t => t.includes('rel="stylesheet"')), 'production CSS missing');
  for (const tag of [entry[0][0], ...links]) {
    const urls = [...tag.matchAll(/(?:src|href)="([^"]+)"/g)].map(m => m[1]);
    assert.equal(urls.length, 1); assert.ok(urls[0].startsWith(`/assets/${namespace}/`), 'only versioned new asset graph allowed');
    assert.ok(!urls[0].includes('..') && !urls[0].includes('?') && !urls[0].includes('#'));
  }
  replaceOne('<script type="module" crossorigin src="/assets/index-CG0lkwm6.js"></script>', entry[0][0], 'production entry switch');
  replaceOne('<link rel="stylesheet" crossorigin href="/assets/index-C0vPar7R.css">', links.join('\n    '), 'production CSS/modulepreload graph switch');
  let restored = old;
  for (const e of [...edits].reverse()) {
    assert.equal(restored.slice(e.start, e.start + e.after.length), e.after, 'inverse edit range drift');
    restored = restored.slice(0, e.start) + e.before + restored.slice(e.start + e.after.length);
  }
  assert.equal(restored, original, 'non-graph HTML bytes changed');
  assert.equal(sha(restored), BASELINE['index.html']);
  return { html: old, edits: edits.map(e => ({ ...e, beforeSha256: sha(e.before), afterSha256: sha(e.after) })), inverseBytePreservationPassed: true };
}
