const RUNTIME_ENV_KEYS = [
  "PATH",
  "HOME",
  "TMPDIR",
  "TMP",
  "TEMP",
  "SystemRoot",
  "COMSPEC",
];

const UNIT_ENV_KEYS = new Set([
  ...RUNTIME_ENV_KEYS,
  "CI",
  "NODE_ENV",
  "NO_COLOR",
  "TZ",
  "VITEST",
  "VITEST_POOL_ID",
  "VITEST_WORKER_ID",
  "VITEST_MODE",
]);

function copyRuntimeEnvironment(source) {
  return Object.fromEntries(
    RUNTIME_ENV_KEYS.flatMap(key =>
      source[key] === undefined ? [] : [[key, source[key]]]
    )
  );
}

/**
 * Build the only environment that pure unit tests can inherit. In particular,
 * database, payment, OSS, OAuth, cloud, and dotenv configuration are omitted.
 */
export function createUnitTestEnvironment(source = process.env) {
  return {
    ...copyRuntimeEnvironment(source),
    CI: "true",
    NODE_ENV: "test",
    NO_COLOR: "1",
    TZ: "UTC",
  };
}

/**
 * Remove parent-process credentials again inside Vitest before a test module is
 * imported. This is defence in depth for callers that bypass the package script.
 */
export function sanitizeUnitProcessEnvironment(environment = process.env) {
  const safe = createUnitTestEnvironment(environment);
  for (const key of Object.keys(environment)) {
    if (!UNIT_ENV_KEYS.has(key)) {
      delete environment[key];
    }
  }
  Object.assign(environment, safe);
  return environment;
}

function normalizeLoopbackHost(hostname) {
  return hostname.toLowerCase().replace(/^\[|\]$/g, "");
}

/**
 * Validate an integration database URL without logging it. Only a local MySQL
 * database whose name ends in `_test` may be used by the integration runner.
 */
export function assertSafeIntegrationDatabaseUrl(value) {
  if (!value) {
    throw new Error(
      "Integration tests refused: TEST_DATABASE_URL is required; Vitest was not started."
    );
  }

  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(
      "Integration tests refused: TEST_DATABASE_URL must be a valid mysql:// loopback URL; Vitest was not started."
    );
  }

  const hostname = normalizeLoopbackHost(url.hostname);
  const databaseName = decodeURIComponent(url.pathname.replace(/^\//, ""));
  const isLoopback =
    hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
  const hasTestDatabaseName = /^[A-Za-z0-9_]+_test$/.test(databaseName);

  if (url.protocol !== "mysql:" || !isLoopback || !hasTestDatabaseName) {
    throw new Error(
      "Integration tests refused: TEST_DATABASE_URL must be mysql:// on localhost, 127.0.0.1, or ::1 and use a database ending in _test; Vitest was not started."
    );
  }

  return url;
}

/**
 * Build the complete child environment for an allowed integration invocation.
 * No general DATABASE_URL, payment, OSS, OAuth, cloud, or other parent secret
 * is forwarded.
 */
export function createIntegrationTestEnvironment(source = process.env) {
  if (source.ALLOW_TEST_DB !== "1") {
    throw new Error(
      "Integration tests refused: set ALLOW_TEST_DB=1 and TEST_DATABASE_URL; Vitest was not started."
    );
  }

  const url = assertSafeIntegrationDatabaseUrl(source.TEST_DATABASE_URL);
  return {
    ...copyRuntimeEnvironment(source),
    ALLOW_TEST_DB: "1",
    TEST_DATABASE_URL: url.toString(),
    CI: "true",
    NODE_ENV: "test",
    NO_COLOR: "1",
    TZ: "UTC",
  };
}
