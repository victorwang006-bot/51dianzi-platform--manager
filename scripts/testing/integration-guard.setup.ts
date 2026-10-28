import dgram from "node:dgram";
import http from "node:http";
import https from "node:https";
import { syncBuiltinESMExports } from "node:module";
import net from "node:net";
import tls from "node:tls";
import { vi } from "vitest";

if (process.env.ALLOW_TEST_DB !== "1") {
  throw new Error("Integration guard requires explicit ALLOW_TEST_DB=1.");
}
const databaseUrl = new URL(process.env.TEST_DATABASE_URL ?? "");
const allowedHost = databaseUrl.hostname.replace(/^\[|\]$/g, "").toLowerCase();
const allowedPort = Number(databaseUrl.port || 3306);
const loopbackHosts = new Set(["127.0.0.1", "localhost", "::1"]);
if (
  databaseUrl.protocol !== "mysql:" ||
  !loopbackHosts.has(allowedHost) ||
  !/^[a-z0-9_]+_test$/i.test(decodeURIComponent(databaseUrl.pathname.slice(1)))
) {
  throw new Error(
    "Integration guard requires an isolated loopback MySQL *_test database."
  );
}

const denied = (operation: string) => () => {
  throw new Error(`Integration test network access denied: ${operation}`);
};
vi.mock("dotenv/config", () => ({}));
vi.mock("dotenv", () => ({
  config: () => ({ parsed: {} }),
  default: { config: () => ({ parsed: {} }) },
  parse: () => ({}),
}));

function assertDatabaseTarget(originalArgs: unknown[]) {
  const args = Array.isArray(originalArgs[0]) ? originalArgs[0] : originalArgs;
  const first = args[0];
  const options =
    typeof first === "object" && first !== null
      ? (first as { host?: string; port?: number | string; path?: string })
      : undefined;
  if (
    options?.path ||
    (typeof first !== "number" && options?.port === undefined)
  ) {
    throw new Error(
      "Integration network access denied: an explicit database TCP port is required."
    );
  }
  const port = Number(typeof first === "number" ? first : options?.port);
  const host = String(
    typeof args[1] === "string" ? args[1] : (options?.host ?? "localhost")
  )
    .replace(/^\[|\]$/g, "")
    .toLowerCase();
  if (port !== allowedPort || host !== allowedHost) {
    throw new Error(
      "Integration network access denied: only the approved loopback MySQL target is allowed."
    );
  }
}

const originalNetConnect = net.connect;
const originalSocketConnect = net.Socket.prototype.connect;
const originalTlsConnect = tls.connect;
net.connect = ((...args: unknown[]) => {
  assertDatabaseTarget(args);
  return originalNetConnect(...(args as Parameters<typeof net.connect>));
}) as typeof net.connect;
net.createConnection = net.connect;
net.Socket.prototype.connect = function (this: net.Socket, ...args: unknown[]) {
  assertDatabaseTarget(args);
  return originalSocketConnect.apply(
    this,
    args as Parameters<typeof net.Socket.prototype.connect>
  );
} as typeof net.Socket.prototype.connect;
tls.connect = ((...args: unknown[]) => {
  assertDatabaseTarget(args);
  return originalTlsConnect(...(args as Parameters<typeof tls.connect>));
}) as typeof tls.connect;
dgram.createSocket = denied("dgram.createSocket") as typeof dgram.createSocket;
http.request = denied("http.request") as typeof http.request;
http.get = denied("http.get") as typeof http.get;
https.request = denied("https.request") as typeof https.request;
https.get = denied("https.get") as typeof https.get;
syncBuiltinESMExports();
vi.stubGlobal("fetch", denied("fetch"));
vi.stubGlobal("WebSocket", denied("WebSocket"));
vi.stubGlobal("XMLHttpRequest", denied("XMLHttpRequest"));
