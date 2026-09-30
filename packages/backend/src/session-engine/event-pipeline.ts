/**
 * A4 compatibility entrypoint.
 *
 * The pipeline implementation remains in the session support module while the
 * session-engine boundary adopts the architecture-v2 path. Keeping this file as
 * a typed re-export avoids two independent pipeline implementations during the
 * migration.
 */
export {
	createEventPipeline,
	createPipeline,
	type EventPipeline,
	type EventPipelineOptions,
	type PipelineError,
	runEventPipeline,
	runPipeline,
	type Stage,
} from "../session/event-pipeline";
