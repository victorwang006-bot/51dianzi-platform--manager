import { describe, expect, it } from "vitest";
import {
  getBusinessNavigationDisplayState,
  getBusinessNavigationQueryKey,
  shouldRetryBusinessNavigation,
} from "./businessNavigationQuery";

const enabled = true;
const successfulCapabilities = ["inventory.read", "customers.manage"];

function navigationState(overrides: Partial<Parameters<typeof getBusinessNavigationDisplayState>[0]>) {
  return getBusinessNavigationDisplayState({
    enabled,
    isPending: false,
    isSuccess: false,
    isError: false,
    data: undefined,
    ...overrides,
  });
}

describe("业务导航显示状态", () => {
  it("初始加载时不暴露业务入口", () => {
    expect(navigationState({ isPending: true })).toEqual({
      status: "loading",
      workbenchCapabilities: [],
    });
  });

  it("最终错误时忽略 React Query 留存的旧成功能力", () => {
    expect(navigationState({
      isSuccess: false,
      isError: true,
      data: { workbenchCapabilities: successfulCapabilities },
    })).toEqual({
      status: "error",
      workbenchCapabilities: [],
    });
  });

  it("只有成功的空能力才表示确实没有业务入口", () => {
    expect(navigationState({
      isSuccess: true,
      data: { workbenchCapabilities: [] },
    })).toEqual({
      status: "empty",
      workbenchCapabilities: [],
    });
  });

  it("成功的非空能力才暴露对应业务入口", () => {
    expect(navigationState({
      isSuccess: true,
      data: { workbenchCapabilities: successfulCapabilities },
    })).toEqual({
      status: "ready",
      workbenchCapabilities: successfulCapabilities,
    });
  });
});

describe("业务导航重试策略", () => {
  it("网络、超时和 SERVICE_UNAVAILABLE 最多额外重试两次", () => {
    const serviceUnavailable = { data: { code: "SERVICE_UNAVAILABLE" } };
    const timeout = { data: { code: "TIMEOUT" } };

    for (const error of [new TypeError("Failed to fetch"), timeout, serviceUnavailable]) {
      expect(shouldRetryBusinessNavigation(0, error)).toBe(true);
      expect(shouldRetryBusinessNavigation(1, error)).toBe(true);
      expect(shouldRetryBusinessNavigation(2, error)).toBe(false);
    }
  });

  it("明确的登录、权限和业务域拒绝绝不重试", () => {
    for (const code of ["UNAUTHORIZED", "FORBIDDEN", "PRECONDITION_FAILED", "TOO_MANY_REQUESTS"]) {
      expect(shouldRetryBusinessNavigation(0, { data: { code } })).toBe(false);
    }
  });
});

describe("业务导航账号缓存键", () => {
  it("使用不同账号键，并在切换后的未知状态不复用旧能力", () => {
    const firstAccountKey = getBusinessNavigationQueryKey("admin-1");
    const secondAccountKey = getBusinessNavigationQueryKey("admin-2");

    expect(firstAccountKey).not.toEqual(secondAccountKey);
    expect(getBusinessNavigationQueryKey(null)).toEqual([
      "business",
      "navigation",
      "signed-out",
    ]);

    const secondAccountBeforeItsOwnSuccess = navigationState({
      isPending: true,
      // This mimics a retained result in a component during an account change.
      // The display model must still be closed until the new key succeeds.
      data: { workbenchCapabilities: successfulCapabilities },
    });
    expect(secondAccountBeforeItsOwnSuccess).toEqual({
      status: "loading",
      workbenchCapabilities: [],
    });
  });
});
