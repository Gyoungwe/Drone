/** Private transport metadata. It never belongs to a plugin operation DTO or an SDK message. */
export interface NativeMessageReferences {
	readonly message?: string;
	readonly messages?: readonly (string | null)[];
}
interface Association {
	readonly reference: string;
	readonly fingerprint: string;
}

/** Parent authority is attached to actual invocation/SDK objects, never copied JSON fields. */
export class NativeMessageCourier {
	private readonly associations = new WeakMap<object, Association>();

	private reference(message: unknown): string | null {
		if (message === null || typeof message !== "object") return null;
		const known = this.associations.get(message);
		if (!known || known.fingerprint !== JSON.stringify(message)) return null;
		return known.reference;
	}

	encode(value: unknown): NativeMessageReferences {
		if (value === null || typeof value !== "object") return {};
		const carrier = value as { message?: unknown; messages?: unknown };
		const reference = this.reference(carrier.message);
		return {
			...(reference === null ? {} : { message: reference }),
			...(Array.isArray(carrier.messages)
				? { messages: carrier.messages.map((message) => this.reference(message)) }
				: {}),
		};
	}

	/** Called only on the actual returned envelope of its pending private native invocation. */
	remember(value: unknown, references: NativeMessageReferences, original?: object): void {
		if (value === null || typeof value !== "object") throw new Error("Invalid native message carrier");
		const carrier = value as { message?: unknown; messages?: unknown };
		if (references.message !== undefined) {
			const association = this.rememberMessage(carrier.message, references.message);
			// message_end replaces this exact SDK object in place after the handler returns.
			if (original) this.associations.set(original, association);
		}
		if (references.messages !== undefined) {
			if (!Array.isArray(carrier.messages) || carrier.messages.length !== references.messages.length)
				throw new Error("Invalid native message reference list");
			for (const [index, reference] of references.messages.entries())
				if (reference !== null) this.rememberMessage(carrier.messages[index], reference);
		}
	}

	private rememberMessage(message: unknown, reference: string): Association {
		if (message === null || typeof message !== "object") throw new Error("Invalid native message reference");
		const association = { reference, fingerprint: JSON.stringify(message) };
		this.associations.set(message, association);
		return association;
	}
}
