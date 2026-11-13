// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BusinessScopeProvider, businessStorageScope, type ReadyBusinessStaffPrincipal } from "./BusinessScope";
import { pageMemoryScope } from "./platform/client/src/lib/pageMemory";
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const principal = (enterpriseId = 9, bindingVersion = 1) => ({ status: "ready", frontendUserId: 7, adminAccountId: 8, enterpriseId, bindingVersion, user: { id: 7 } }) as ReadyBusinessStaffPrincipal;
const expected = (enterpriseId = 9, bindingVersion = 1) => `business-domain:v1:staff:7:admin:8:enterprise:${enterpriseId}:merchant:30061:binding:${bindingVersion}`;
const provider = (key: string, enterpriseId = 9, storageOwner = true, bindingVersion = 1) => React.createElement(BusinessScopeProvider, { key, merchantId: 30061, staffPrincipal: principal(enterpriseId, bindingVersion), contextVerificationState: "verified", storageOwner, children: React.createElement("div", { "data-consumer": key }, key) });
let root: Root, host: HTMLDivElement;
const render = (children: React.ReactNode) => act(() => root.render(React.createElement(React.Fragment, null, children)));
beforeEach(() => { host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); });
describe("reception page memory/storage identity lifetime", () => {
  it("keeps same identity when either one of two real providers leaves and clears only the final one", () => {
    render([provider("page"), provider("second")]);
    expect(businessStorageScope()).toBe(expected()); expect(pageMemoryScope()).toBe(expected());
    render([provider("page")]);
    expect(host.querySelector('[data-consumer="page"]')).not.toBeNull(); expect(businessStorageScope()).toBe(expected()); expect(pageMemoryScope()).toBe(expected());
    render([]); expect(businessStorageScope()).toBeNull(); expect(pageMemoryScope()).toBeNull();
    render([provider("page"), provider("second")]); render([provider("second")]); expect(businessStorageScope()).toBe(expected());
  });
  it("a navigation observer never sets or clears the global page/draft identity", () => {
    render([provider("observer", 88, false)]); expect(businessStorageScope()).toBeNull(); expect(pageMemoryScope()).toBeNull();
    render([provider("page"), provider("observer", 88, false)]); expect(businessStorageScope()).toBe(expected());
    render([provider("page")]); expect(businessStorageScope()).toBe(expected()); expect(pageMemoryScope()).toBe(expected());
    render([provider("observer", 88, false)]); expect(businessStorageScope()).toBeNull(); expect(pageMemoryScope()).toBeNull();
  });
  it("does not restore an old enterprise/binding scope when a newer scope leaves", () => {
    render([provider("old", 9), provider("current", 10, true, 2)]); expect(businessStorageScope()).toBe(expected(10, 2));
    render([provider("old", 9)]); expect(businessStorageScope()).toBeNull(); expect(pageMemoryScope()).toBeNull();
  });
  it("confirmed withdrawal/unmount clears storage immediately even while observer remains", () => {
    render([provider("page"), provider("observer", 9, false)]);
    render([provider("observer", 9, false)]); expect(businessStorageScope()).toBeNull(); expect(pageMemoryScope()).toBeNull();
  });
});
