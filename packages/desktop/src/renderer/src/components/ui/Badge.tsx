import type { HTMLAttributes } from "react";

/** U3：scope / 类型标签，一律中性灰（不再用强调色底） */
export function Badge({ className = "", ...props }: HTMLAttributes<HTMLSpanElement>) {
	return (
		<span
			className={`inline-flex shrink-0 items-center rounded bg-hover px-2 py-0.5 text-xs font-medium text-ink-2 ${className}`}
			{...props}
		/>
	);
}
