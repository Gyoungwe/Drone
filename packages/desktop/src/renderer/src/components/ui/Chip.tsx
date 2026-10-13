import type { HTMLAttributes } from "react";

type ChipTone = "neutral" | "reference";

interface ChipProps extends HTMLAttributes<HTMLSpanElement> {
	/** reference = @ 引用（文件/任务/数据库），唯一使用 --chip-accent 的场景；其余一律中性灰 */
	tone?: ChipTone;
}

const TONE: Record<ChipTone, string> = {
	neutral: "bg-hover text-ink-2",
	reference: "bg-chip-accent/10 text-chip-accent",
};

/** U3：22px 高的小胶囊（输入框附件、筛选、引用） */
export function Chip({ tone = "neutral", className = "", ...props }: ChipProps) {
	return (
		<span
			className={`inline-flex h-[22px] max-w-full shrink-0 select-none items-center gap-1 rounded-md px-2 text-[12px] leading-none ${TONE[tone]} ${className}`}
			{...props}
		/>
	);
}
