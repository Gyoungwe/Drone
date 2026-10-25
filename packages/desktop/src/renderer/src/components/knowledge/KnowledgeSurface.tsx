import type { KnowledgeSurfaceProps } from "@gyoungwe/plugin-api/ui";
import { PluginEntryHost, usePluginEntries } from "../../plugins/PluginRegions";
import { UI_REGIONS } from "../../plugins/slots";
import { KnowledgeFallback } from "./KnowledgeFallback";

export function KnowledgeSurface(props: KnowledgeSurfaceProps) {
	const entry = usePluginEntries(UI_REGIONS.KnowledgeSurface)[0];
	const fallback = props.kind === "flow" ? null : <KnowledgeFallback />;
	return entry ? <PluginEntryHost entry={entry} props={props} fallback={fallback} /> : fallback;
}
