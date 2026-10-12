/** 回合结束事件（P11）：transcript store 只发信号，不依赖 i18n / 通知实现，由 App 订阅。 */
type Listener = (sessionId: string) => void;
const listeners = new Set<Listener>();

export function onTurnSettled(listener: Listener): () => void {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

export function emitTurnSettled(sessionId: string): void {
	for (const l of listeners) l(sessionId);
}
