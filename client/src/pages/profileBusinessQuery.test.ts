// @vitest-environment jsdom
import * as React from "react";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it } from "vitest";
import { useProfileBusinessQuery } from "./profileBusinessQuery";

let root: Root;
let container: HTMLDivElement;
let client: QueryClient;
let selection: string;
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
async function settle() {
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 15)); });
}
function QueryView({ group, read }: { group: string; read(signal: AbortSignal): Promise<string> }) {
  const query = useProfileBusinessQuery({ queryKey: ["profile-business-fence", group], enabled: true,
    isCurrent: () => selection === group, read });
  return createElement("div", null, query.isError ? "error" : query.isFetching ? "loading" : query.data);
}
async function render(group: string, read: (signal: AbortSignal) => Promise<string>) {
  selection = group;
  await act(async () => root.render(createElement(QueryClientProvider, { client }, createElement(QueryView, { group, read }))));
  await settle();
}
beforeEach(() => {
  Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });
  selection = "a";
  client = new QueryClient();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  client.clear();
  container.remove();
});
it("rejects an old selection result even before React commits the next render", async () => {
  const pending = deferred<string>();
  await render("a", () => pending.promise);
  await act(async () => { selection = "b"; pending.resolve("old-scope-money"); });
  await settle();
  expect(container.textContent).toBe("error");
  expect(client.getQueryData(["profile-business-fence", "a"])).toBeUndefined();
});
it("drops an ignored-abort response and never inserts it into another selection", async () => {
  const pending = deferred<string>();
  let oldSignal!: AbortSignal;
  await render("a", signal => { oldSignal = signal; return pending.promise; });
  await render("b", async () => "new-scope-money");
  expect(oldSignal.aborted).toBe(true);
  await act(async () => pending.resolve("old-scope-money"));
  await settle();
  expect(container.textContent).toBe("new-scope-money");
  expect(client.getQueryData(["profile-business-fence", "a"])).toBeUndefined();
});
it("clears prior data when a newly selected scope fails", async () => {
  await render("a", async () => "previous-scope-money");
  await render("b", async () => { throw new Error("failure"); });
  expect(container.textContent).toBe("error");
  expect(container.textContent).not.toContain("previous-scope-money");
});
