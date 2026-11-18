'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const ts = require(require.resolve('typescript', { paths: ['/home/ubuntu/diagnosis/fixrepo'] }));

const CANDIDATE_DIR = '/home/ubuntu/diagnosis/worker-repair-20261118/candidate';
const HEALTH_NAME = '__workerHealth20261118';
const WORKERS = Object.freeze([
  Object.freeze({ role: 'inventory-import', name: 'inventoryImportWorker.js', source: '/home/ubuntu/diagnosis/upload-queue-20261118/inventoryImportWorker.js', expected: 'd126bfa328a9a73b6f75c87308c4d5ef9ede9d87b6e53dfbae86a178723bb275' }),
  Object.freeze({ role: 'inventory-publish', name: 'inventoryPublishWorker.js', source: '/home/ubuntu/diagnosis/worker-repair-20261118/inventoryPublishWorker.js', expected: '3d62bde157308a67e1512aac14387e707c984d582258d8ce61e6842024121e6e' })
]);
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
function requireTrue(value, message) { if (!value) throw new Error(message); }
function parse(text) {
  const sf = ts.createSourceFile('offline-worker.js', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  requireTrue(sf.parseDiagnostics.length === 0, 'AST parse failed');
  return sf;
}
function findMain(sf) {
  const matches = sf.statements.filter(n => ts.isFunctionDeclaration(n) && n.name?.text === 'main');
  requireTrue(matches.length === 1 && matches[0].modifiers?.some(m => m.kind === ts.SyntaxKind.AsyncKeyword), 'exactly one native async main required');
  return matches[0];
}
function astShape(node, sf) {
  const children = [];
  ts.forEachChild(node, child => { children.push(astShape(child, sf)); });
  return children.length ? [node.kind, children] : [node.kind, node.getText(sf)];
}
function mainWithoutHealth(node, sf) {
  function walk(n) {
    if (ts.isExpressionStatement(n) && ts.isCallExpression(n.expression) && n.expression.expression.getText(sf) === HEALTH_NAME) return null;
    const children = [];
    ts.forEachChild(n, child => { const result = walk(child); if (result !== null) children.push(result); });
    return children.length ? [n.kind, children] : [n.kind, n.getText(sf)];
  }
  return walk(node);
}
function helper(role) {
  return `const ${HEALTH_NAME} = (() => {\n  let lastStatus;\n  let lastLogAt = 0;\n  return (businessReady) => {\n    const now = Date.now();\n    if (lastStatus !== businessReady || (!businessReady && now - lastLogAt >= 6e4)) {\n      console.info(JSON.stringify(businessReady\n        ? { worker: "${role}", businessReady: true }\n        : { worker: "${role}", businessReady: false, reason: "RELEASE_PERMIT_OR_READINESS_BLOCKED" }));\n      lastLogAt = now;\n    }\n    lastStatus = businessReady;\n  };\n})();\n`;
}
function assertBaseline(worker, bytes) {
  requireTrue(Buffer.isBuffer(bytes), 'baseline must be bytes');
  requireTrue(hash(bytes) === worker.expected, `baseline SHA mismatch for ${worker.role}; refuse rebase`);
  const text = bytes.toString('utf8');
  requireTrue(Buffer.from(text, 'utf8').equals(bytes), 'baseline UTF-8 must round-trip');
  return text;
}
function readBaseline(worker) {
  const stat = fs.lstatSync(worker.source);
  requireTrue(stat.isFile() && !stat.isSymbolicLink(), 'source must be a regular non-symlink file');
  return assertBaseline(worker, fs.readFileSync(worker.source));
}
function plan(worker, source) {
  assertBaseline(worker, Buffer.from(source));
  requireTrue(!source.includes(HEALTH_NAME), 'baseline already contains health marker');
  const sf = parse(source);
  const main = findMain(sf);
  const oldGuard = `      if (!await isEnterpriseWorkerBusinessPermitted("${worker.role}")) {\n        await sleep(IDLE_DELAY_MS);\n        continue;\n      }\n`;
  const guardAt = source.indexOf(oldGuard, main.getStart(sf));
  requireTrue(guardAt >= main.getStart(sf) && guardAt < main.end && source.indexOf(oldGuard, guardAt + 1) === -1, 'exact unique native main guard required');
  const guardPrefix = `      if (!await isEnterpriseWorkerBusinessPermitted("${worker.role}")) {\n`;
  let guard;
  function locate(n) {
    if (ts.isIfStatement(n) && n.getStart(sf) === guardAt + 6) guard = n;
    ts.forEachChild(n, locate);
  }
  locate(main);
  requireTrue(guard && ts.isBlock(guard.thenStatement) && guard.thenStatement.statements.length === 2 && !guard.elseStatement, 'guard structure drift');
  requireTrue(source.slice(guardAt + oldGuard.length, guardAt + oldGuard.length + 15) === '      let job;\n', 'post-guard business statement drift');
  const loop = guard.parent;
  requireTrue(ts.isBlock(loop) && ts.isWhileStatement(loop.parent) && loop.statements[0] === guard, 'guard must be first outer-loop statement');
  return [
    { at: main.getStart(sf), text: helper(worker.role), purpose: 'memory-only health helper before native main' },
    { at: guardAt + guardPrefix.length, text: `        ${HEALTH_NAME}(false);\n`, purpose: 'blocked health before original idle/continue' },
    { at: guardAt + oldGuard.length, text: `      ${HEALTH_NAME}(true);\n`, purpose: 'permitted transition before untouched business statements' }
  ];
}
function apply(source, edits) {
  let result = source;
  for (const edit of [...edits].reverse()) result = result.slice(0, edit.at) + edit.text + result.slice(edit.at);
  return result;
}
function inverse(candidate, edits) {
  let added = 0;
  const positioned = edits.map(edit => { const result = { ...edit, candidateAt: edit.at + added }; added += edit.text.length; return result; });
  let result = candidate;
  for (const edit of positioned.reverse()) {
    requireTrue(result.slice(edit.candidateAt, edit.candidateAt + edit.text.length) === edit.text, 'inverse insertion mismatch');
    result = result.slice(0, edit.candidateAt) + result.slice(edit.candidateAt + edit.text.length);
  }
  return result;
}
function permitText(text, sf) {
  const start = text.indexOf('var ENTERPRISE_WORKER_ROLES = [');
  const end = sf.statements.find(n => ts.isVariableStatement(n) && n.declarationList.declarations.some(d => ts.isIdentifier(d.name) && d.name.text === 'isEnterpriseWorkerBusinessPermitted'));
  requireTrue(start >= 0 && end, 'permit span not found');
  return text.slice(start, end.end);
}
function syntaxCheck(text) {
  const result = spawnSync(process.execPath, ['--input-type=module', '--check'], { input: text, encoding: 'utf8', timeout: 30000, maxBuffer: 1024 * 1024 });
  requireTrue(!result.error && result.status === 0, `node --check failed: ${result.error?.message || result.stderr}`);
}
function diffText(worker, source, candidate) {
  const result = spawnSync('diff', ['--unified=3', '--label', `baseline/${worker.name}`, '--label', `candidate/${worker.name}`, worker.source, '-'], { input: candidate, encoding: 'utf8', timeout: 30000, maxBuffer: 1024 * 1024 });
  requireTrue(!result.error && result.status === 1, 'offline unified diff failed');
  requireTrue(hash(fs.readFileSync(worker.source)) === hash(source), 'baseline changed during diff');
  return result.stdout;
}
function verify(worker, source, candidate, edits = plan(worker, source)) {
  requireTrue(candidate === apply(source, edits), 'candidate has unapproved modifications');
  const restored = inverse(candidate, edits);
  requireTrue(Buffer.from(restored).equals(Buffer.from(source)), 'inverse byte mismatch');
  const originalAst = parse(source), candidateAst = parse(candidate), restoredAst = parse(restored);
  const originalShape = JSON.stringify(astShape(originalAst, originalAst));
  requireTrue(JSON.stringify(astShape(restoredAst, restoredAst)) === originalShape, 'inverse AST mismatch');
  requireTrue(JSON.stringify(mainWithoutHealth(findMain(candidateAst), candidateAst)) === JSON.stringify(mainWithoutHealth(findMain(originalAst), originalAst)), 'existing main AST statement changed');
  const originalPermit = permitText(source, originalAst), candidatePermit = permitText(candidate, candidateAst);
  requireTrue(originalPermit === candidatePermit, 'permit implementation text changed');
  syntaxCheck(candidate);
  const patch = diffText(worker, source, candidate);
  const modifiedHunksCount = (patch.match(/^@@ /gm) || []).length;
  requireTrue(modifiedHunksCount === 1, 'expected one compact unified diff hunk per worker');
  return { patch, report: {
    worker: worker.role, source: worker.source, expectedBaselineSha256: worker.expected,
    baselineSha256: hash(source), candidateSha256: hash(candidate), candidate: path.join(CANDIDATE_DIR, worker.name),
    baselineBytes: Buffer.byteLength(source), candidateBytes: Buffer.byteLength(candidate),
    modifiedHunksCount, insertionRangesCount: edits.length, removedBytes: 0,
    edits: edits.map(edit => ({ baselineLine: source.slice(0, edit.at).split('\n').length, insertedBytes: Buffer.byteLength(edit.text), purpose: edit.purpose })),
    inverseByteIdentical: true, inverseSha256: hash(restored), inverseAstIdentical: true,
    inverseAstSha256: hash(originalShape), existingMainAstUnchanged: true,
    permitFunctionTextUnchanged: true, permitSpanSha256: hash(originalPermit),
    nodeCheck: 'passed (--input-type=module --check; stdin; no execution)'
  } };
}
function ensureCandidateDir() {
  fs.mkdirSync(CANDIDATE_DIR, { recursive: true, mode: 0o700 });
  requireTrue(fs.realpathSync(CANDIDATE_DIR) === CANDIDATE_DIR, 'candidate directory must not resolve through symlinks');
}
function writeCandidate(name, content) {
  requireTrue(path.basename(name) === name && !['.', '..'].includes(name), 'candidate basename required');
  ensureCandidateDir();
  const target = path.join(CANDIDATE_DIR, name);
  if (fs.existsSync(target)) {
    const stat = fs.lstatSync(target);
    requireTrue(stat.isFile() && !stat.isSymbolicLink() && fs.readFileSync(target).equals(Buffer.from(content)), `refuse overwrite of different artifact: ${name}`);
  } else {
    fs.writeFileSync(target, content, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  }
  return target;
}
function build() {
  // Preflight both pinned sources and all validations before any artifact write.
  const prepared = WORKERS.map(worker => { const source = readBaseline(worker); const edits = plan(worker, source); const candidate = apply(source, edits); return { worker, candidate, ...verify(worker, source, candidate, edits) }; });
  const report = { offlineOnly: true, sourceBaselinesReadOnly: true, guardSemanticsUnchanged: true, newTimers: 0, productionActions: 0, requiresSeparatelyAuthorizedRestartInstances: 2, totalModifiedHunksCount: prepared.reduce((n, item) => n + item.report.modifiedHunksCount, 0), workers: prepared.map(item => item.report) };
  for (const item of prepared) writeCandidate(item.worker.name, item.candidate);
  writeCandidate('health.patch', prepared.map(item => item.patch).join(''));
  writeCandidate('health-report.json', JSON.stringify(report, null, 2) + '\n');
  return report;
}
module.exports = { WORKERS, CANDIDATE_DIR, HEALTH_NAME, hash, parse, findMain, helper, assertBaseline, readBaseline, plan, apply, inverse, verify, syntaxCheck, writeCandidate, build };
if (require.main === module) {
  try { requireTrue(process.argv.length === 2, 'no arguments accepted; pinned baselines cannot be overridden'); console.log(JSON.stringify(build(), null, 2)); }
  catch (error) { console.error(`offline health build refused: ${error.message}`); process.exitCode = 1; }
}
