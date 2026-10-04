import type { TaskView } from "../task-workbench";
import type { TurnRoute } from "../turn-route";

export type ProcessLaneId = "entry" | "gate" | "execution" | "evidence" | "deposit" | "answer";
export type ProcessNodeId =
	| "ask"
	| "picked"
	| "doing"
	| "taskGate"
	| "hostGate"
	| "libGate"
	| "local"
	| "inspect"
	| "archived"
	| "read"
	| "bound"
	| "deposit"
	| "wiki"
	| "zotero"
	| "cited"
	| "check"
	| "answer";
export interface ProcessText {
	zh: string;
	en: string;
}
export interface ProcessRead {
	path: string;
	hash: string;
}
export interface ProcessReceipt {
	id: string;
	name: string;
	state: string;
}
export interface ProcessNode {
	id: ProcessNodeId;
	lane: ProcessLaneId;
	state: "active" | "recorded" | "waiting" | "open" | "blocked";
	lines: [ProcessText, ProcessText, ProcessText];
	code?: string;
	route?: TurnRoute;
	demo?: boolean;
	paths?: string[];
	receipts?: ProcessReceipt[];
}
export interface ProcessEdge {
	from: ProcessNodeId;
	to: ProcessNodeId;
	kind: "receipt" | "branch";
}
export interface ProcessLaneState {
	lanes: { id: ProcessLaneId; empty: string }[];
	nodes: ProcessNode[];
	edges: ProcessEdge[];
	current: ProcessNodeId | null;
	turnIndex: number;
	reads: ProcessRead[];
	statusQuery: boolean;
	taskId: string | null;
}
export type ProcessEvent =
	| { type: "user-input"; seq: number; id: string; text: string }
	| { type: "turn-route"; seq: number; id: string; route: TurnRoute }
	| {
			type: "tool-receipt";
			seq: number;
			id: string;
			name: string;
			state: "running" | "done" | "error";
			blockedReason?: string;
			hits?: boolean;
	  }
	| { type: "subagent"; seq: number; id: string; name: string; state: string }
	| { type: "task-view"; seq: number; id: string; view: TaskView; demo?: boolean }
	| { type: "research-stage"; seq: number; id: string; stage: string }
	| { type: "knowledge-read"; seq: number; id: string; read: ProcessRead }
	| { type: "deposit"; seq: number; id: string; kind: string; path?: string }
	| { type: "wiki" | "zotero"; seq: number; id: string; status: string }
	| {
			type: "answer-check";
			seq: number;
			id: string;
			ok: boolean;
			sources: ProcessRead[];
			reason?: string;
			warning?: boolean;
	  };
