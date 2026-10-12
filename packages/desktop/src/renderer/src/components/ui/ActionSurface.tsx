import {
	type MouseEventHandler,
	type KeyboardEvent as ReactKeyboardEvent,
	type ReactNode,
	type RefObject,
	useEffect,
	useRef,
} from "react";
import { useDialogLayer } from "./dialog-stack";

export type ActionSurfaceTone = "accent" | "warn" | "danger";
export type ActionSurfaceWidth = "compact" | "standard" | "wide";
/** fill: full-height drawer (long forms/diffs). fit: card that only takes the height its content needs. */
export type ActionSurfaceHeight = "fill" | "fit";

const WIDTH: Record<ActionSurfaceWidth, string> = {
	compact: "w-[min(440px,calc(100vw-1.5rem))]",
	standard: "w-[min(480px,calc(100vw-1.5rem))]",
	wide: "w-[min(560px,calc(100vw-1.5rem))]",
};
/** Tone is carried by a top accent bar + header chip instead of a 2px left border that clips the radius. */
const TONE_BAR: Record<ActionSurfaceTone, string> = {
	accent: "before:bg-accent",
	warn: "before:bg-warn",
	danger: "before:bg-err",
};

const FOCUSABLE =
	'a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/** Pure focus-trap step: index of the element Tab/Shift+Tab should move to, or -1 to let the browser handle it. */
export function trapFocusIndex(count: number, current: number, backwards: boolean): number {
	if (count <= 0) return -1;
	if (current < 0) return backwards ? count - 1 : 0;
	if (backwards && current === 0) return count - 1;
	if (!backwards && current === count - 1) return 0;
	return -1;
}

/** Shared right-side interaction surface for asks, reviews, trust and setup flows. */
export function ActionSurface({
	children,
	ariaLabel,
	contentRef,
	tone = "accent",
	width = "standard",
	height = "fill",
	testId,
	onBackdropMouseDown,
	onEscape,
	restoreFocus = true,
}: {
	children: ReactNode;
	ariaLabel: string;
	contentRef?: RefObject<HTMLDivElement | null>;
	tone?: ActionSurfaceTone;
	width?: ActionSurfaceWidth;
	height?: ActionSurfaceHeight;
	testId?: string;
	onBackdropMouseDown?: MouseEventHandler<HTMLDivElement>;
	/** Called on Escape when this surface is the top layer. Omit for surfaces that require an explicit choice. */
	onEscape?: () => void;
	restoreFocus?: boolean;
}) {
	const own = useRef<HTMLDivElement>(null);
	const layer = useDialogLayer(onEscape);
	const ref = contentRef ?? own;
	useEffect(() => {
		if (!restoreFocus) return;
		const previous = document.activeElement as HTMLElement | null;
		if (ref.current && !ref.current.contains(document.activeElement)) {
			ref.current.querySelector<HTMLElement>(FOCUSABLE)?.focus();
		}
		return () => previous?.focus?.();
	}, [ref, restoreFocus]);
	// When a covering surface closes, move focus back into this one.
	useEffect(() => {
		if (layer.isTop && ref.current && !ref.current.contains(document.activeElement)) {
			ref.current.querySelector<HTMLElement>(FOCUSABLE)?.focus();
		}
	}, [layer.isTop, ref]);
	const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
		if (event.key !== "Tab" || !ref.current) return;
		const nodes = Array.from(ref.current.querySelectorAll<HTMLElement>(FOCUSABLE));
		const next = trapFocusIndex(
			nodes.length,
			nodes.indexOf(document.activeElement as HTMLElement),
			event.shiftKey,
		);
		if (next < 0) return;
		event.preventDefault();
		nodes[next]?.focus();
	};
	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: backdrop click is a pointer shortcut; Escape/buttons remain the keyboard path
		<div
			className={`fixed inset-0 z-(--z-dialog-top) flex ${height === "fit" ? "items-start" : "items-stretch"} justify-end bg-ink/20 p-3 backdrop-blur-[1px] sm:p-4`}
			role="presentation"
			hidden={!layer.isTop}
			inert={!layer.isTop}
			data-layer={layer.depth}
			style={{ zIndex: `calc(var(--z-dialog-top) + ${layer.depth})` }}
			data-testid={testId ? `${testId}-backdrop` : undefined}
			onMouseDown={(event) => {
				if (event.target === event.currentTarget) onBackdropMouseDown?.(event);
			}}
		>
			<div
				ref={ref}
				role="dialog"
				aria-modal="true"
				aria-label={ariaLabel}
				data-testid={testId}
				data-tone={tone}
				onKeyDown={onKeyDown}
				className={`relative flex ${height === "fit" ? "max-h-[calc(100vh-1.5rem)]" : "h-full max-h-[calc(100vh-1.5rem)]"} ${WIDTH[width]} flex-col overflow-hidden rounded-2xl border border-border bg-surface text-ink shadow-dialog before:absolute before:inset-x-0 before:top-0 before:h-[3px] ${TONE_BAR[tone]} motion-safe:animate-[action-surface-in_160ms_ease-out] [&_:focus-visible]:outline-2 [&_:focus-visible]:outline-offset-2 [&_:focus-visible]:outline-accent`}
			>
				{children}
			</div>
		</div>
	);
}
