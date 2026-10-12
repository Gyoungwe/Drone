import type { ButtonHTMLAttributes } from "react";

type Variant = "ghost" | "primary";
type Size = "sm" | "md";
type Tone = "default" | "danger";

const SIZE: Record<Size, string> = {
	sm: "rounded-lg px-2 py-1 text-[12px]",
	md: "rounded-lg px-3 py-1.5 text-[13px]",
};

const TONE: Record<Tone, Record<Variant, string>> = {
	default: {
		ghost: "text-ink-dim transition-colors hover:bg-hover hover:text-ink",
		primary: "bg-ink font-medium text-on-ink transition-colors hover:bg-ink-2 disabled:opacity-40",
	},
	danger: {
		ghost: "text-err transition-colors hover:bg-err/10",
		primary: "bg-err font-medium text-white transition-colors hover:bg-err/90 disabled:opacity-40",
	},
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
	variant?: Variant;
	size?: Size;
	tone?: Tone;
}

/** 通用按钮：ghost（次级）/primary（主操作）× sm/md × default/danger */
export function Button({
	variant = "ghost",
	size = "md",
	tone = "default",
	className = "",
	type = "button",
	...props
}: ButtonProps) {
	return (
		<button
			type={type}
			className={`drone-button disabled:cursor-not-allowed drone-button--${variant} drone-button--${tone} drone-button--${size} ${SIZE[size]} ${TONE[tone][variant]} ${className}`}
			{...props}
		/>
	);
}
