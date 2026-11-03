import { createRequire } from "node:module";
import { act, createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BusinessContextVerificationBoundary } from "./BusinessWorkbenchPage";

const requireAdmin = createRequire(import.meta.url);
const { JSDOM } = requireAdmin("jsdom") as {
  JSDOM: new (
    html: string,
    options: { url: string }
  ) => {
    window: Window & typeof globalThis & { close(): void };
  };
};

type VerificationState = "verified" | "revalidating";
type MountedBoundary = {
  container: HTMLElement;
  rerender(state: VerificationState): Promise<void>;
  unmount(): Promise<void>;
};

async function mountBoundary(
  state: VerificationState,
  handlers: {
    onClick: () => void;
    onInput: () => void;
    onSubmit: () => void;
  }
): Promise<MountedBoundary> {
  const dom = new JSDOM(
    '<!doctype html><html><body><div id="root"></div></body></html>',
    { url: "http://workbench.test/workbench/customers" }
  );
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: dom.window.navigator,
  });
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    HTMLElement: dom.window.HTMLElement,
    Node: dom.window.Node,
    Event: dom.window.Event,
    MouseEvent: dom.window.MouseEvent,
    localStorage: dom.window.localStorage,
    requestAnimationFrame: (callback: FrameRequestCallback) =>
      setTimeout(() => callback(Date.now()), 0),
    cancelAnimationFrame: (handle: number) => clearTimeout(handle),
  });
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  const [reactModule, { createRoot }] = await Promise.all([
    import("react"),
    import("react-dom/client"),
  ]);
  (globalThis as typeof globalThis & { React?: unknown }).React = reactModule;
  const container = dom.window.document.getElementById("root");
  if (!container) throw new Error("FOCUS_GATE_TEST_ROOT_MISSING");
  const root = createRoot(container);

  const render = async (verificationState: VerificationState) => {
    await act(async () => {
      root.render(
        createElement(
          BusinessContextVerificationBoundary,
          {
            verificationState,
            identity:
              "business-domain:v1:staff:7002:admin:6001:enterprise:88001:merchant:30061:binding:4",
          },
          createElement(
            "form",
            { "data-testid": "customer-entry", onSubmit: handlers.onSubmit },
            createElement("input", {
              "data-testid": "customer-name",
              onInput: handlers.onInput,
            }),
            createElement(
              "button",
              {
                type: "button",
                "data-testid": "customer-save",
                onClick: handlers.onClick,
              },
              "保存客户"
            )
          )
        )
      );
    });
  };
  await render(state);

  return {
    container,
    rerender: render,
    async unmount() {
      await act(async () => root.unmount());
      dom.window.close();
    },
  };
}

describe("BusinessContextGate focus verification boundary", () => {
  let mounted: MountedBoundary | undefined;

  afterEach(async () => {
    await mounted?.unmount();
    mounted = undefined;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("keeps the previously verified tree mounted and editable during background verification; commands still reach server authorization", async () => {
    const handlers = {
      onClick: vi.fn(),
      onInput: vi.fn(),
      onSubmit: vi.fn(),
    };
    mounted = await mountBoundary("revalidating", handlers);

    const boundary = mounted.container.querySelector(
      '[data-business-context-verification="revalidating"]'
    );
    const content = boundary?.querySelector("[data-business-context-content]");
    const form = mounted.container.querySelector<HTMLFormElement>(
      '[data-testid="customer-entry"]'
    );
    const input = mounted.container.querySelector<HTMLInputElement>(
      '[data-testid="customer-name"]'
    );
    const save = mounted.container.querySelector<HTMLButtonElement>(
      '[data-testid="customer-save"]'
    );
    expect(boundary?.getAttribute("aria-busy")).toBe("true");
    expect(boundary?.textContent).toContain(
      "正在后台核验业务主体绑定，可继续编辑；提交仍由服务端实时鉴权。"
    );
    expect(content?.hasAttribute("inert")).toBe(false);
    expect(form).not.toBeNull();

    const click = new window.MouseEvent("click", {
      bubbles: true,
      cancelable: true,
    });
    const inputEvent = new window.Event("input", {
      bubbles: true,
      cancelable: true,
    });
    const submit = new window.Event("submit", {
      bubbles: true,
      cancelable: true,
    });
    await act(async () => {
      save?.dispatchEvent(click);
      input?.dispatchEvent(inputEvent);
      form?.dispatchEvent(submit);
    });
    expect(click.defaultPrevented).toBe(false);
    expect(inputEvent.defaultPrevented).toBe(false);
    expect(submit.defaultPrevented).toBe(false);
    expect(handlers.onClick).toHaveBeenCalledTimes(1);
    expect(handlers.onInput).toHaveBeenCalledTimes(1);
    expect(handlers.onSubmit).toHaveBeenCalledTimes(1);

    await mounted.rerender("verified");
    expect(
      mounted.container.querySelector(
        '[data-business-context-verification="verified"]'
      )
    ).not.toBeNull();
    expect(
      mounted.container
        .querySelector("[data-business-context-content]")
        ?.hasAttribute("inert")
    ).toBe(false);

    const resumedClick = new window.MouseEvent("click", {
      bubbles: true,
      cancelable: true,
    });
    const resumedInput = new window.Event("input", {
      bubbles: true,
      cancelable: true,
    });
    const resumedSubmit = new window.Event("submit", {
      bubbles: true,
      cancelable: true,
    });
    await act(async () => {
      save?.dispatchEvent(resumedClick);
      input?.dispatchEvent(resumedInput);
      form?.dispatchEvent(resumedSubmit);
    });
    expect(resumedClick.defaultPrevented).toBe(false);
    expect(resumedInput.defaultPrevented).toBe(false);
    expect(resumedSubmit.defaultPrevented).toBe(false);
    expect(handlers.onClick).toHaveBeenCalledTimes(2);
    expect(handlers.onInput).toHaveBeenCalledTimes(2);
    expect(handlers.onSubmit).toHaveBeenCalledTimes(2);
  });
});
