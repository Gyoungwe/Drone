import { restartNeedsConfirm, runningTurnCount } from "@drone/shared";

export interface InstallUpdateDeps {
	sessions: () => Iterable<{ agentActive?: boolean; compacting?: boolean } | undefined>;
	confirm: (running: number) => boolean;
	install: () => Promise<void> | void;
}

export async function restartGuarded(deps: InstallUpdateDeps): Promise<boolean> {
	const running = runningTurnCount(deps.sessions());
	if (restartNeedsConfirm(running) && !deps.confirm(running)) return false;
	await deps.install();
	return true;
}

/** P20：有在跑回合时先确认，避免更新重启静默打断任务。返回是否已触发安装。 */
export async function installUpdateGuarded(deps: InstallUpdateDeps): Promise<boolean> {
	return restartGuarded(deps);
}
