import type { KnowledgeSurfaceProps } from "@gyoungwe/plugin-api/ui";
import { KnowledgeSurface } from "./KnowledgeSurface";
export function KnowledgePanel(props: Omit<Extract<KnowledgeSurfaceProps, { kind: "settings" }>, "kind">) {
	return <KnowledgeSurface kind="settings" {...props} />;
}
