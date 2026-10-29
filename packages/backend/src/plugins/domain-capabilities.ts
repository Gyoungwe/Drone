/**
 * Read-only view of domain capabilities exposed by the host composition root.
 *
 * The registry is deliberately a mechanism boundary: it records which
 * provider currently owns a domain and why a domain is unavailable. It does
 * not construct domain services and it does not make a missing plugin look
 * like a host fallback. Registration is kept on the concrete class so only
 * the composition root can change availability; consumers receive the small
 * read-only port below.
 */
export type DomainCapabilityStatus = "available" | "degraded" | "unavailable";

export interface DomainCapability {
	readonly id: string;
	readonly status: DomainCapabilityStatus;
	readonly provider: string;
	readonly reason?: string;
}

export interface DomainCapabilityRegistryPort {
	get(id: string): DomainCapability | undefined;
	list(): readonly DomainCapability[];
	isAvailable(id: string): boolean;
}

export interface DomainCapabilityRegistration {
	readonly id: string;
	readonly status: DomainCapabilityStatus;
	readonly provider: string;
	readonly reason?: string;
}

export class DomainCapabilityRegistry implements DomainCapabilityRegistryPort {
	private readonly entries = new Map<string, DomainCapability>();

	register(registration: DomainCapabilityRegistration): void {
		const entry: DomainCapability = {
			id: registration.id,
			status: registration.status,
			provider: registration.provider,
			...(registration.reason ? { reason: registration.reason } : {}),
		};
		this.entries.set(entry.id, entry);
	}

	get(id: string): DomainCapability | undefined {
		const entry = this.entries.get(id);
		return entry ? { ...entry } : undefined;
	}

	list(): readonly DomainCapability[] {
		return [...this.entries.values()].map((entry) => ({ ...entry }));
	}

	isAvailable(id: string): boolean {
		return this.entries.get(id)?.status === "available";
	}
}
