import type { AppUiPort, InstitutionalUiPort, KnowledgeUiPort } from "@gyoungwe/plugin-api/ui";
import { getPi } from "../api";

/**
 * The routed knowledge boundary.
 *
 * Each domain group keeps one neutral channel: the operation name inside the
 * envelope selects the implementation, and the host rejects a name that is not
 * in its route table.  The host names no domain method here, so a new domain
 * operation needs no new projection.
 */
export const knowledgeUiPort: KnowledgeUiPort = {
	knowledge: {
		invoke: (operation, input) => getPi().invokeKnowledge({ operation, input }),
	},
	daily: {
		invoke: (operation, input) => getPi().invokeDaily({ operation, input }),
	},
	zotero: {
		invoke: (operation, input) => getPi().invokeZotero({ operation, input }),
	},
};

/** Host filesystem mechanisms a plugin may ask for; both resolve to `null` when declined. */
export const appUiPort: AppUiPort = {
	pickDirectory: () => getPi().pickDirectory(),
	formalKnowledgeVault: () => getPi().formalKnowledgeVault(),
};

/** The legal institutional access channel: configuration, session, and reachability. */
export const institutionalUiPort: InstitutionalUiPort = {
	getStatus: () => getPi().getInstitutionalStatus(),
	saveConfig: (input) => getPi().saveInstitutionalConfig(input),
	openLogin: (url) => getPi().openInstitutionalLogin(url),
	openUrl: (url) => getPi().openInstitutionalUrl(url),
	clear: () => getPi().clearInstitutionalSession(),
	testAccess: (url) => getPi().testInstitutionalAccess(url),
};
