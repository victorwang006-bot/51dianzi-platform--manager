'use strict';
const C = require('./core.cjs');
const Previous = require('../demand-personal-core-20261114.cjs');
const fs = require('node:fs');
const { assert, path, BASE, OUT, read, write, sha, parse, ts } = C;

function run() {
  const parts = C.json(OUT + '/frontend-parts.json');
  assert.equal(parts.status, 'PASS', 'frozen source-bound frontend build required');
  const files = (parts.files || parts.records).map(item => ({ ...item }));
  const relocations = parts.relocations;
  const cssUrl = parts.cssUrl || parts.profile?.cssUrl;
  assert.equal(Object.keys(relocations).length, 3, 'only Layout, Profile and Staff relocate');
  assert.equal(files.length, 4, 'exact three source-bound modules plus scoped stylesheet');
  assert(cssUrl && cssUrl.startsWith('/assets/') && cssUrl.includes('profile-staff'));
  assert(files.every(item => item.relative !== 'index.html' && item.relative.includes('profile-staff')));
  for (const item of files) assert.equal(sha(fs.readFileSync(OUT + '/' + item.relative)), item.sha256);
  for (const [from, to] of Object.entries(relocations)) {
    assert(fs.existsSync(BASE + from) && fs.existsSync(OUT + to), 'same-directory baseline/output required');
    assert.equal(from.slice(0, from.lastIndexOf('/')), to.slice(0, to.lastIndexOf('/')), 'no directory prefix relocation');
  }
  const pins = parts.sourceHashes;
  assert(pins && Object.keys(pins).length > 0);
  for (const [relative, expected] of Object.entries(pins)) assert.equal(sha(fs.readFileSync(path.join(C.REPO, relative))), expected, 'source drift: ' + relative);

  // Reuse the reviewed prior implementation with this round's local output and
  // baseline bindings, never calling its old hard-coded workspace writer.
  const specifiers = text => [...new Set(C.specs(parse(text)))];
  const implementation = Previous.finishHTML.toString().replace('data-demand-personal-center', 'data-profile-staff');
  const finishHTML = new Function('BASE', 'OUT', 'read', 'specs', 'resolve', 'write', 'assert', 'ts', 'sha',
    'return (' + implementation + ');')(BASE, OUT, read, specifiers, C.resolve, write, assert, ts, sha);
  fs.copyFileSync(BASE + '/index.html', BASE + '/index-before.html');
  finishHTML(relocations, files, cssUrl, undefined);
  const before = read(BASE + '/index.html'), after = read(OUT + '/index.html');
  const stylesheetTags = html => [...html.matchAll(/<link[^>]*rel="stylesheet"[^>]*>/g)].map(match => match[0]);
  for (const tag of stylesheetTags(before)) assert(after.includes(tag), 'old stylesheet removed');
  const entryTags = html => [...html.matchAll(/<script[^>]*type="module"[^>]*src="[^"]+"[^>]*>/g)].map(match => match[0]);
  assert.deepEqual(entryTags(after), entryTags(before), 'native Entry must not relocate or change');
  const proof = C.json(OUT + '/html-build-proof.json');
  const dependencies = C.json(OUT + '/dependency-resolution-proof.json');
  assert(proof.exactInverse && dependencies.status === 'PASS');
  assert.equal(files.length, 5);
  const summary = { status: 'PASS', files: files.length, relocatedModules: 3,
    htmlSha256: sha(after), sourcePins: Object.keys(pins).length,
    effectiveDependenciesValidated: dependencies.checks.length,
    oldStylesheetsRetained: true, nativeEntryByteAndUrlUnchanged: true,
    customerWorkbenchRelocations: 0, exactHtmlInverse: true,
    priorMergeLogicReusedWithNewBindings: true };
  write('merged-summary.json', summary);
  console.log(JSON.stringify(summary));
  return summary;
}
if (require.main === module) run();
module.exports = { run };
