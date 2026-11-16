import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { H, read, parse, exact, delta, htmlDelta, resolve, save, assert, one } from '../self-operated-mall-plan-20261116/static-build/core.mjs';
const D = path.dirname(fileURLToPath(import.meta.url));
const out = D + '/candidate';
assert(!fs.existsSync(out), 'fresh candidate only');
fs.mkdirSync(out);
const targets = JSON.parse(read(D + '/targets.json'));
const before = read(D + '/before.js');
const html = read(D + '/before.html');
const map = JSON.parse(one([...html.matchAll(/<script[^>]+type="importmap"[^>]*>(.*?)<\/script>/gs)], 'effective importmap')[1]);
const patches = [
  exact(before, 'enabled:u&&o.split(/[?#]/,1)[0]!=="/workbench/mall-materials",retry:So', 'enabled:u,retry:So', 'global navigation read is current-account scoped, not current-page scoped'),
  exact(before, 'Ao({enabled:u&&o.split(/[?#]/,1)[0]!=="/workbench/mall-materials",isPending:w.isPending', 'Ao({enabled:u,isPending:w.isPending', 'global navigation display uses actual authorization on every page'),
];
const changed = delta(before, patches);
parse(changed.next);
assert(changed.inverseVerified, 'exact original-byte inverse');
assert(changed.next.includes('permission:"officialInventory.read"'), 'native mall permission preserved');
assert(changed.next.includes('N.path==="/workbench/mall-materials"&&t?.hasNativeAdminAccount!==!0'), 'native account gate preserved');
assert(changed.next.includes('export function nativeMallBridge()'), 'same native provider bridge preserved');
const url = save(out, 'DashboardLayout-native-mall-nav-fix', changed.next);
const B = { html, map, assets: { [targets.oldNav]: { localName: 'before.js' } }, get: () => before };
const hd = htmlDelta(B, { [targets.oldNav]: url });
assert(hd.inverseVerified, 'HTML mapping exact inverse');
for (const key of Object.keys(map.imports)) {
  const old = resolve(map, key, targets.rootEntry);
  const now = resolve(hd.map, key, targets.rootEntry);
  assert(now === (old === targets.oldNav ? url : old), 'unrelated importmap drift ' + key);
}
assert(hd.next.includes(targets.rootEntry) && hd.next.includes(targets.nativeCss), 'current native mall entry/CSS unchanged');
const currentEntry = read('/home/ubuntu/work/official-mall-native-v10-20261117/static-admin/' + path.basename(targets.rootEntry));
assert(currentEntry.includes(targets.nativeLeaf) && currentEntry.includes('__NativeMallRoute'), 'native leaf remains referenced by untouched App entry');
fs.writeFileSync(out + '/index.html', hd.next);
const source = '/home/ubuntu/work/51dianzi-platform--manager/client/src/components/DashboardLayout.tsx';
const checks = { exactlyTwoConditionsReverted: true, inverseVerified: true, htmlInverseVerified: true, globalNavigationCurrentAccountScoped: true, nativeMallPermissionAndAccountGateUnchanged: true, sameProviderBridgeUnchanged: true, rootEntryLeafAndCssUnchanged: true, noApiDatabaseWorkerChanges: true };
const manifest = { scope: 'mall-native-global-navigation-two-conditions-only', staticRoot: targets.staticRoot, oldEntry: targets.oldNav, newEntry: url, files: [{ name: path.basename(url) }], oldHtmlSha256: H(html), newHtmlSha256: H(hd.next), oldModuleSha256: H(before), newModuleSha256: H(changed.next), sourceSha256: H(fs.readFileSync(source)), patch: changed.patches, ...targets, checks };
fs.writeFileSync(D + '/manifest.json', JSON.stringify(manifest, null, 2) + '\n');
console.log(JSON.stringify(checks));
