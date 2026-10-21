import type { ReactNode } from "react";

/**
 * Shared frame for first-level pages (新任务 aside): one scroll container, one content width,
 * one gutter. Keeping these in one place is what makes the pages line up when switching.
 */
export function PageShell({ children, testId }: { children: ReactNode; testId?: string }) {
	return (
		<div
			className="page-fade min-h-0 min-w-0 flex-1 overflow-y-auto bg-canvas px-8 pb-12 pt-8"
			data-testid={testId}
		>
			<div className="mx-auto w-full max-w-5xl">{children}</div>
		</div>
	);
}

/**
 * Page title block: H1 (20px/600) + one 13px line of description + primary actions on the right.
 * Tabs, when a page has them, go in `tabs` so they always sit under the title.
 */
export function PageHeader({
	title,
	description,
	actions,
	tabs,
}: {
	title: ReactNode;
	description?: ReactNode;
	actions?: ReactNode;
	tabs?: ReactNode;
}) {
	return (
		<header className="mb-6">
			<div className="flex flex-wrap items-start justify-between gap-4">
				<div className="min-w-0">
					<h1 className="text-xl font-semibold tracking-[-0.01em] text-ink">{title}</h1>
					{description ? (
						<p className="mt-2 max-w-2xl truncate text-[13px] leading-relaxed text-ink-dim">{description}</p>
					) : null}
				</div>
				{actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
			</div>
			{tabs ? <div className="mt-5 border-b border-border">{tabs}</div> : null}
		</header>
	);
}

/** Section card used inside pages: one card per section, rows inside are divided, never nested cards. */
export function SectionCard({
	title,
	description,
	actions,
	children,
	className = "",
}: {
	title?: ReactNode;
	description?: ReactNode;
	actions?: ReactNode;
	children: ReactNode;
	className?: string;
}) {
	return (
		<section className={`rounded-2xl border border-border bg-surface ${className}`}>
			{title || actions ? (
				<div className="flex items-start justify-between gap-3 px-5 pb-3 pt-4">
					<div className="min-w-0">
						{title ? <h2 className="text-sm font-semibold text-ink">{title}</h2> : null}
						{description ? <p className="mt-1 text-xs leading-relaxed text-ink-dim">{description}</p> : null}
					</div>
					{actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
				</div>
			) : null}
			{children}
		</section>
	);
}
