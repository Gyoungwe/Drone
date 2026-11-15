import type { ZoteroLocalWriteStatus, ZoteroStatus } from "@drone/shared";
import {
	authorizeZoteroLocalWrite,
	clearZoteroLocalWrite,
	getZoteroLocalWriteStatus,
} from "../zotero/local-write";
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
	/** Zotero 10+ 本机写入授权状态，不含 key */
	getLocalWrite?(): Promise<ZoteroLocalWriteStatus>;
	authorizeLocalWrite?(): Promise<ZoteroLocalWriteStatus>;
	clearLocalWrite?(): Promise<ZoteroLocalWriteStatus>;
}

export class ZoteroService implements ZoteroServicePort {
	getStatus(): Promise<ZoteroStatus> {
		return getZoteroStatus();
	}

	getLocalWrite(): Promise<ZoteroLocalWriteStatus> {
		return getZoteroLocalWriteStatus();
	}

	authorizeLocalWrite(): Promise<ZoteroLocalWriteStatus> {
		return authorizeZoteroLocalWrite();
	}

	clearLocalWrite(): Promise<ZoteroLocalWriteStatus> {
		return clearZoteroLocalWrite();
	}
}
