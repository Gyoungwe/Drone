import type { MouseEventHandler, ReactNode, RefObject } from "react";

export type ActionSurfaceTone = "accent" | "warn" | "danger";
export type ActionSurfaceWidth = "compact" | "standard" | "wide";

const WIDTH: Record<ActionSurfaceWidth, string> = {
	compact: "w-[min(440px,calc(100vw-1.5rem))]",
	standard: "w-[min(480px,calc(100vw-1.5rem))]",
	wide: "w-[min(560px,calc(100vw-1.5rem))]",
};
const TONE: Record<ActionSurfaceTone, string> = {
	accent: "border-l-accent/60",
	warn: "border-l-warn/60",
	danger: "border-l-err/70",
};

/** Shared right-side interaction surface for asks, reviews, trust and setup flows. */
export function ActionSurface({
	children,
	ariaLabel,
	contentRef,
	tone = "accent",
	width = "standard",
	testId,
	onBackdropMouseDown,
}: {
	children: ReactNode;
	ariaLabel: string;
	contentRef?: RefObject<HTMLDivElement | null>;
	tone?: ActionSurfaceTone;
	width?: ActionSurfaceWidth;
	testId?: string;
	onBackdropMouseDown?: MouseEventHandler<HTMLDivElement>;
}) {
	return (
		<div
			className="fixed inset-0 z-(--z-dialog-top) flex items-stretch justify-end bg-ink/15 p-3 sm:p-4"
			role="dialog"
			aria-modal
			aria-label={ariaLabel}
			data-testid={testId}
			onMouseDown={onBackdropMouseDown}
		>
			<div
				ref={contentRef}
				className={`flex h-full max-h-[calc(100vh-1.5rem)] ${WIDTH[width]} flex-col overflow-hidden rounded-2xl border border-border border-l-2 ${TONE[tone]} bg-surface text-ink shadow-dialog`}
			>
				{children}
			</div>
		</div>
	);
}
