import assert from 'node:assert/strict';
import test from 'node:test';
import { snapshotAliases } from './snapshot-alias.mjs';

const source = '/synthetic/front';
const admin = '/synthetic/admin';
for (const [prefix, directory] of [['@', 'client/src'], ['@client', 'client/src'], ['@shared', 'shared'], ['@assets', 'attached_assets']]) {
  for (const [importer, root] of [[source + '/server/example.ts', source], [admin + '/client/example.ts', admin]]) {
    test(`${prefix} resolves within the actual importer snapshot ${root}`, async () => {
      const aliases = snapshotAliases(source, admin);
      const alias = aliases.find(entry => entry.find.test(prefix + '/lib/example.ts'));
      assert.ok(alias);
      const remainder = (prefix + '/lib/example.ts').replace(alias.find, alias.replacement);
      let observed;
      const result = await alias.customResolver.call({
        resolve: async (id, owner, options) => { observed = { id, owner, options }; return { id }; },
      }, remainder, importer);
      assert.equal(result.id, root + '/' + directory + '/lib/example.ts');
      assert.equal(observed.owner, importer);
      assert.deepEqual(observed.options, { skipSelf: true });
    });
  }
}
