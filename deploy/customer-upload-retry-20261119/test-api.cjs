#!/usr/bin/env node
'use strict';
const fs = require('node:fs'), vm = require('node:vm'), path = require('node:path'), assert = require('node:assert/strict');
const { build, parse, nodes, owner, sha } = require('./build-api.cjs');
function environment(text) {
  const start = text.lastIndexOf('\n// ', text.indexOf('customerUploadPrivateStorage.ts'));
  const end = text.indexOf('\nfunction checkedRoot(', start);
  assert(start >= 0 && end > start, 'exact parser module boundaries');
  const names = [...new Set(text.slice(start, end).match(/__cuh_[A-Za-z0-9_]+/g) || [])];
  const env = { Buffer, TextDecoder, console };
  for (const name of names) {
    if (name.endsWith('_createHash')) env[name] = require('node:crypto').createHash;
    else if (name.endsWith('_inflateRawSync')) env[name] = require('node:zlib').inflateRawSync;
    else if (name.endsWith('_XLSX')) env[name] = require('xlsx');
    else if (name.endsWith('_path')) env[name] = require('node:path');
    else throw Error('unreviewed parser dependency ' + name);
  }
  vm.createContext(env);
  vm.runInContext(text.slice(start, end), env, { timeout: 5000 });
  return env;
}
async function test({ baseline, candidate, original }) {
  const before = fs.readFileSync(baseline, 'utf8'), after = fs.readFileSync(candidate, 'utf8');
  const base = environment(before), runtime = environment(after);
  const file = { fileName: 'original.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', base64: fs.readFileSync(original).toString('base64') };
  assert.throws(() => base.inspectCustomerUploadFile(file), /ZIP/);
  const valid = runtime.inspectCustomerUploadFile(file);
  assert(valid.bytes.equals(Buffer.from(file.base64, 'base64')), 'original bytes preserved');
  assert.equal(valid.sha256, sha(Buffer.from(file.base64, 'base64')));
  const encrypted = Buffer.from(file.base64, 'base64');
  // Both headers carry the encryption bit. The candidate must still reject it.
  for (let i = 0; i + 46 < encrypted.length; i++) {
    const sig = encrypted.readUInt32LE(i);
    if (sig === 0x04034b50) encrypted.writeUInt16LE(encrypted.readUInt16LE(i + 6) | 1, i + 6);
    if (sig === 0x02014b50) encrypted.writeUInt16LE(encrypted.readUInt16LE(i + 8) | 1, i + 8);
  }
  assert.throws(() => runtime.inspectCustomerUploadFile({ ...file, base64: encrypted.toString('base64') }), /ZIP/);
  const ast = parse('candidate.js', after), append = owner(owner(ast, 'createCustomerUploadHistoryService'), 'appendFile');
  let stores = 0;
  for (const name of [...new Set(append.getText(ast).match(/__cuh_[A-Za-z0-9_]+/g) || [])]) {
    if (name.endsWith('_randomUUID2')) runtime[name] = require('node:crypto').randomUUID;
    else if (name.endsWith('_sql2')) runtime[name] = () => { throw Error('SQL write forbidden'); };
    else throw Error('unreviewed append dependency ' + name);
  }
  Object.assign(runtime, {
    CUSTOMER_UPLOAD_FILE_BYTES_MAX: 10 * 1024 * 1024,
    fail: (code, message) => { const e = new Error(message); e.code = code; throw e; },
    deps: { storage: { put: () => { stores++; throw Error('storage writes forbidden in test'); } } },
    hash2: sha,
  });
  vm.runInContext(append.getText(ast), runtime, { timeout: 5000 });
  const invalid = { ...file, base64: Buffer.from('not a workbook').toString('base64') };
  await assert.rejects(runtime.appendFile({}, {}, 'original', invalid), e => e.code === 'BAD_REQUEST' && /^原文件未保存：/.test(e.message));
  assert.equal(stores, 0, 'deterministic original rejection before storage');
  await assert.rejects(runtime.appendFile({}, {}, 'normalized', invalid), e => e.code === 'BAD_REQUEST' && !e.message.startsWith('原文件未保存：'));
  assert.equal(stores, 0);
  console.log(JSON.stringify({ status: 'passed', actualNativeArtifact: true, checks: 7, noSql: true, noStorageWrites: true, originalAcceptedWithoutRepack: true, originalBytesUnchanged: true, encryptionRejected: true, definiteOriginalRefusalBeforeStorage: true, normalizedFailureNotOriginalRefusal: true }));
}
module.exports = { test, environment };
if (require.main === module) {
  const args = {}; for (let i = 2; i < process.argv.length; i += 2) args[process.argv[i].slice(2)] = path.resolve(process.argv[i + 1]);
  test(args).catch(e => { console.error(e.message); process.exitCode = 1; });
}
