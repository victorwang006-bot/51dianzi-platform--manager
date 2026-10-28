import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { BEFORE, AFTER, VERIFIED_BASE_SHA256, patchCnReviewEstablishedDate, sha256 } from './patch-cn-review-established-date.mjs';

const fixture = `const versionDigest = 'CAST(company.establishedAt AS CHAR)';\nasync function cnReviewReadPlatformCompany(executor, merchant, forUpdate = false) {\n  return executor.execute(\`${BEFORE}\`);\n}\nfunction cnReviewEffectiveCandidate(row) { return row; }\n`;

test('changes only the date projection inside the read function', () => {
  const result = patchCnReviewEstablishedDate(fixture);
  assert.equal(result, fixture.replace(BEFORE, AFTER));
  assert.ok(result.includes("const versionDigest = 'CAST(company.establishedAt AS CHAR)'"));
});
test('refuses missing read function', () => assert.throws(() => patchCnReviewEstablishedDate('const x = 1;')));
test('refuses duplicate read functions', () => assert.throws(() => patchCnReviewEstablishedDate(fixture + fixture)));
test('refuses duplicate date projection within the function', () => assert.throws(() => patchCnReviewEstablishedDate(fixture.replace(BEFORE, BEFORE + BEFORE))));
test('refuses already patched artifacts', () => assert.throws(() => patchCnReviewEstablishedDate(patchCnReviewEstablishedDate(fixture))));
test('does not replace matching text outside the target function', () => {
  const source = `// ${BEFORE}\n` + fixture;
  const result = patchCnReviewEstablishedDate(source);
  assert.equal(result.split(BEFORE).length, 2);
  assert.ok(result.startsWith(`// ${BEFORE}\n`));
});

if (process.env.CN_REVIEW_ARTIFACT) {
  const source = readFileSync(process.env.CN_REVIEW_ARTIFACT, 'utf8');
  test('verified production artifact differs only by the one SQL projection', () => {
    assert.equal(sha256(source), VERIFIED_BASE_SHA256);
    assert.equal(patchCnReviewEstablishedDate(source), source.replace(BEFORE, AFTER));
  });
  const begin = source.indexOf('var CN_REVIEW_DRAFT_KEYS =');
  const end = source.indexOf('function cnReviewDecodeDraft');
  const context = vm.createContext({});
  vm.runInContext(source.slice(begin, end), context);
  test('keeps strict YYYY-MM-DD date validation', () => {
    assert.equal(context.cnReviewDate('2026-10-28'), '2026-10-28');
    assert.throws(() => context.cnReviewDate('2026-10-28T00:00:00.000Z'), /CN_REVIEW_CANDIDATE_INVALID/);
    assert.throws(() => context.cnReviewDate(new Date('2026-10-28T00:00:00.000Z')), /CN_REVIEW_CANDIDATE_INVALID/);
  });
  test('keeps NULL/empty date semantics', () => {
    assert.equal(context.cnReviewDate(null), null);
    assert.equal(context.cnReviewDate(''), null);
  });
  test('reproduces mysql2 Date rejection and accepts SQL date-only output', () => {
    const candidate = {companyName:'测试企业',creditCode:'91440300MA12345678',companyType:'有限责任公司',legalPerson:'测试人',bankAccountName:'测试企业',bankAccountNumber:'1234567890123456',bankName:'测试银行',regAddress:'测试地址',establishedAt:new Date('2026-10-28T00:00:00.000Z')};
    assert.throws(() => context.cnReviewCandidateFromSource(candidate, false), /CN_REVIEW_CANDIDATE_INVALID/);
    assert.equal(context.cnReviewCandidateFromSource({...candidate,establishedAt:'2026-10-28'}, false).establishedAt, '2026-10-28');
  });
}
