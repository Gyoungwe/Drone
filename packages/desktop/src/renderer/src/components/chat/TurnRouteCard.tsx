import { type TurnRoute, turnRouteLines } from "@drone/shared";
import { useI18nStore } from "../../i18n";

/** One turn's route. The sentences come from that turn's record, not a fixed diagram. */
export function TurnRouteCard({ route }: { route: TurnRoute }) {
	const language = useI18nStore((state) => state.language);
	const view = turnRouteLines(route, language === "en" ? "en" : "zh");
	return (
		<details className="mt-2 rounded-xl border border-border bg-surface px-3 py-2" data-testid="turn-route">
			<summary className="cursor-pointer text-[12px] leading-5 text-ink">{view.summary}</summary>
			<div className="mt-1 space-y-1">
				{view.lines.map((line) => (
					<p key={line} className="text-[12px] leading-5 text-ink-dim">
						{line}
					</p>
				))}
			</div>
		</details>
	);
}
