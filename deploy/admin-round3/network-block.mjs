/** Offline preload for actual tsc/Vite/Vitest/esbuild child processes; no application ENV. */
import net from 'node:net';
import tls from 'node:tls';
import http from 'node:http';
import https from 'node:https';
import dgram from 'node:dgram';
import { syncBuiltinESMExports } from 'node:module';
const deny=()=>{throw Error('OFFLINE SAFETY: external network/DB connection forbidden');};
for(const [obj,names] of [[net,['connect','createConnection']],[tls,['connect']],[http,['request','get']],[https,['request','get']],[dgram,['createSocket']]])for(const name of names)obj[name]=deny;
net.Socket.prototype.connect=deny;globalThis.fetch=deny;syncBuiltinESMExports();
