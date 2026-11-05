import crypto from 'node:crypto';
import assert from 'node:assert/strict';
export const RELEASE = '20261105-admin-compact-priority-v2';
export const sha = x => crypto.createHash('sha256').update(x).digest('hex');
export const BASELINE = Object.freeze({
  'index.html': '331750172d2921992a57470bb2361bd3ce1334aa279f4a3d4414b9529b766965',
  'public-baseline.json': '7e0206e39174fbcd1125b31b562dc626b1e388291a2388409aaf62f04c12759b',
  'processes.json': 'cc8d5a894ac651fba0060de1e07c24130a7f97185969e02dbf2cb998c9db5a63',
  'front-live-index.js': '122b60ca94947042765327623db3430c2a8411c72b2b272a937b2d434e15e1af',
  'admin-live-index.js': '73013efffa4f3cd840c9f49f45f72d04bf47ca733348d2c498b8d6b5aa77e8b7',
});
export const OLD_ENTRY = '<script type="module" crossorigin src="/assets/20261105-admin-navigation-priority-v1-9aca212e491a/index-Bpi0HiVr.js"></script>';
export const OLD_STYLE = '<link rel="stylesheet" crossorigin href="/assets/20261105-admin-navigation-priority-v1-9aca212e491a/index-srXaB4c0.css">';
export function assembleHtml(old, built, namespace, expectedSha = BASELINE['index.html']) {
  const original = old;
  assert.equal(sha(old), expectedSha, 'HTML baseline drift');
  assert.match(namespace, new RegExp(`^${RELEASE}-[a-f0-9]{12}$`));
  assert.ok(!/<script\b[^>]*type=["']importmap["']/.test(old), 'unexpected importmap');
  const entries = [...built.matchAll(/<script\b[^>]*\btype="module"[^>]*\bsrc="([^"]+)"[^>]*><\/script>/g)];
  assert.equal(entries.length, 1, 'single built entry required');
  const links = [...built.matchAll(/<link\b[^>]*\brel="(?:stylesheet|modulepreload)"[^>]*>/g)].map(m => m[0]);
  const styles = links.filter(t => t.includes('rel="stylesheet"'));
  const preloads = links.filter(t => t.includes('rel="modulepreload"'));
  assert.ok(styles.length, 'production stylesheet required');
  for (const tag of [entries[0][0], ...links]) {
    assert.match(tag, /^<(?:script type="module" crossorigin src="[^"<>]+"><\/script>|link rel="(?:stylesheet|modulepreload)" crossorigin href="[^"<>]+">)$/);
    const url = [...tag.matchAll(/(?:src|href)="([^"]+)"/g)][0][1];
    assert.ok(url.startsWith(`/assets/${namespace}/`) && !/[?#]|\.\./.test(url), 'new namespace only');
  }
  assert.equal([...old.matchAll(/<script\b[^>]*type="module"[^>]*src=/g)].length, 1);
  assert.equal([...old.matchAll(/<link\b[^>]*rel="(?:stylesheet|modulepreload)"/g)].length, 1, 'unexpected old graph');
  const edits = [];
  function replace(before, after, reason, insertionAnchor) {
    let start;
    if (before) { assert.equal(old.split(before).length, 2, `single edit: ${reason}`); start = old.indexOf(before); }
    else { assert.equal(old.split(insertionAnchor).length, 2); start = old.indexOf(insertionAnchor); }
    edits.push({ start, before, after, reason, beforeSha256: sha(before), afterSha256: sha(after) });
    old = old.slice(0, start) + after + old.slice(start + before.length);
  }
  replace(OLD_ENTRY, entries[0][0], 'main-module');
  replace(OLD_STYLE, styles.join('\n    '), 'styles');
  replace('', preloads.length ? preloads.join('\n    ') + '\n    ' : '', 'preloads', entries[0][0]);
  assert.equal(restoreHtml(old, edits), original, 'non-graph bytes changed');
  return { html: old, edits, inverseBytePreservationPassed: true };
}
export function restoreHtml(candidate, edits) {
  for (const e of [...edits].reverse()) {
    assert.equal(sha(e.before), e.beforeSha256); assert.equal(sha(e.after), e.afterSha256);
    assert.equal(candidate.slice(e.start, e.start + e.after.length), e.after, 'inverse range drift');
    candidate = candidate.slice(0, e.start) + e.before + candidate.slice(e.start + e.after.length);
  }
  return candidate;
}
export function cleanEnv(home, mode = 'production') {
  const allowed = ['PATH', 'LANG', 'LC_ALL', 'TMPDIR'];
  return { ...Object.fromEntries(allowed.filter(k => process.env[k]).map(k => [k, process.env[k]])), HOME: home, NODE_ENV: mode, VITE_BASE_PATH: '/', CI: 'true', NO_COLOR: '1', FORCE_COLOR: '0' };
}
export function chooseTests(files) {
  const original = /(?:DashboardLayout\.navigation|AdminWorkspaceNavigation|adminWorkspaceNavigation|CustomerList|ChannelInventoryHost|BatchUpload|ChannelInventoryBrowsePanel|ChannelInventoryManagementPanel|ChannelInventorySourcePanel|CustomerSupply|CustomerDraftIndustry)/;
  const related = /(?:customers\/|CustomerPriority|CustomerDelegated|CustomerCreate|CustomerStars|CustomerActions|CustomerInline|customerPriority|customerStars|channelInventory|channelTeamInventory|strictBFF|Memory|memory|Staff|staff|Archive|archive|procurementWorkspaceNav|enterpriseMemberHandoffContract|enterpriseInventoryRoutingContract|enterpriseMembershipPolicy|inventoryImportTransaction|inventoryImportPreviewStage|inventoryImportPreviewRepair|companyMemberPrivacyRegression)/;
  const candidates = files.filter(f => /\.(?:test|spec)\.(?:tsx?|mjs)$/.test(f.path) && (original.test(f.path) || related.test(f.path)));
  const db = candidates.filter(f => /(?:\.mysql\.|integration|\.db\.)/i.test(f.path));
  return { selected: candidates.filter(f => !db.includes(f)).map(f => f.path).sort(), dbSkipped: db.map(f => ({ path: f.path, status: 'skipped', reason: 'No isolated DB connection authorized or supplied; production ENV is never inherited.' })) };
}
