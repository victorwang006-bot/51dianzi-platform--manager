import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const BEFORE = 'company.establishedAt, company.salesOwner, company.salesOwnerCode,';
export const AFTER = "DATE_FORMAT(company.establishedAt, '%Y-%m-%d') AS establishedAt, company.salesOwner, company.salesOwnerCode,";
export const VERIFIED_BASE_SHA256 = '1b9a8b55daf817b5040b03ecc635b2a6957988d2540daaad834444ea1763730d';
export const sha256 = value => createHash('sha256').update(value).digest('hex');

export function patchCnReviewEstablishedDate(source) {
  const start = source.indexOf('async function cnReviewReadPlatformCompany(');
  const end = source.indexOf('\nfunction cnReviewEffectiveCandidate(', start);
  if (start < 0 || end < 0 || source.indexOf('async function cnReviewReadPlatformCompany(', start + 1) !== -1) {
    throw new Error('Expected exactly one verified CN review read function');
  }
  const block = source.slice(start, end);
  if (block.includes(AFTER) || block.split(BEFORE).length !== 2) {
    throw new Error('Unexpected or already-patched date projection; refuse mutation');
  }
  return source.slice(0, start) + block.replace(BEFORE, AFTER) + source.slice(end);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [input, output] = process.argv.slice(2);
  if (!input || !output || resolve(input) === resolve(output) || existsSync(output)) {
    throw new Error('Usage: node patch-cn-review-established-date.mjs <verified-input.js> <new-output.js>');
  }
  const source = readFileSync(input, 'utf8');
  if (sha256(source) !== VERIFIED_BASE_SHA256) throw new Error('Production base changed; re-inspect instead of overwriting');
  const patched = patchCnReviewEstablishedDate(source);
  writeFileSync(output, patched, {flag: 'wx', mode: 0o644});
  console.log(JSON.stringify({beforeSha256: sha256(source), afterSha256: sha256(patched), changedProjection: 1}));
}
