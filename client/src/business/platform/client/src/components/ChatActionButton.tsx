import type { ButtonHTMLAttributes, ReactNode } from "react";

export type ChatActionButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  children?: ReactNode;
  fullWidth?: boolean;
};

/**
 * 全站统一“聊一聊”入口。
 *
 * 视觉基准来自商城搜索结果页的浅蓝按钮：浅蓝底、蓝色文字、绿色在线点。
 * 组件只负责外观和原生按钮行为，登录门禁、会话参数与页面跳转由调用方保留。
 *
 * 关于 data-chat-action：
 * 部分页面（如今日推荐）带有自己的表格级 CSS，例如
 *   .dr-row-actions button { height:29px; border-radius:3px }
 *   .dr-table span { display:block; font-size:9px; color:#969ca2 }
 * 这类后代选择器会穿透进本组件，把按钮压成灰色小字、并让绿点因
 * display:block 而换行错位——组件明明被正确引用，视觉却不一致。
 * 因此这里输出一个稳定的 data 属性作为“防覆盖锚点”，页面级样式
 * 必须用 :not([data-chat-action]) 将其排除。用 data 属性而非 class，
 * 是为了不受调用方传入 className 或 Tailwind 类名合并的影响。
 */
export default function ChatActionButton({
  children = "聊一聊",
  fullWidth = false,
  className = "",
  type = "button",
  ...props
}: ChatActionButtonProps) {
  return (
    <button
      type={type}
      data-chat-action=""
      className={`inline-flex h-[30px] items-center justify-center gap-[5px] whitespace-nowrap rounded-md border border-[rgba(43,122,232,0.2)] bg-[#E8F1FB] px-3 text-xs font-semibold text-[#2B7AE8] transition-colors duration-150 hover:border-[#2B7AE8] hover:bg-[#2B7AE8] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2B7AE8]/35 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-55 ${fullWidth ? "w-full" : ""} ${className}`}
      {...props}
    >
      <span
        className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#16A34A]"
        aria-hidden="true"
      />
      <span>{children}</span>
    </button>
  );
}
