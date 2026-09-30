/** Backwards-compatible import path; the implementation lives in session-engine. */
export {
	createEventPipeline,
	createPipeline,
	type EventPipeline,
	type EventPipelineOptions,
	type PipelineError,
	runEventPipeline,
	runPipeline,
	type Stage,
} from "../session-engine/event-pipeline";
