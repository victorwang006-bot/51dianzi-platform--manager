import vm from 'node:vm';
import assert from 'node:assert/strict';
import React from 'react';
import * as jsx from 'react/jsx-runtime';
import { renderToStaticMarkup } from 'react-dom/server';

/** No network, login or production state. The compiled bundle must use these exact instances. */
export async function smokeFactory(factoryExpression) {
  const calls = { scope: 0, useLocation: 0, useSearch: 0, useUtils: 0, queries: [], mutations: [] };
  let nativeRead = true, nativeWrite = true;
  const scope = {
    officialInventoryPermissions: { read: true, write: true, note: true, authorizationVersion: 'native-v1' },
    storageScope: 'scope-31', frontUser: { role: 'user' },
    contextVerification: { state: 'verified', identity: 'scope-31', authorizationVersion: 'auth-v1', readVersion: 'read-v1' },
    onAuthorizationError() {},
  };
  const row = { id: 1, revision: 4, channelId: 11, partNumber: 'CI-SINGLETON-SMOKE', brand: 'TI', qty: 9, dateCode: null, price: null, taxIncluded: null, leadTime: null, industryCode: null, updatedAt: '2026-11-04T00:00:00Z', canDelete: true, canEdit: true, readOnly: false, canViewSource: false, isMine: true, noteCount: 0, originalRecorderName: '原负责人' };
  const query = data => ({ data, isLoading: false, isFetching: false, isError: false, refetch: async () => ({ data }) });
  const channel = { id: 11, name: '离线测试渠道', enterpriseId: 31, active: true, canEdit: true, readOnly: false, type: 'factory', revision: 1 };
  const page = items => ({ items, total: items.length, page: 1, pageSize: 20, pageCount: 1, canWrite: true, canFilterSource: false });
  const client = new Proxy({}, { get: (_, procedure) => ({ query: async () => page([]), mutate: async () => { throw new Error(`Unexpected mutation in SSR: ${String(procedure)}`); } }) });
  const utils = { client: { channelInventory: client }, channelInventory: new Proxy({}, { get: () => ({ invalidate: async () => undefined }) }) };
  const trpc = {
    useUtils() { calls.useUtils++; return utils; },
    enterprise: { me: { useQuery(input) { calls.queries.push('enterprise.me'); return query({ enterprise: { id: 31 }, currentUserId: 7, permissionKeys: ['inventory.manage'], isOwner: true }); } } },
    channelInventory: new Proxy({}, { get: (_, procedure) => ({
      useQuery(input, options) {
        calls.queries.push({ procedure, input, enabled: options?.enabled });
        return query(procedure === 'listChannels' ? page([channel]) : procedure === 'listTeamMaterials' ? page([row]) : page([]));
      },
      useMutation() { calls.mutations.push(String(procedure)); return { mutateAsync: async () => { throw new Error('Unexpected mutation in SSR'); }, isPending: false }; },
    }) }),
  };
  const dropdown = Object.fromEntries(['DropdownMenu','DropdownMenuTrigger','DropdownMenuContent','DropdownMenuItem','DropdownMenuSeparator'].map(name => [name, ({ children }) => React.createElement('div', { 'data-smoke-dropdown': name }, children)]));
  const originalUI = Object.fromEntries(['Dialog','DialogContent','DialogDescription','DialogFooter','DialogHeader','DialogTitle','Button'].map(name => [name, ({ children }) => React.createElement('div', { 'data-smoke-ui': name }, children)]));
  const live = {
    React, jsx, trpc, dropdown, originalUI,
    useBusinessScope() { calls.scope++; scope.officialInventoryPermissions.read = nativeRead; scope.officialInventoryPermissions.write = nativeWrite; return scope; },
    useLocation() { calls.useLocation++; return ['/channel-inventory', () => { throw new Error('Unexpected navigation in SSR'); }]; },
    useSearch() { calls.useSearch++; return ''; },
  };
  const context = vm.createContext({ console, AbortController, URL, URLSearchParams, TextEncoder, TextDecoder, setTimeout, clearTimeout,
    fetch() { throw new Error('Network forbidden in offline smoke'); },
  });
  const factory = new vm.Script(factoryExpression, { filename: 'ci-management-factory-smoke.js' }).runInContext(context, { timeout: 10000 });
  const compiled = factory(live);
  assert.equal(typeof compiled.default, 'function');
  const authorizedHtml = renderToStaticMarkup(React.createElement(compiled.default));
  assert.ok(authorizedHtml.includes('CI-SINGLETON-SMOKE'), 'compiled host did not render scoped fixture');
  for (const title of ['渠道库存', '渠道档案', '上传批次', '回收站']) assert.ok(authorizedHtml.includes(title), `missing management tab ${title}`);
  assert.ok(authorizedHtml.includes('全选当前页可删除库存'), 'authorized deletion checkbox missing');
  const stockQuery = calls.queries.find(item => item.procedure === 'listTeamMaterials');
  assert.equal(stockQuery.input.expectedEnterpriseId, 31);
  assert.equal(stockQuery.input.expectedActorUserId, 7);
  nativeWrite = false;
  const readonlyHtml = renderToStaticMarkup(React.createElement(compiled.default));
  assert.ok(!readonlyHtml.includes('全选当前页可删除库存'), 'write UI visible without native write grant');
  nativeRead = false;
  const deniedHtml = renderToStaticMarkup(React.createElement(compiled.default));
  assert.ok(deniedHtml.includes('没有渠道库存查看权限'), 'native read denial not preserved');
  assert.ok(!deniedHtml.includes('CI-SINGLETON-SMOKE'), 'denied render leaked inventory fixture');
  for (const hook of ['scope', 'useLocation', 'useSearch', 'useUtils']) assert.equal(calls[hook], 3, `${hook} did not use live singleton`);
  return { passed: true, kind: 'offline-vm-real-react-SSR', networkAccess: false, cases: ['authorized inventory + four tabs', 'native write denied', 'native read denied'], singletonHookCalls: { scope: calls.scope, useLocation: calls.useLocation, useSearch: calls.useSearch, useUtils: calls.useUtils }, scopedIdentity: { enterpriseId: 31, actorUserId: 7 }, notes: 'Original live aliases are separately asserted by AST. This smoke verifies compiled bridge dispatch and identity, not authenticated browser integration.' };
}
