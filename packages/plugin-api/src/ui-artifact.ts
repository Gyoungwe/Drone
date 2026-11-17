export const ARTIFACT_SURFACES = ["evidence.overview", "evidence.pane", "artifacts.card"] as const;
export type ArtifactSurface = (typeof ARTIFACT_SURFACES)[number];

/**
 * IDs are display context only and confer no runtime authority.
 * Runtime and caller binding stay host-owned.
 */
export interface ArtifactContributionProps {
	readonly surface: ArtifactSurface;
	readonly artifactId: string | null;
	readonly analysisId: string | null;
	readonly capabilityId: string | null;
	readonly sessionId: string | null;
	readonly workspaceId: string | null;
	readonly renderDefault: () => unknown;
}

const ID_KEYS = ["artifactId", "analysisId", "capabilityId", "sessionId", "workspaceId"] as const;

export function isArtifactContributionProps(value: unknown): value is ArtifactContributionProps {
	if (typeof value !== "object" || value === null) return false;
	const props = value as Record<string, unknown>;
	return (
		Reflect.ownKeys(props).length === ID_KEYS.length + 2 &&
		Object.hasOwn(props, "surface") &&
		ARTIFACT_SURFACES.some((surface) => surface === props.surface) &&
		ID_KEYS.every(
			(key) => Object.hasOwn(props, key) && (props[key] === null || typeof props[key] === "string"),
		) &&
		Object.hasOwn(props, "renderDefault") &&
		typeof props.renderDefault === "function"
	);
}
