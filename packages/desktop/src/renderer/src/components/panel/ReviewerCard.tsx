import type { ReviewerFindingUi } from "@drone/shared";
import { useT } from "../../i18n";

function locationText(finding: ReviewerFindingUi): string {
	if (finding.location.artifactId) return finding.location.artifactId;
	if (finding.location.line) return `L${finding.location.line}`;
	if (finding.location.paragraph) return `P${finding.location.paragraph}`;
	return finding.location.path ?? "—";
}

export function ReviewerCard({ finding }: { finding: ReviewerFindingUi }) {
	const t = useT();
	return (
		<details className={`reviewer-card severity-${finding.severity}`} data-testid="reviewer-card">
			<summary>
				<strong>{t("process.reviewerTitle")}</strong>
				<span className="reviewer-card-code">{finding.code}</span>
				<span className="reviewer-card-severity">{finding.severity}</span>
			</summary>
			<div className="reviewer-card-body">
				<p>{finding.detail}</p>
				<p className="reviewer-card-location">
					{t("process.reviewerLocation", { location: locationText(finding) })}
				</p>
				<p>
					<strong>{t("process.reviewerSuggestion")}</strong> {finding.suggestion}
				</p>
				{finding.nonIndependentReason ? <p>{finding.nonIndependentReason}</p> : null}
			</div>
		</details>
	);
}
