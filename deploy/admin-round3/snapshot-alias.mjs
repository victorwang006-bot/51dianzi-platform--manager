import path from 'node:path';
import assert from 'node:assert/strict';
export function snapshotAliases(source,admin) {
 assert.ok(path.isAbsolute(source)&&path.isAbsolute(admin));
 return [['@','client/src'],['@shared','shared'],['@assets','attached_assets']].map(([key,rel])=>({find:new RegExp('^'+key+'/'),replacement:'',customResolver(id,importer){const root=importer?.startsWith(admin+'/')?admin:source;return this.resolve(path.resolve(root,rel,id),importer,{skipSelf:true});}}));
}
