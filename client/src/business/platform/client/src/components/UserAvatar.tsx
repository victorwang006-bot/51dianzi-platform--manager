import { useState } from "react";

/**
 * 用户头像（全站统一）。
 *
 * 有 avatarUrl 时显示图片，否则回退为「首字母 + 渐变色块」——
 * 也就是本功能上线前全站一直在用的样式，因此老用户不会感到界面突变。
 *
 * 图片加载失败同样回退到色块：头像图片存在 OSS，
 * 若某张图失效而不做回退，页面上会出现一个破图占位，比色块更难看。
 */

/** 与 ChatPage 一致的渐变色板，保证同一用户在各页面颜色相同 */
const AVATAR_COLORS = [
  "bg-gradient-to-br from-[#2B7AE8] to-[#185FA5]",
  "bg-gradient-to-br from-[#43a867] to-[#2d7a4f]",
  "bg-gradient-to-br from-[#f0893a] to-[#c9610d]",
  "bg-gradient-to-br from-[#9b59b6] to-[#6c3483]",
  "bg-gradient-to-br from-[#17a2b8] to-[#0d6675]",
];

export function getAvatarColorClass(id: number) {
  return AVATAR_COLORS[Math.abs(id) % AVATAR_COLORS.length];
}

export default function UserAvatar({
  avatarUrl,
  name,
  userId,
  className = "",
  fallbackClassName,
}: {
  /** 头像图片地址；为空表示用户未设置头像 */
  avatarUrl?: string | null;
  /** 用于取首字母的展示名 */
  name?: string | null;
  /** 用于挑选回退色块的稳定标识 */
  userId?: number;
  /** 尺寸与圆角由调用方决定，保持各处原有视觉 */
  className?: string;
  /** 回退色块的额外类名；不传则按 userId 取色 */
  fallbackClassName?: string;
}) {
  const [failed, setFailed] = useState(false);
  const initial = (name || "").charAt(0) || "U";
  const showImage = Boolean(avatarUrl) && !failed;

  if (showImage) {
    return (
      <img
        src={avatarUrl as string}
        alt={name || "用户头像"}
        loading="lazy"
        decoding="async"
        onError={() => setFailed(true)}
        className={`object-cover shrink-0 ${className}`}
      />
    );
  }

  const colorClass =
    fallbackClassName ?? getAvatarColorClass(userId ?? initial.charCodeAt(0));
  return (
    <div
      className={`flex items-center justify-center font-semibold text-white shrink-0 ${colorClass} ${className}`}
    >
      {initial}
    </div>
  );
}
