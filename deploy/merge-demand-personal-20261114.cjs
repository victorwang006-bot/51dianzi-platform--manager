#!/usr/bin/env node
'use strict';
const C = require('./demand-personal-core-20261114.cjs');
const { fs, path, assert, OUT, BASE, read, sha, write, finishHTML } = C;
const W = '/home/ubuntu/work/demand-personal-center';
const load = f => JSON.parse(read(f));
function merge() {
  const customer = load(OUT + '/customer-parts.json');
  const statics = load(W + '/static-input/static-parts.json');
  assert.equal(customer.status, 'PASS');
  assert(['PASS', 'BUILT'].includes(statics.status));
  const records = [...customer.records, ...statics.records];
  assert.equal(new Set(records.map(x => x.relative)).size, records.length);
  for (const record of statics.records) {
    const source = W + '/static-input/' + record.relative;
    assert.equal(sha(fs.readFileSync(source)), record.sha256);
    const target = OUT + '/' + record.relative;
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target);
  }
  for (const record of records) assert.equal(sha(fs.readFileSync(OUT + '/' + record.relative)), record.sha256);
  const relocations = { ...customer.relocations, ...statics.relocations };
  assert.equal(Object.keys(relocations).length, Object.keys(customer.relocations).length + Object.keys(statics.relocations).length);
  finishHTML(relocations, records, statics.cssUrl, statics.entryFrom);
  const html = read(OUT + '/index.html'), before = read(BASE + '/index-before.html');
  const styles = text => [...text.matchAll(/<link[^>]*rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/g)].map(m => m[1]);
  assert.deepEqual(styles(html).filter(url => url !== statics.cssUrl), styles(before));
  assert(styles(html).includes(statics.cssUrl));
  const sourceHashes = { ...customer.sourceHashes };
  for (const [file, hash] of Object.entries(statics.sourceHashes)) { assert(!sourceHashes[file] || sourceHashes[file] === hash); sourceHashes[file] = hash; }
  for (const [file, hash] of Object.entries(sourceHashes)) assert.equal(sha(fs.readFileSync(C.REPO + '/' + file)), hash);
  write('frontend-source-hashes.json', sourceHashes);
  write('merged-static-summary.json', { status: 'PASS', files: records.length, relocatedModules: Object.keys(relocations).length, htmlSha256: sha(html), sourceHashCount: Object.keys(sourceHashes).length, allOldStylesheetsRetained: true, newPersonalStylesheet: statics.cssUrl, effectiveDependenciesValidated: load(OUT + '/dependency-resolution-proof.json').checks.length, originalHtmlExactInverse: load(OUT + '/html-build-proof.json').exactInverse });
  console.log(read(OUT + '/merged-static-summary.json'));
}
if (require.main === module) try { merge(); } catch (error) { console.error(error.stack); process.exitCode = 1; }
module.exports = { merge };
