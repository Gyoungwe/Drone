import type { ArtifactContributionProps } from "@gyoungwe/plugin-api/ui";
import { type ComponentType, type ReactNode, useMemo } from "react";
import { useUiPluginsStore } from "../stores/ui-plugins";
import { PluginBoundary } from "./PluginBoundary";
import { EMPTY_CONTRIBUTIONS } from "./RegionHost";
import { useUiPluginRegistry } from "./registry";
import { UI_REGIONS } from "./slots";

export function ArtifactContributions({
	surface,
	artifactId,
	analysisId,
	capabilityId,
	sessionId,
	workspaceId,
	renderDefault,
}: Omit<ArtifactContributionProps, "renderDefault"> & { renderDefault: () => ReactNode }) {
	const list =
		useUiPluginRegistry((s) => s.contributions[UI_REGIONS.ArtifactContribution]) ?? EMPTY_CONTRIBUTIONS;
	const nonces = useUiPluginRegistry((s) => s.loadNonces);
	const masterOn = useUiPluginsStore((s) => s.config.enabled);
	const props = useMemo(
		() =>
			Object.freeze({
				surface,
				artifactId,
				analysisId,
				capabilityId,
				sessionId,
				workspaceId,
				renderDefault,
			}),
		[surface, artifactId, analysisId, capabilityId, sessionId, workspaceId, renderDefault],
	);
	// R3 permits only the public type import; named fields and this assertion keep the display contract closed.
	if (
		import.meta.env.DEV &&
		Object.keys(props).sort().join(",") !==
			"analysisId,artifactId,capabilityId,renderDefault,sessionId,surface,workspaceId"
	) {
		throw new Error("Invalid artifact contribution props");
	}
	return (
		<>
			{renderDefault()}
			{masterOn &&
				list.map((contribution) => {
					const Panel = contribution.component as ComponentType<Record<string, unknown>>;
					return (
						<PluginBoundary
							key={`${contribution.pluginName}:${contribution.id}:${nonces[contribution.pluginName] ?? 0}`}
							pluginName={contribution.pluginName}
							label={`region ${UI_REGIONS.ArtifactContribution}/${surface}`}
						>
							<Panel {...props} />
						</PluginBoundary>
					);
				})}
		</>
	);
}
