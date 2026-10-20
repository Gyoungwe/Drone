/** A user-managed source of one or more SKILL.md files. */
export type SkillRepositoryKind = "git" | "local";

export interface SkillRepositoryAddInput {
	kind: SkillRepositoryKind;
	/** HTTPS/SSH Git URL when kind is git; absolute directory when kind is local. */
	source: string;
	/** Branch or ref used for Git sources. Defaults to the repository's default branch. */
	ref?: string;
	/** Optional repository-relative directory containing skills. */
	subpath?: string;
	/** User supplied SPDX/license description or a clear permission basis. */
	license: string;
	/** URL or local path to the license/permission evidence. */
	licenseEvidence?: string;
	/** Optional display name. */
	name?: string;
}

export type SkillRepositoryStatus = "ready" | "update-available" | "error";

/** Redacted repository state returned over the renderer IPC boundary. */
export interface SkillRepositoryRecord {
	id: string;
	name: string;
	kind: SkillRepositoryKind;
	source: string;
	ref?: string;
	subpath?: string;
	license: string;
	licenseEvidence?: string;
	status: SkillRepositoryStatus;
	skillCount: number;
	lastCheckedAt?: string;
	lastAppliedAt?: string;
	lastError?: string;
	updateAvailable?: boolean;
}

export interface SkillRepositoryCheckResult {
	repository: SkillRepositoryRecord;
	changedFiles: string[];
}

export interface SkillRepositoryUpdateResult {
	repository: SkillRepositoryRecord;
	changedFiles: string[];
	restartedRequired: true;
}
