import type { ReactNode } from "react";

export function SettingsRow({
	title,
	hint,
	children,
}: {
	title: string;
	hint?: string;
	children: ReactNode;
}) {
	return (
		<div className="settings-row">
			<div className="min-w-0">
				<h3 className="settings-row-title">{title}</h3>
				{hint && (
					<p className="settings-row-hint" title={hint}>
						{hint}
					</p>
				)}
			</div>
			<div className="shrink-0">{children}</div>
		</div>
	);
}
