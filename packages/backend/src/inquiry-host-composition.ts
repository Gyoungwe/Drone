import { canonicalProjectId } from "./project-id";
import type { ComputeService } from "./services/compute";
import type { ComputeHostAdapter } from "./services/compute-adapter";
import type { InquiryDecisionEvent, InquiryService } from "./services/inquiry";
import {
	computeInquiryMetadata,
	createInquiryComputeRerun,
	createInquiryComputeRerunCompletion,
} from "./services/inquiry-compute";
import { getAgentDir } from "./session-engine/engine";
import type { SessionService } from "./session-service";

interface InquiryHostCompositionOptions {
	readonly computeAgentDir?: string;
	readonly inquiryProjectId?: string;
	readonly defaultCwd?: string;
}

type InquiryHostSessionSource = Pick<SessionService, "onEvent" | "onDecision" | "registry">;

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
	return detachInquiryComputeEvents;
}

function attachInquiryComputeEvents(
	inquiry: InquiryService,
	sessions: InquiryHostSessionSource,
	compute: ComputeService,
	options: InquiryHostCompositionOptions,
	defaultProjectId: string,
): () => void {
	const detachInquiryComputeEvents = inquiry.attachEventSource({
		onComputeEvent: (handler) =>
			compute.onEvent((event) => {
				// Cleanup isn't an outcome; Inquiry would record its unchanged terminal status as a new attempt.
				if (event.type === "cleanup") return;
				const inquiryEvent = { ...event, type: event.type };
				void compute
					.getJob(event.jobId)
					.then((job) => {
						const projectId = canonicalProjectId(
							job?.spec.workDir ?? options.inquiryProjectId ?? options.defaultCwd ?? process.cwd(),
						);
						handler({ ...inquiryEvent, projectId, ...(job ? computeInquiryMetadata(job) : {}) });
					})
					.catch(() => handler({ ...inquiryEvent, projectId: defaultProjectId }));
			}),
		onTaskTerminal: (handler) =>
			sessions.onEvent((sessionId, event) => {
				const value = event as unknown as { type?: string; willRetry?: boolean };
				if (value.type !== "agent_end") return;
				handler({
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
		onDecision: (handler) => sessions.onDecision((event) => handler(event as InquiryDecisionEvent)),
	});
	return detachInquiryComputeEvents;
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
