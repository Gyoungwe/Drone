/** P20：重启安装更新前检查在跑回合（纯函数）。 */
export interface RunningProbe {
	agentActive?: boolean;
	compacting?: boolean;
}

export function runningTurnCount(sessions: Iterable<RunningProbe | undefined>): number {
	let n = 0;
	for (const s of sessions) if (s?.agentActive || s?.compacting) n++;
	return n;
}

/** 没有在跑回合 → 直接重启；否则需用户确认（会中断这些回合）。 */
export function restartNeedsConfirm(running: number): boolean {
	return running > 0;
}
