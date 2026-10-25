import { useUiStore } from "../../stores/ui";
import { ResourceSidebar } from "./ResourceSidebar";

/** Full-page views share the resource reader without leaving their current page. */
export function PageResourcePreview() {
	const view = useUiStore((s) => s.view);
	const target = useUiStore((s) => s.resourcePreview);
	const open = useUiStore((s) => s.panelOpen);
	if (view === "chat" || !target || !open) return null;
	return (
		<aside className="context-panel context-panel--research open" data-testid="page-resource-preview">
			<div className="context-panel-in">
				<ResourceSidebar target={target} />
			</div>
		</aside>
	);
}
