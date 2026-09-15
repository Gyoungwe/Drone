/**
 * 乐观更新控制流：先应用乐观态，再同步后端；同步失败则回滚并交给调用方善后。
 *
 * 契约：
 * - `apply` 恒执行（乐观态 + 任何随手的 fire-and-forget 持久化都放这里）。
 * - `sync` 仅 await 一次；draft / 纯本地场景传 no-op（无抛出 → 不回滚）。
 * - `sync` 抛出时先 `revert`（可异步，如从磁盘重读真值）再 `onError`——回滚永远早于错误善后。
 *
 * 把「乐观→同步→失败回滚→提示」这条控制流收进一个接口：调用点只声明各自的
 * apply/sync/revert/onError 差异，不再各自手抄 try/catch。
 */
export async function optimisticUpdate(opts: {
	apply: () => void;
	sync: () => Promise<void>;
	revert: () => void | Promise<void>;
	onError: (error: unknown) => void;
}): Promise<void> {
	opts.apply();
	try {
		await opts.sync();
	} catch (error) {
		await opts.revert();
		opts.onError(error);
	}
}
