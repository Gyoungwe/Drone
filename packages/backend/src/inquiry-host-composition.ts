import { createComputeInquiryRerunPort } from "./plugins/inquiry-rerun-capability";
import { canonicalProjectId } from "./project-id";
import type { ComputeService } from "./services/compute";
import type { ComputeHostAdapter } from "./services/compute-adapter";
import {
	computeInquiryMetadata,
	type InquiryDecisionEvent,
	type InquiryLocalExecutionEvent,
} from "./services/inquiry-events";
import { LocalExecutionRecorder } from "./services/local-execution";
import type { SessionService } from "./session-service";

interface InquiryHostCompositionOptions {
	readonly computeAgentDir?: string;
	readonly inquiryProjectId?: string;
	readonly defaultCwd?: string;
}

type InquiryHostSessionSource = Pick<SessionService, "onEvent" | "onDecision" | "registry" | "hostEvents"> &
	Partial<Pick<SessionService, "setInquiryRerunPort">>;

export function attachInquiryHostComposition(
	sessions: InquiryHostSessionSource,
	compute: ComputeService,
	computeAdapter: ComputeHostAdapter,
	options: InquiryHostCompositionOptions,
	defaultProjectId: string,
): () => void {
	const detachHostEvents = attachInquiryHostEvents(sessions, compute, options, defaultProjectId);
	sessions.setInquiryRerunPort?.(createComputeInquiryRerunPort(compute, computeAdapter));
	return () => {
		sessions.setInquiryRerunPort?.(undefined);
		detachHostEvents();
	};
}

function attachInquiryHostEvents(
	sessions: InquiryHostSessionSource,
	compute: ComputeService,
	options: InquiryHostCompositionOptions,
	defaultProjectId: string,
): () => void {
	let detached = false;
	const detachCompute = compute.onEvent((event) => {
		if (event.type === "cleanup") return;
		const inquiryEvent = { ...event, type: event.type };
		void compute
			.getJob(event.jobId)
			.then((job) => {
				if (detached) return;
				const projectId = canonicalProjectId(
					job?.spec.workDir ?? options.inquiryProjectId ?? options.defaultCwd ?? process.cwd(),
				);
				sessions.hostEvents.publish("inquiry.compute", {
					...inquiryEvent,
					projectId,
					...(job ? computeInquiryMetadata(job) : {}),
				});
			})
			.catch(() => {
				if (detached) return;
				sessions.hostEvents.publish("inquiry.compute", { ...inquiryEvent, projectId: defaultProjectId });
			});
	});
	const detachTask = sessions.onEvent((sessionId, event) => {
		const value = event as unknown as { type?: string; willRetry?: boolean };
		if (value.type !== "agent_end") return;
		sessions.hostEvents.publish("inquiry.task-terminal", {
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
	});
	const detachDecision = sessions.onDecision((event) =>
		sessions.hostEvents.publish("inquiry.decision", event as InquiryDecisionEvent),
	);
	return () => {
		detached = true;
		detachCompute();
		detachTask();
		detachDecision();
	};
}

export function attachLocalExecutionRecorder(
	sessions: Pick<SessionService, "onEvent" | "registry">,
	options: InquiryHostCompositionOptions,
	scheduleReview: (sessionId: string, paths: readonly string[]) => void,
	publish: (event: InquiryLocalExecutionEvent) => void,
	registerDisposable: (dispose: () => void) => void,
): LocalExecutionRecorder {
	const recorder = new LocalExecutionRecorder({
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
