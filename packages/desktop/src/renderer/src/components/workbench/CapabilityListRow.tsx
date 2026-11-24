import type { McpServerStatus, McpStatus, ResearchConnectorDescriptor } from "@drone/shared";
import type { useT } from "../../i18n";
import type { CapabilityDrawer } from "../../stores/ui";
import { ListIcon, TaskBoardIcon, ZoteroIcon } from "../icons";
import { Switch } from "../ui/Switch";

export type CapabilityStatus =
	| "available"
	| "configure"
	| "running"
	| "disabled"
	| "permission"
	| "stale"
	| "error"
	| "incompatible";

export interface CapabilityRow {
	id: string;
	kind: "connector" | "mcp";
	name: string;
	description: string;
	scope: string;
	status: CapabilityStatus;
	version?: string;
	action?: string;
	connectorId?: string;
	source?: string;
}

interface RowActionsProps {
	row: CapabilityRow;
	connector?: ResearchConnectorDescriptor;
	server?: McpServerStatus;
	connectorPending: string | null;
	pendingMcp: string | null;
	toggleConnector: (connector: ResearchConnectorDescriptor) => Promise<void>;
	toggleMcp: (serverName: string, enabled: boolean) => void;
	openSettings: (category: CapabilityDrawer) => void;
	t: ReturnType<typeof useT>;
}

interface CapabilityListRowProps extends Omit<RowActionsProps, "connector" | "server"> {
	mcp: McpStatus | null;
	connectors: readonly ResearchConnectorDescriptor[];
}

export function statusTone(status: CapabilityStatus): string {
	if (status === "running" || status === "available") return "text-ok";
	if (status === "configure" || status === "permission" || status === "stale") return "text-warn";
	if (status === "error" || status === "incompatible") return "text-err";
	return "text-ink-faint";
}

function IconForKind({ kind }: { kind: CapabilityRow["kind"] }) {
	if (kind === "connector") return <ZoteroIcon size={17} />;
	if (kind === "mcp") return <ListIcon size={17} />;
	return <TaskBoardIcon size={17} />;
}

function RowActions({ row, connector, server, t, ...actions }: RowActionsProps) {
	const { connectorPending, pendingMcp, toggleConnector, toggleMcp, openSettings } = actions;
	const action = !connector && server ? "mcp" : (row.action as CapabilityDrawer);
	const label =
		row.status === "configure" || (connector && row.status === "permission")
			? t("skillsConnections.configure")
			: !connector && !server && row.status === "error"
				? t("skillsConnections.viewReason")
				: t("skillsConnections.view");
	const button = (
		<button
			type="button"
			className="rounded-full border border-border px-3 py-2 text-xs text-ink-2 hover:bg-hover"
			onClick={() => openSettings(action)}
		>
			{label}
		</button>
	);
	if (!connector && !server) return button;
	const checked = connector ? connector.enabled : !server?.disabled;
	return (
		<div className="flex items-center gap-2">
			<Switch
				checked={checked}
				disabled={connector ? connectorPending === connector.id : pendingMcp === server?.name}
				onCheckedChange={(enabled) => {
					if (connector) void toggleConnector(connector);
					else if (server) toggleMcp(server.name, enabled);
				}}
				aria-label={checked ? t("skillsConnections.disable") : t("skillsConnections.enable")}
			/>
			{button}
		</div>
	);
}

export function CapabilityListRow({ row, mcp, connectors, ...actions }: CapabilityListRowProps) {
	const server = row.kind === "mcp" ? mcp?.servers.find((item) => item.name === row.action) : undefined;
	const connector = row.connectorId ? connectors.find((item) => item.id === row.connectorId) : undefined;
	return (
		<div className="grid gap-3 px-4 py-4 md:grid-cols-[minmax(0,2fr)_minmax(140px,1fr)_120px_136px] md:items-center">
			<div className="flex min-w-0 items-start gap-3">
				<span className="mt-0.5 text-ink-dim">
					<IconForKind kind={row.kind} />
				</span>
				<div className="min-w-0">
					<p className="truncate text-sm font-medium text-ink">
						{row.name}
						{row.version ? (
							<span className="ml-2 text-xs font-normal text-ink-faint">v{row.version}</span>
						) : null}
					</p>
					<p className="mt-1 line-clamp-2 text-xs leading-relaxed text-ink-dim">{row.description}</p>
				</div>
			</div>
			<p className="truncate text-xs text-ink-faint" title={row.scope}>
				{row.scope}
			</p>
			{row.status === "available" ? (
				<div />
			) : (
				<div className={`flex items-center gap-2 text-xs font-medium ${statusTone(row.status)}`}>
					<span
						className={`h-2 w-2 rounded-full ${row.status === "running" ? "animate-pulse bg-ok" : row.status === "error" || row.status === "incompatible" ? "bg-err" : row.status === "disabled" ? "bg-ink-faint" : "bg-warn"}`}
					/>
					{actions.t(`skillsConnections.status.${row.status}`)}
				</div>
			)}
			<div className="flex justify-end">
				<RowActions row={row} connector={connector} server={server} {...actions} />
			</div>
		</div>
	);
}
