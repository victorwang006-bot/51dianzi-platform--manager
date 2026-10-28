import { describe, expect, it } from "vitest";
import {
  assertSafeIntegrationDatabaseUrl,
  createIntegrationTestEnvironment,
  createUnitTestEnvironment,
} from "./test-isolation.mjs";
import { createNetworkBlockedError } from "./unit-network-guard.mjs";

describe("test runner isolation", () => {
  it("only accepts an explicit local mysql test database URL", () => {
    expect(() => assertSafeIntegrationDatabaseUrl("")).toThrow(
      "TEST_DATABASE_URL is required"
    );
    expect(() =>
      assertSafeIntegrationDatabaseUrl(
        "mysql://tester:pw@db.example.com/orders_test"
      )
    ).toThrow("localhost, 127.0.0.1, or ::1");
    expect(() =>
      assertSafeIntegrationDatabaseUrl(
        "postgres://tester:pw@127.0.0.1/orders_test"
      )
    ).toThrow("mysql://");
    expect(() =>
      assertSafeIntegrationDatabaseUrl("mysql://tester:pw@127.0.0.1/orders")
    ).toThrow("ending in _test");
    expect(
      assertSafeIntegrationDatabaseUrl(
        "mysql://tester:pw@127.0.0.1:3306/orders_test"
      ).hostname
    ).toBe("127.0.0.1");
  });

  it("refuses integration execution until the explicit database opt-in is set", () => {
    expect(() =>
      createIntegrationTestEnvironment({
        TEST_DATABASE_URL: "mysql://tester:pw@127.0.0.1/orders_test",
      })
    ).toThrow("ALLOW_TEST_DB=1");
  });

  it("does not forward database, payment, OSS, or dotenv secrets to test processes", () => {
    const parentEnvironment = {
      PATH: "/safe/bin",
      HOME: "/safe/home",
      DATABASE_URL: "mysql://prod.example.com/prod",
      STRIPE_SECRET_KEY: "payment-secret",
      ALI_OSS_ACCESS_KEY_SECRET: "oss-secret",
      DOTENV_CONFIG_PATH: "/production/.env",
      TEST_DATABASE_URL: "mysql://tester:pw@127.0.0.1/orders_test",
      ALLOW_TEST_DB: "1",
    };

    const unitEnvironment = createUnitTestEnvironment(parentEnvironment);
    const integrationEnvironment =
      createIntegrationTestEnvironment(parentEnvironment);

    for (const environment of [unitEnvironment, integrationEnvironment]) {
      expect(environment).not.toHaveProperty("DATABASE_URL");
      expect(environment).not.toHaveProperty("STRIPE_SECRET_KEY");
      expect(environment).not.toHaveProperty("ALI_OSS_ACCESS_KEY_SECRET");
      expect(environment).not.toHaveProperty("DOTENV_CONFIG_PATH");
    }
    expect(unitEnvironment.NODE_ENV).toBe("test");
    expect(integrationEnvironment.TEST_DATABASE_URL).toContain("orders_test");
  });

  it("reports blocked network APIs as a unit-test safety failure", () => {
    expect(createNetworkBlockedError("fetch").message).toContain(
      "Unit test network access blocked: fetch"
    );
  });
});
