/**
 * Emit a versioned cross-loader event without widening Node's Process
 * overloads throughout the runtime modules.
 *
 * @param {string} event
 * @param {...any} args
 */
export function emitProcessEvent(event, ...args) {
	/** @type {any} */ (process).emit(event, ...args);
}
