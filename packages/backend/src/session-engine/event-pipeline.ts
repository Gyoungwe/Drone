/** A named event processing stage and its failure semantics. */
export interface Stage<Event = unknown, Context = unknown> {
	name: string;
	failMode: "closed" | "open";
	run(event: Event, context: Context): Event | null;
}

export interface PipelineError<Event = unknown, Context = unknown> {
	stage: Stage<Event, Context>;
	error: unknown;
	event: Event;
	context: Context;
}

export interface EventPipelineOptions<Event = unknown, Context = unknown> {
	/** Receives failures from open stages. */
	onError?: (failure: PipelineError<Event, Context>) => void;
}

export interface EventPipeline<Event = unknown, Context = unknown> {
	readonly stages: readonly Stage<Event, Context>[];
	run(event: Event, context: Context): Event | null;
}

/** Build a reusable, ordered event pipeline. */
export function createEventPipeline<Event, Context = undefined>(
	stages: readonly Stage<Event, Context>[],
	options: EventPipelineOptions<Event, Context> = {},
): EventPipeline<Event, Context> {
	const orderedStages = [...stages];
	return {
		stages: orderedStages,
		run(event, context) {
			let current: Event | null = event;
			for (const stage of orderedStages) {
				if (current === null) return null;
				const input: Event = current;
				try {
					current = stage.run(input, context);
				} catch (error) {
					if (stage.failMode === "closed") return null;
					options.onError?.({ stage, error, event: input, context });
					// An open stage failed; preserve the last valid event and continue.
					current = input;
				}
			}
			return current;
		},
	};
}

/** Run stages once without retaining a pipeline object. */
export function runEventPipeline<Event, Context = undefined>(
	stages: readonly Stage<Event, Context>[],
	event: Event,
	context: Context,
	options?: EventPipelineOptions<Event, Context>,
): Event | null {
	return createEventPipeline(stages, options).run(event, context);
}

// Short aliases for callers that already use the generic pipeline terminology.
export const createPipeline = createEventPipeline;
export const runPipeline = runEventPipeline;
