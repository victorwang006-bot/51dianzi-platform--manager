import { logoHeaderMark } from "../assets/homeLogo";
import BrandImage from "./BrandImage";
import { cn } from "../lib/utils";

const sizeClasses = {
  sm: "size-7 rounded-[7px]",
  md: "size-8 rounded-lg",
  lg: "size-9 rounded-[9px]",
} as const;

export default function ServiceAvatar({
  size = "md",
  className,
}: {
  size?: keyof typeof sizeClasses;
  className?: string;
}) {
  return (
    <div
      role="img"
      aria-label="51小电客服头像"
      className={cn(
        "relative flex shrink-0 items-center justify-center overflow-hidden bg-white p-0.5 shadow-[0_1px_4px_rgba(27,73,113,.13),inset_0_0_0_1px_#d7e4f0]",
        sizeClasses[size],
        className
      )}
    >
      <BrandImage
        src={logoHeaderMark}
        alt=""
        draggable={false}
        className="h-full w-full select-none object-contain"
        fallbackClassName="text-[0.58em]"
      />
    </div>
  );
}
