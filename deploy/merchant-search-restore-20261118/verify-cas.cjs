#!/usr/bin/env node
'use strict';
// This is a local, read-only verifier, NOT an apply or download command.
// The caller must freshly retrieve live files while holding its deployment locks.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {sha,EXPECTED}=require('./build-native.cjs');
const [freshJs,freshCss,freshHtml,source,candidateDir,receiptFile]=process.argv.slice(2);
if(!receiptFile)throw Error('Usage: node verify-cas.cjs FRESH_LIVE_JS FRESH_LIVE_CSS FRESH_LIVE_HTML SOURCE CANDIDATE_DIR FRESH_RECEIPT_JSON');
const receipt=JSON.parse(fs.readFileSync(receiptFile,'utf8'));
assert.equal(receipt.locksHeld,true,'caller must hold both deployment locks');
assert.equal(receipt.protectedAdminApiWorkersVerified,true,'caller must verify protected admin/API/workers');
const observed=Date.parse(receipt.observedAt),age=Date.now()-observed;
assert(Number.isFinite(observed)&&age>=0&&age<=30_000,'receipt must be observed within last 30s');
for(const [key,file] of [['current',freshJs],['css',freshCss],['html',freshHtml],['source',source]]){
  assert.equal(sha(fs.readFileSync(file)),EXPECTED[key],`CAS baseline changed: ${key}`);
  assert.equal(receipt.sha256[key],EXPECTED[key],`fresh receipt SHA: ${key}`);
}
const manifest=JSON.parse(fs.readFileSync(path.join(candidateDir,'manifest.private.json'),'utf8'));
assert.deepEqual(manifest.baseline,EXPECTED);
for(const entry of Object.values(manifest.output))assert.equal(sha(fs.readFileSync(path.join(candidateDir,entry.file))),entry.sha256,`candidate integrity: ${entry.file}`);
console.log('CAS PASS (read-only). Apply immediately under the SAME locks; no permission to touch admin/API/workers or rebuild the page.');
