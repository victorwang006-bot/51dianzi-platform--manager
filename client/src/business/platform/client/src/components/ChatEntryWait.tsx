import React, { type FormEvent } from "react";
import "./ChatEntryWait.css";

const h = React.createElement;

function Block({ className, keyName }: { className: string; keyName: string }) {
  return h("span", { className, key: keyName, "aria-hidden": true });
}

function ChatEntryAuthWait() {
  return h(
    "div",
    {
      className: "d51-chat-entry-wait d51-chat-entry-wait--auth",
      role: "status",
      "aria-live": "polite",
      "aria-busy": true,
      "aria-label": "正在加载聊天",
      "data-testid": "d51-chat-entry-auth-wait",
    },
    h(
      "header",
      { className: "d51-chat-entry-wait__desktop-header", "aria-hidden": true },
      Block({ className: "d51-chat-entry-wait__brand", keyName: "brand" }),
      h(
        "div",
        { className: "d51-chat-entry-wait__desktop-nav" },
        [0, 1, 2, 3].map((index) => Block({ className: "d51-chat-entry-wait__nav-item", keyName: `nav-${index}` })),
      ),
      Block({ className: "d51-chat-entry-wait__account", keyName: "account" }),
    ),
    h(
      "header",
      { className: "d51-chat-entry-wait__mobile-header" },
      h("a", { className: "d51-chat-entry-wait__back", href: "/", "aria-label": "返回" }, "‹"),
      Block({ className: "d51-chat-entry-wait__mobile-title", keyName: "mobile-title" }),
    ),
    h(
      "div",
      { className: "d51-chat-entry-wait__chat-shell" },
      h(
        "aside",
        { className: "d51-chat-entry-wait__conversation-list", "aria-hidden": true },
        Block({ className: "d51-chat-entry-wait__sidebar-heading", keyName: "sidebar-heading" }),
        [0, 1, 2, 3, 4].map((index) =>
          h(
            "div",
            { className: "d51-chat-entry-wait__conversation-row", key: `conversation-${index}` },
            Block({ className: "d51-chat-entry-wait__conversation-dot", keyName: `conversation-dot-${index}` }),
            h(
              "span",
              { className: "d51-chat-entry-wait__conversation-lines" },
              Block({ className: "d51-chat-entry-wait__conversation-line d51-chat-entry-wait__conversation-line--wide", keyName: `conversation-wide-${index}` }),
              Block({ className: "d51-chat-entry-wait__conversation-line", keyName: `conversation-short-${index}` }),
            ),
          ),
        ),
      ),
      h(
        "main",
        { className: "d51-chat-entry-wait__message-panel", "aria-label": "聊天正在加载" },
        h(
          "div",
          { className: "d51-chat-entry-wait__message-header", "aria-hidden": true },
          Block({ className: "d51-chat-entry-wait__message-title", keyName: "message-title" }),
          Block({ className: "d51-chat-entry-wait__message-action", keyName: "message-action" }),
        ),
        h(
          "section",
          { className: "d51-chat-entry-wait__message-list", "aria-hidden": true },
          [0, 1, 2].map((index) =>
            h(
              "div",
              { className: `d51-chat-entry-wait__message-row d51-chat-entry-wait__message-row--${index % 2 ? "right" : "left"}`, key: `message-${index}` },
              Block({ className: "d51-chat-entry-wait__message-bubble", keyName: `bubble-${index}` }),
            ),
          ),
        ),
        h(
          "form",
          {
            className: "d51-chat-entry-wait__composer",
            "aria-label": "聊天输入框正在加载",
            onSubmit: (event: FormEvent<HTMLFormElement>) => event.preventDefault(),
          },
          h("textarea", {
            className: "d51-chat-entry-wait__composer-input",
            disabled: true,
            readOnly: true,
            value: "",
            "aria-label": "聊天输入框正在加载",
          }),
          h(
            "button",
            {
              className: "d51-chat-entry-wait__send",
              type: "button",
              disabled: true,
              "aria-disabled": true,
            },
            "发送",
          ),
        ),
      ),
    ),
    h("span", { className: "d51-chat-entry-wait__sr-only" }, "正在加载聊天，请稍候"),
  );
}

function ChatEnterpriseWait({ loading = true }: { loading?: boolean } = {}) {
  const [showStatus, setShowStatus] = React.useState(false);

  React.useEffect(() => {
    if (!loading) {
      setShowStatus(false);
      return undefined;
    }
    const timer = setTimeout(() => setShowStatus(true), 250);
    return () => clearTimeout(timer);
  }, [loading]);

  return h(
    "div",
    {
      className: "d51-chat-entry-wait__enterprise",
      role: "status",
      "aria-live": showStatus ? "polite" : "off",
      "aria-busy": true,
      "aria-label": "正在加载聊天",
      "data-testid": "d51-chat-entry-enterprise-wait",
    },
    h(
      "span",
      { className: "d51-chat-entry-wait__enterprise-shapes", "aria-hidden": true },
      Block({ className: "d51-chat-entry-wait__enterprise-line d51-chat-entry-wait__enterprise-line--long", keyName: "enterprise-long" }),
      Block({ className: "d51-chat-entry-wait__enterprise-line", keyName: "enterprise-short" }),
    ),
    showStatus ? h("span", { className: "d51-chat-entry-wait__enterprise-copy" }, "正在加载聊天…") : null,
  );
}

export { ChatEntryAuthWait, ChatEnterpriseWait };
