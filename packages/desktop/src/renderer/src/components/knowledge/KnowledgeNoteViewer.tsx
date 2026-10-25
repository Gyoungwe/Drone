import type { KnowledgeSurfaceProps } from "@gyoungwe/plugin-api/ui";
import { KnowledgeSurface } from "./KnowledgeSurface";
export function KnowledgeNoteViewer(props: Omit<Extract<KnowledgeSurfaceProps, { kind: "note" }>, "kind">) {
	return <KnowledgeSurface kind="note" {...props} />;
}
