import type { ZoteroStatus } from "@drone/shared";
import { getZoteroStatus } from "../zotero/status";

/**
 * Zotero integration boundary used by host adapters.
 *
 * The status probe itself remains in the Zotero domain module so existing
 * imports and tests keep working.  This small service gives the composition
 * root an explicit domain object and keeps desktop IPC from reaching through
 * the PiBackend compatibility façade.
 */
export interface ZoteroServicePort {
	getStatus(): Promise<ZoteroStatus>;
}

export class ZoteroService implements ZoteroServicePort {
	getStatus(): Promise<ZoteroStatus> {
		return getZoteroStatus();
	}
}
