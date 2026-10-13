import type { ButtonHTMLAttributes, ReactNode } from "react";

interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
	/** 必填：图标按钮没有可见文字，aria-label 即无障碍名称 */
	label: string;
	children: ReactNode;
	active?: boolean;
}

/** U3：28px 图标按钮，rounded-md，hover / active 底色用 --highlight */
export function IconButton({
	label,
	active,
	className = "",
	type = "button",
	children,
	...props
}: IconButtonProps) {
	return (
		<button
			type={type}
			aria-label={label}
			title={props.title ?? label}
			className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-ink-dim transition-colors hover:bg-[var(--highlight)] hover:text-ink disabled:cursor-not-allowed disabled:opacity-40 ${active ? "bg-[var(--highlight)] text-ink" : ""} ${className}`}
			{...props}
		>
			{children}
		</button>
	);
}
