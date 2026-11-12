import {j as __d51CompactJsx} from "/assets/20261106-one-click-review-images-v11-admin-4ebf4856da0f/index-8jluR_FO.js";
const {Fragment,jsx,jsxs}=__d51CompactJsx;

function CompactListToolbar({
  title,
  children,
  actions,
  extra,
  className
}) {
  return /* @__PURE__ */ jsxs(Fragment, { children: [
    /* @__PURE__ */ jsx("h1", { className: "d51-compact-list-title", children: title }),
    /* @__PURE__ */ jsxs(
      "section",
      {
        className: `d51-compact-list-toolbar${className ? ` ${className}` : ""}`,
        role: "search",
        "aria-label": `${title}\u7B5B\u9009\u548C\u64CD\u4F5C`,
        children: [
          /* @__PURE__ */ jsxs("div", { className: "d51-compact-list-toolbar__row", children: [
            /* @__PURE__ */ jsx("div", { className: "d51-compact-list-toolbar__filters", children }),
            actions ? /* @__PURE__ */ jsx("div", { className: "d51-compact-list-toolbar__actions", children: actions }) : null
          ] }),
          extra ? /* @__PURE__ */ jsx("div", { className: "d51-compact-list-toolbar__extra", children: extra }) : null
        ]
      }
    )
  ] });
}
export {
  CompactListToolbar
};
