'use strict';
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const esbuild = require('esbuild');
const assert = require('node:assert/strict');
const C = require('./sales-unified-patch-core-20261113.cjs');
const REPO = path.resolve(__dirname, '..');
function property(object, key) {
  return object.properties.find(p => ts.isPropertyAssignment(p) && p.name.text === key);
}
function jsx(root, ast, cls) {
  return C.one(root, n => ts.isCallExpression(n) && n.arguments[1] && ts.isObjectLiteralExpression(n.arguments[1]) && property(n.arguments[1], 'className')?.initializer.getText(ast).includes(cls), cls);
}
function rename(node, ast, mapping) {
  const transformed = ts.transform(node, [context => root => ts.visitNode(root, function visit(n) {
    if (ts.isIdentifier(n) && !(ts.isPropertyAccessExpression(n.parent) && n.parent.name === n) && !(ts.isPropertyAssignment(n.parent) && n.parent.name === n)) {
      const value = mapping[n.text];
      if (value !== undefined) {
        if (typeof value === 'number') return ts.factory.createNumericLiteral(value);
        const parts = String(value).split('.');
        let result = ts.factory.createIdentifier(parts.shift());
        for (const part of parts) result = ts.factory.createPropertyAccessExpression(result, part);
        return result;
      }
    }
    return ts.visitEachChild(n, visit, context);
  })]);
  const result = ts.createPrinter().printNode(ts.EmitHint.Unspecified, transformed.transformed[0], ast);
  transformed.dispose();
  return result;
}
async function patchMall(before, originalBusiness, mapping) {
  const ast = C.parse(before), old = C.one(ast, n => ts.isFunctionDeclaration(n) && n.name?.text === 'uI' && n.parent === ast, 'current native mall');
  const sourcePath = REPO + '/client/src/business/platform/client/src/pages/OutboundManagement.tsx';
  const source = fs.readFileSync(sourcePath, 'utf8');
  const sa = C.parse((await esbuild.transform(source, {loader:'tsx', jsx:'automatic', target:'es2020'})).code);
  const src = C.one(sa, n => ts.isFunctionDeclaration(n) && n.name?.text === 'OutboundManagement', 'source mall');
  const ba = C.parse(originalBusiness);
  const filterButton = C.one(ba, n => ts.isCallExpression(n) && n.arguments[1] && ts.isObjectLiteralExpression(n.arguments[1]) && property(n.arguments[1], 'children') && ts.isArrayLiteralExpression(property(n.arguments[1], 'children').initializer) && property(n.arguments[1], 'children').initializer.elements.some(e => ts.isStringLiteral(e) && e.text === '筛选'), 'original business filter button');
  const icon = C.one(property(filterButton.arguments[1], 'children').initializer, n => ts.isCallExpression(n) && n.arguments[1] && ts.isObjectLiteralExpression(n.arguments[1]) && ts.isIdentifier(n.arguments[0]), 'original business search glyph');
  const map = {...mapping, Search:icon.arguments[0].getText(ba), jsx:'e.jsx', jsxs:'e.jsxs'};
  const oldPanel = jsx(old, ast, 'sales-order-table-card'), oldToolbar = jsx(old, ast, 'sales-order-list-toolbar'), oldFooter = jsx(old, ast, 'sales-order-pagination');
  const page = jsx(old, ast, 'erp-ui sales-order-page');
  const srcFilter = jsx(src, sa, 'sales-order-filter-card'), srcToolbar = jsx(src, sa, 'sales-order-list-toolbar'), srcFooter = jsx(src, sa, 'sales-order-pagination');
  const panelChildren = property(oldPanel.arguments[1], 'children').initializer;
  const pageChildren = property(page.arguments[1], 'children').initializer;
  assert(ts.isArrayLiteralExpression(panelChildren) && ts.isArrayLiteralExpression(pageChildren));
  assert.equal(panelChildren.elements[0], oldToolbar);
  assert.equal(panelChildren.elements[2], oldFooter);
  const oldTable = panelChildren.elements[1];
  const oldBadge = C.one(oldTable, n => ts.isCallExpression(n) && n.arguments[1] && ts.isObjectLiteralExpression(n.arguments[1]) && property(n.arguments[1], 'className')?.initializer.getText(ast).includes('crm-badge whitespace-nowrap'), 'old table status badge');
  const classExpr = property(oldBadge.arguments[1], 'className').initializer;
  const badgeLookup = C.one(classExpr, n => ts.isElementAccessExpression(n), 'old status color lookup');
  const orderVar = badgeLookup.argumentExpression.expression.getText(ast);
  const labelVar = property(oldBadge.arguments[1], 'children').initializer.getText(ast);
  const srcStatus = jsx(src, sa, 'sales-order-status whitespace-nowrap');
  const newStatus = rename(srcStatus, sa, {...map, order:orderVar, statusLabel:labelVar, STATUS_BADGE:badgeLookup.expression.getText(ast)});
  const oldTrigger = jsx(oldTable, ast, 'inbound-row-menu');
  assert.equal(property(oldTrigger.arguments[1], 'children').initializer.text, '…');
  const localEdits = [
    {node:oldBadge, after:newStatus},
    {node:property(oldTrigger.arguments[1], 'className').initializer, after:JSON.stringify('inbound-row-menu admin-row-action')},
    {node:property(oldTrigger.arguments[1], 'children').initializer, after:JSON.stringify('更多')},
  ];
  let tableText = oldTable.getText(ast);
  for (const edit of localEdits.sort((a,b)=>b.node.getStart(ast)-a.node.getStart(ast))) {
    const start=edit.node.getStart(ast)-oldTable.getStart(ast), end=edit.node.end-oldTable.getStart(ast);
    tableText=tableText.slice(0,start)+edit.after+tableText.slice(end);
  }
  const newPanelChildren = '['+rename(srcToolbar,sa,map)+','+tableText+','+rename(srcFooter,sa,map)+']';
  const panelText = oldPanel.getText(ast);
  const start = panelChildren.getStart(ast)-oldPanel.getStart(ast), end=panelChildren.end-oldPanel.getStart(ast);
  const newPanel = panelText.slice(0,start)+newPanelChildren+panelText.slice(end);
  const newPageChildren = '['+pageChildren.elements.map(n=>n===oldPanel ? rename(srcFilter,sa,map)+','+newPanel : n.getText(ast)).join(',')+']';
  const edits = [{start:pageChildren.getStart(ast),end:pageChildren.end,before:pageChildren.getText(ast),after:newPageChildren,reason:'source-bound mall filter/table visual status/actions/footer only; dialogs unchanged'}];
  const sourceBase = require('node:child_process').execFileSync('git',['show','a3fa1a4:'+path.relative(REPO,sourcePath)],{cwd:REPO,encoding:'utf8'});
  const beforeBody = sourceBase.slice(sourceBase.indexOf('const PAGE_SIZE'),sourceBase.indexOf('\n  return (\n    <PlatformLayout>'));
  const afterBody = source.slice(source.indexOf('const PAGE_SIZE'),source.indexOf('\n  return (\n    <PlatformLayout>'));
  assert.equal(beforeBody,afterBody,'mall state/handlers/export/query source changed');
  assert.equal(sourceBase.slice(sourceBase.indexOf('        {openMenu &&')),source.slice(source.indexOf('        {openMenu &&')),'mall dialogs/menu source changed');
  return {edits,proof:{sourceSha256:C.sha(source),sourceBodyAndHandlersUnchanged:true,sourceDialogsAndMenusUnchanged:true,nativeExportHelperUnchanged:true,originalTriggerOnClick:property(oldTrigger.arguments[1],'onClick').initializer.getText(ast),statusOrderVariable:orderVar,searchGlyph:map.Search}};
}
module.exports={patchMall,property,jsx,rename};
