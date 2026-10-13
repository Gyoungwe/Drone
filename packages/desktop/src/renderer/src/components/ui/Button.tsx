import type { ButtonHTMLAttributes } from "react";

/** U3：primary 黑 pill / secondary 描边 pill / ghost / danger；sm 28px、md 32px */
type Variant = "ghost" | "primary" | "secondary" | "danger";
type Size = "sm" | "md";
type Tone = "default" | "danger";

const SIZE: Record<Size, string> = {
	sm: "h-7 px-3 text-[12px]",
	md: "h-8 px-4 text-[13px]",
};

const SHAPE: Record<Variant, string> = {
	primary: "rounded-full",
	secondary: "rounded-full",
	danger: "rounded-full",
	ghost: "rounded-lg",
};

const TONE: Record<Tone, Record<Variant, string>> = {
	default: {
		ghost: "text-ink-dim transition-colors hover:bg-[var(--highlight)] hover:text-ink",
		primary: "bg-ink font-medium text-on-ink transition-colors hover:bg-ink-2 disabled:opacity-40",
		secondary:
			"border border-border bg-surface font-medium text-ink transition-colors hover:bg-[var(--highlight)] disabled:opacity-40",
		danger: "bg-err font-medium text-white transition-colors hover:bg-err/90 disabled:opacity-40",
	},
	danger: {
		ghost: "text-err transition-colors hover:bg-err/10",
		primary: "bg-err font-medium text-white transition-colors hover:bg-err/90 disabled:opacity-40",
		secondary:
			"border border-err/40 font-medium text-err transition-colors hover:bg-err/10 disabled:opacity-40",
		danger: "bg-err font-medium text-white transition-colors hover:bg-err/90 disabled:opacity-40",
	},
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
	variant?: Variant;
	size?: Size;
	tone?: Tone;
}

/** 通用按钮：variant × size × tone；ghost 保留圆角矩形，其余为 pill */
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
			className={`drone-button inline-flex items-center justify-center gap-1 disabled:cursor-not-allowed drone-button--${variant} drone-button--${tone} drone-button--${size} ${SIZE[size]} ${SHAPE[variant]} ${TONE[tone][variant]} ${className}`}
			{...props}
		/>
	);
}
