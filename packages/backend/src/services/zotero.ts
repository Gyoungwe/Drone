import type {
	ZoteroLocalWriteStatus,
	ZoteroStatus,
	ZoteroWebApiSaveInput,
	ZoteroWebApiStatus,
} from "@drone/shared";
import {
	authorizeZoteroLocalWrite,
	clearZoteroLocalWrite,
	getZoteroLocalWriteStatus,
} from "../zotero/local-write";
import { getZoteroStatus } from "../zotero/status";
import {
	clearZoteroWebCredentials,
	getZoteroWebApiStatus,
	saveZoteroWebCredentials,
} from "../zotero/web-credentials";

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
	/** 网页 API（修改已有条目）配置状态，不含密钥 */
	getWebApi?(): Promise<ZoteroWebApiStatus>;
	saveWebApi?(input: ZoteroWebApiSaveInput): Promise<ZoteroWebApiStatus>;
	clearWebApi?(): Promise<ZoteroWebApiStatus>;
	/** Zotero 10+ 本机写入授权状态，不含 key */
	getLocalWrite?(): Promise<ZoteroLocalWriteStatus>;
	authorizeLocalWrite?(): Promise<ZoteroLocalWriteStatus>;
	clearLocalWrite?(): Promise<ZoteroLocalWriteStatus>;
}

export class ZoteroService implements ZoteroServicePort {
	getStatus(): Promise<ZoteroStatus> {
		return getZoteroStatus();
	}

	getWebApi(): Promise<ZoteroWebApiStatus> {
		return getZoteroWebApiStatus();
	}

	saveWebApi(input: ZoteroWebApiSaveInput): Promise<ZoteroWebApiStatus> {
		return saveZoteroWebCredentials(input);
	}

	clearWebApi(): Promise<ZoteroWebApiStatus> {
		return clearZoteroWebCredentials();
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
