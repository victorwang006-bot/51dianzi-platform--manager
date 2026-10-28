import dgram from "node:dgram";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import tls from "node:tls";

const NETWORK_GUARD = Symbol.for("51dianzi.unit-network-guard-installed");

export function createNetworkBlockedError(api) {
  return new Error(
    `Unit test network access blocked: ${api}. Use an explicit mock or a separately gated integration test.`
  );
}

function blocked(api) {
  return () => {
    throw createNetworkBlockedError(api);
  };
}

function replace(object, name, api) {
  Object.defineProperty(object, name, {
    configurable: true,
    enumerable: true,
    writable: true,
    value: blocked(api),
  });
}

/**
 * Stop pure unit tests from opening TCP/UDP/HTTP/TLS connections or using the
 * global fetch APIs. This runs before allowlisted test modules are imported.
 */
export function installUnitNetworkGuard() {
  if (globalThis[NETWORK_GUARD]) {
    return;
  }
  globalThis[NETWORK_GUARD] = true;

  replace(net, "connect", "net.connect");
  replace(net, "createConnection", "net.createConnection");
  replace(net, "createServer", "net.createServer");
  replace(tls, "connect", "tls.connect");
  replace(tls, "createServer", "tls.createServer");
  replace(dgram, "createSocket", "dgram.createSocket");
  replace(http, "request", "http.request");
  replace(http, "get", "http.get");
  replace(http, "createServer", "http.createServer");
  replace(https, "request", "https.request");
  replace(https, "get", "https.get");
  replace(https, "createServer", "https.createServer");

  globalThis.fetch = async () => {
    throw createNetworkBlockedError("fetch");
  };
  globalThis.WebSocket = class {
    constructor() {
      throw createNetworkBlockedError("WebSocket");
    }
  };
  globalThis.XMLHttpRequest = class {
    constructor() {
      throw createNetworkBlockedError("XMLHttpRequest");
    }
  };
}
