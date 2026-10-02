import { join } from "node:path";
import {
	InquiryService as DomainInquiryService,
	type InquiryStorage,
	SqliteInquiryStorage,
} from "@drone/inquiry";

/** Backend composition-root adapter for the host-injected inquiry domain. */
export interface InquiryServiceOptions {
	/** Directory registered as `inquiry-root`; the SQLite file is created inside it. */
	readonly inquiryDir?: string;
	/** Stable project identity. Callers should supply a project id when multiple projects share a host. */
	readonly projectId?: string;
}

export interface InquiryServicePort {
	readonly enabled: boolean;
	readonly storage?: InquiryStorage;
	readonly domain?: DomainInquiryService;
	dispose(): void;
}

/**
 * No UI, compute or remote side effects are performed here. When no inquiry
 * root is configured the service stays disabled and does not touch the disk.
 */
export class InquiryService implements InquiryServicePort {
	readonly enabled: boolean;
	readonly storage?: SqliteInquiryStorage;
	readonly domain?: DomainInquiryService;

	constructor(options: InquiryServiceOptions = {}) {
		if (!options.inquiryDir) {
			this.enabled = false;
			return;
		}
		const projectId = options.projectId?.trim();
		if (!projectId) throw new Error("inquiryProjectId is required when inquiryDir is configured");
		this.storage = new SqliteInquiryStorage(projectId, join(options.inquiryDir, "ledger.sqlite"));
		this.domain = new DomainInquiryService(this.storage);
		this.enabled = true;
	}

	dispose(): void {
		if (this.storage) void this.storage.close();
	}
}
