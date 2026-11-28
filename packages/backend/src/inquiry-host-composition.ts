import { canonicalProjectId } from "./project-id";
import type { ComputeService } from "./services/compute";
import type { ComputeHostAdapter } from "./services/compute-adapter";
import type {
	InquiryComputeEvent,
	InquiryDecisionEvent,
	InquiryLocalExecutionEvent,
	InquiryService,
	InquiryTaskTerminalEvent,
} from "./services/inquiry";
import {
	computeInquiryMetadata,
	createInquiryComputeRerun,
	createInquiryComputeRerunCompletion,
} from "./services/inquiry-compute";
import { LocalExecutionRecorder } from "./services/local-execution";
import { getAgentDir } from "./session-engine/engine";
import type { SessionService } from "./session-service";

interface InquiryHostCompositionOptions {
	readonly computeAgentDir?: string;
	readonly inquiryProjectId?: string;
	readonly defaultCwd?: string;
}
type InquiryHostSessionSource = Pick<SessionService, "onEvent" | "onDecision" | "registry" | "hostEvents"> &
	Partial<Pick<SessionService, "setInquiryRerunPort">>;
export function attachInquiryHostComposition(
	inquiry: InquiryService,
	sessions: InquiryHostSessionSource,
	compute: ComputeService,
	computeAdapter: ComputeHostAdapter,
	options: InquiryHostCompositionOptions,
	defaultProjectId: string,
): () => void {
	const detachInquiryComputeEvents = attachInquiryComputeEvents(
		inquiry,
		sessions,
		compute,
		options,
		defaultProjectId,
	);
	attachInquiryComputeReruns(inquiry, compute, computeAdapter, options);
	sessions.setInquiryRerunPort?.(inquiry);
	return () => {
		sessions.setInquiryRerunPort?.(undefined);
		detachInquiryComputeEvents();
	};
}
function attachInquiryComputeEvents(
	inquiry: InquiryService,
	sessions: InquiryHostSessionSource,
	compute: ComputeService,
	options: InquiryHostCompositionOptions,
	defaultProjectId: string,
): () => void {
	const computeEvents = createEventFanout<InquiryComputeEvent>((emit) =>
		compute.onEvent((event) => {
			if (event.type === "cleanup") return;
			const inquiryEvent = { ...event, type: event.type };
			void compute
				.getJob(event.jobId)
				.then((job) => {
					const projectId = canonicalProjectId(
						job?.spec.workDir ?? options.inquiryProjectId ?? options.defaultCwd ?? process.cwd(),
					);
					emit({ ...inquiryEvent, projectId, ...(job ? computeInquiryMetadata(job) : {}) });
				})
				.catch(() => emit({ ...inquiryEvent, projectId: defaultProjectId }));
		}),
	);
	const taskEvents = createEventFanout<InquiryTaskTerminalEvent>((emit) =>
		sessions.onEvent((sessionId, event) => {
			const value = event as unknown as { type?: string; willRetry?: boolean };
			if (value.type !== "agent_end") return;
			emit({
				id: `session:${sessionId}:${Date.now()}`,
				taskId: sessionId,
				status: value.willRetry ? "partial" : "succeeded",
				at: Date.now(),
				projectId: canonicalProjectId(
					sessions.registry.get(sessionId)?.cwd ??
						options.inquiryProjectId ??
						options.defaultCwd ??
						process.cwd(),
				),
				sessionId,
			});
		}),
	);
	const decisionEvents = createEventFanout<InquiryDecisionEvent>((emit) =>
		sessions.onDecision((event) => emit(event as InquiryDecisionEvent)),
	);
	const detachInquiry = inquiry.attachEventSource({
		onComputeEvent: computeEvents,
		onTaskTerminal: taskEvents,
		onDecision: decisionEvents,
	});
	const detachHost = [
		computeEvents((event) => sessions.hostEvents.publish("inquiry.compute", event)),
		taskEvents((event) => sessions.hostEvents.publish("inquiry.task-terminal", event)),
		decisionEvents((event) => sessions.hostEvents.publish("inquiry.decision", event)),
	];
	return () => {
		for (const detach of [detachInquiry, ...detachHost]) detach();
	};
}
function createEventFanout<T>(
	attach: (emit: (event: T) => void) => () => void,
): (listener: (event: T) => void) => () => void {
	const listeners = new Set<(event: T) => void>();
	let detach: (() => void) | undefined;
	return (listener) => {
		const subscription = (event: T) => listener(event);
		listeners.add(subscription);
		detach ??= attach((event) => {
			for (const current of [...listeners]) if (listeners.has(current)) current(event);
		});
		let active = true;
		return () => {
			if (!active) return;
			active = false;
			listeners.delete(subscription);
			if (!listeners.size) {
				detach?.();
				detach = undefined;
			}
		};
	};
}
export function attachLocalExecutionRecorder(
	inquiry: InquiryService,
	sessions: Pick<SessionService, "onEvent" | "registry">,
	options: InquiryHostCompositionOptions,
	scheduleReview: (sessionId: string, paths: readonly string[]) => void,
	publish: (event: InquiryLocalExecutionEvent) => void,
	registerDisposable: (dispose: () => void) => void,
): LocalExecutionRecorder {
	const recorder = new LocalExecutionRecorder({
		inquiry,
		getCwd: (sessionId) => sessions.registry.get(sessionId)?.cwd,
		getProjectId: (sessionId) =>
			canonicalProjectId(
				sessions.registry.get(sessionId)?.cwd ??
					options.inquiryProjectId ??
					options.defaultCwd ??
					process.cwd(),
			),
		scheduleReview,
		publish,
	});
	registerDisposable(sessions.onEvent((sessionId, event) => recorder.observe(sessionId, event)));
	return recorder;
}
function attachInquiryComputeReruns(
	inquiry: InquiryService,
	compute: ComputeService,
	computeAdapter: ComputeHostAdapter,
	options: InquiryHostCompositionOptions,
): void {
	inquiry.setRerunHandler(
		createInquiryComputeRerun({
			adapter: computeAdapter,
			compute,
			collectionRoot: options.computeAgentDir ?? getAgentDir(),
			drainEvents: () => inquiry.drainEvents(),
		}),
	);
	inquiry.setRerunCompletionHandler(
		createInquiryComputeRerunCompletion({
			compute,
			collectionRoot: options.computeAgentDir ?? getAgentDir(),
			drainEvents: () => inquiry.drainEvents(),
		}),
	);
}
