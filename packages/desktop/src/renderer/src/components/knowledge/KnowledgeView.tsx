import { PluginEntryHost, usePluginEntries } from "../../plugins/PluginRegions";
import { UI_REGIONS } from "../../plugins/slots";
import { KnowledgeFallback } from "./KnowledgeFallback";

/** The host owns the mount and fallback; the enabled plugin owns the knowledge page. */
export function KnowledgeView() {
	const entry = usePluginEntries(UI_REGIONS.KnowledgePage)[0];
	const fallback = <KnowledgeFallback />;
	return (
		<section className="flex min-h-0 flex-1 flex-col overflow-auto" data-testid="knowledge-page-host">
			{entry ? <PluginEntryHost entry={entry} fallback={fallback} /> : fallback}
		</section>
	);
}
