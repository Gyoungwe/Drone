import {
	createPluginWriterAuthority,
	type P5AdoptedWriter,
	type PluginFileCapabilities,
	type PluginRootGrant,
} from "@drone/backend";

export interface P5WriterQuery {
	adopt(writer: P5AdoptedWriter): void;
	release(attachment: object): void;
	authorizeDelivery(writer: P5AdoptedWriter): Promise<boolean>;
}

const queries = new WeakMap<object, P5WriterQuery>();

export function p5WriterQueryFor(activation: object): P5WriterQuery | undefined {
	return queries.get(activation);
}

/** The disposer stays in MAIN; neither adoption nor query lookup is a worker capability. */
export function registerP5WriterQuery(
	activation: { signal: AbortSignal },
	grants: readonly PluginRootGrant[],
	ports: PluginFileCapabilities,
): (() => void) | undefined {
	if (!grants.some((grant) => grant.stateWrite || grant.binaryStateWrite)) return undefined;
	let adopted: P5AdoptedWriter | undefined;
	let disposed = false;
	const currentWriter = () => {
		const writer = adopted;
		if (disposed || activation.signal.aborted || !writer) return undefined;
		return grants.some(
			(grant) => grant.handle === writer.rootHandle && (grant.stateWrite || grant.binaryStateWrite),
		)
			? writer
			: undefined;
	};
	const authority = createPluginWriterAuthority(ports.writerAuthority(), currentWriter);
	const query: P5WriterQuery = {
		adopt(writer) {
			adopted = writer;
		},
		release(attachment) {
			if (adopted?.attachment === attachment) adopted = undefined;
		},
		authorizeDelivery: authority.authorizeDelivery,
	};
	queries.set(activation, query);
	return () => {
		disposed = true;
		adopted = undefined;
		queries.delete(activation);
	};
}
