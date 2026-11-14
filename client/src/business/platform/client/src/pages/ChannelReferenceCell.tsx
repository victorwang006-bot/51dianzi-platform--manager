import React from "react";

export function ChannelReferenceCell({ source }: { source: "lcsc" | "ickey" }) {
  return <span className="ci-reference-placeholder" data-reference-status="disabled" data-source={source}>暂无报价</span>;
}
