#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const esbuild=require('../sales/node_modules/esbuild');
const parser=require('../node_modules/@babel/parser');
const source=fs.readFileSync(path.join(__dirname,'sales_v2.tsx'),'utf8');
const result=esbuild.transformSync(source,{loader:'tsx',jsx:'transform',jsxFactory:'__sv2_h',jsxFragment:'__sv2_Fragment',target:'es2022',legalComments:'none',minify:false});
const code='/* global p,a,c,J,sr,or,ir,cr,cn,nt,be,cs,ea,tn */\n'+result.code;
for(const n of parser.parse(code,{sourceType:'module'}).program.body){if(n.type==='FunctionDeclaration')assert(n.id.name.startsWith('__sv2_'));if(n.type==='VariableDeclaration')for(const d of n.declarations)assert(d.id.name.startsWith('__sv2_'));}
fs.writeFileSync(path.join(__dirname,'sales_v2.runtime.js'),code);
console.log('销售v2组件编译完成');
