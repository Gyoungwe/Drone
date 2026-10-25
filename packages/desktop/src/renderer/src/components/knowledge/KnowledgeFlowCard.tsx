import type { KnowledgeSurfaceProps } from "@gyoungwe/plugin-api/ui";
import { KnowledgeSurface } from "./KnowledgeSurface";
export function KnowledgeFlowCard(props: Omit<Extract<KnowledgeSurfaceProps, { kind: "flow" }>, "kind">) {
	return <KnowledgeSurface kind="flow" {...props} />;
}
