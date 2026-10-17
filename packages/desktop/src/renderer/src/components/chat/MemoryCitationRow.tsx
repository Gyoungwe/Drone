/** 「使用了 N 条记忆」：列出本条回答引用或读取过的记忆编号。 */
export function MemoryCitationRow({ ids, label }: { ids: number[]; label: string }) {
	return (
		<div
			className="flex flex-wrap items-center gap-2 text-[11px] text-ink-faint"
			data-testid="memory-citations"
		>
			<span className="citation-evidence-label">{label}</span>
			{ids.map((id) => (
				<span key={id} className="citation-chip rounded border px-2 py-px font-mono text-[11px]">
					m:{id}
				</span>
			))}
		</div>
	);
}
