import { randomUUID } from "node:crypto";
import {
	type CausalEnvelope,
	type CausalId,
	causalId,
	childCausalEnvelope,
	createCausalEnvelope,
	type RunAttemptId,
	runAttemptId,
} from "@drone/shared";

export function newRunAttemptId(): RunAttemptId {
	return runAttemptId(`run:${randomUUID()}`);
}

export function newEventId(): CausalId {
	return causalId(`event:${randomUUID()}`, "Event ID");
}

export function rootCausalEnvelope(id = newRunAttemptId()): CausalEnvelope {
	return createCausalEnvelope({ eventId: newEventId(), runAttemptId: id });
}

export function nextCausalEnvelope(
	parent: CausalEnvelope | undefined,
	input: { readonly runAttemptId?: RunAttemptId } = {},
): CausalEnvelope | undefined {
	return childCausalEnvelope(parent, { eventId: newEventId(), ...input });
}
