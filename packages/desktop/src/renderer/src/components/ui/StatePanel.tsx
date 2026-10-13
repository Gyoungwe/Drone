import type { ReactNode } from "react";

export type StateKind = "empty" | "loading" | "error";

const DOT: Record<StateKind, string> = {
	empty: "bg-ink-faint/40",
	loading: "bg-accent motion-safe:animate-pulse",
	error: "bg-err",
};

/**
 * One visual language for empty / loading / error placeholders across panels, settings and knowledge.
 * Loading announces politely, errors assertively; empty is static text.
 */
export function StatePanel({
	kind = "empty",
	title,
	hint,
	action,
	compact = false,
	className = "",
	testId,
}: {
	kind?: StateKind;
	title: ReactNode;
	hint?: ReactNode;
	action?: ReactNode;
	compact?: boolean;
	className?: string;
	testId?: string;
}) {
	const role = kind === "error" ? "alert" : kind === "loading" ? "status" : undefined;
	return (
		<div
			role={role}
			aria-busy={kind === "loading" ? true : undefined}
			data-state={kind}
			data-testid={testId}
			className={`flex flex-col items-center justify-center gap-2 text-center ${compact ? "py-4" : "py-8"} ${className}`}
		>
			<span aria-hidden className={`size-1.5 rounded-full ${DOT[kind]}`} />
			<p className={`text-[12.5px] ${kind === "error" ? "text-err" : "text-ink-dim"}`}>{title}</p>
			{hint ? <p className="max-w-[36ch] text-[11.5px] leading-relaxed text-ink-faint">{hint}</p> : null}
			{action ? <div className="mt-2">{action}</div> : null}
		</div>
	);
}
