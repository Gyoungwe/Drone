import { type PointerEvent, type ReactNode, useId, useState } from "react";

let lastTooltipExitAt = 0;
let resetTooltipTimer: ReturnType<typeof setTimeout> | undefined;

/** 轻量自定义 tooltip：首次悬停延迟，连续浏览相邻控件时立即切换。 */
export function Tooltip({
	label,
	align = "center",
	className,
	children,
}: {
	label: string;
	/** 气泡水平锚定：center = 居中（默认）；end = 右缘对齐（右缘元素用，不向右溢出） */
	align?: "center" | "end";
	/** 追加到触发元素包裹层（如 w-full 让栅格内的禁用输入撑满） */
	className?: string;
	children: ReactNode;
}) {
	const tooltipId = useId();
	const [instant, setInstant] = useState(false);
	const enter = () => {
		if (resetTooltipTimer) clearTimeout(resetTooltipTimer);
		setInstant(Date.now() - lastTooltipExitAt < 240);
	};
	const leave = (_event: PointerEvent<HTMLSpanElement>) => {
		lastTooltipExitAt = Date.now();
		setInstant(false);
		resetTooltipTimer = setTimeout(() => {
			lastTooltipExitAt = 0;
		}, 180);
	};
	return (
		<span
			className={`group/tooltip relative inline-flex shrink-0 ${className ?? ""}`}
			onPointerEnter={enter}
			onPointerLeave={leave}
		>
			{children}
			<span
				id={tooltipId}
				role="tooltip"
				className={`drone-tooltip pointer-events-none absolute top-full z-50 mt-2 whitespace-nowrap rounded-md bg-white px-2 py-1 text-xs text-ink opacity-0 shadow-pop group-hover/tooltip:opacity-100 group-focus-within/tooltip:opacity-100 dark:bg-black ${
					instant ? "drone-tooltip--instant" : "group-hover/tooltip:delay-300"
				} ${align === "end" ? "right-0" : "left-1/2 -translate-x-1/2"}`}
				data-instant={instant ? "true" : undefined}
			>
				{label}
			</span>
		</span>
	);
}
