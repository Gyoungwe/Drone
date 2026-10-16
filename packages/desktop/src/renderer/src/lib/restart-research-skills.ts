import { getPi } from "../api";
import { translate, useI18nStore } from "../i18n";
import { useTranscriptStore } from "../stores/transcript";
import { restartGuarded } from "./install-update";

export function restartForResearchSkillsWithGuard(): Promise<boolean> {
	return restartGuarded({
		sessions: () => Object.values(useTranscriptStore.getState().bySession),
		confirm: (running) =>
			window.confirm(
				translate(useI18nStore.getState().language, "update.confirmRunning", { count: running }),
			),
		install: () => getPi().restartForResearchSkills(),
	});
}
