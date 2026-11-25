/**
 * Host mechanism ports that are not domain operations.
 *
 * Domain data travels through the neutral knowledge routes; these two
 * namespaces carry host mechanisms that a plugin may call but that the host
 * owns: choosing a directory on disk, and the institutional access channel.
 */
import type { InstitutionalStatus, InstitutionalTestResult } from "./ui-wire-services.js";

/** Save the institutional access configuration; the host persists it for the user. */
export interface InstitutionalSaveInput {
	ezproxyTemplate?: string;
	openUrlResolver?: string;
	institutionName?: string;
	autoDownloadEnabled?: boolean;
	perTaskLimit?: number;
}

/** The legal institutional access channel: configuration, session, and reachability. */
export interface InstitutionalUiPort {
	getStatus(): Promise<InstitutionalStatus>;
	saveConfig(input: InstitutionalSaveInput): Promise<InstitutionalStatus>;
	openLogin(url?: string): Promise<{ url: string }>;
	openUrl(url: string): Promise<{ url: string }>;
	clear(): Promise<InstitutionalStatus>;
	testAccess(url: string): Promise<InstitutionalTestResult>;
}

/** Host filesystem mechanisms a plugin may ask for; both resolve to `null` when declined. */
export interface AppUiPort {
	pickDirectory(): Promise<string | null>;
	formalKnowledgeVault(): Promise<string | null>;
}
