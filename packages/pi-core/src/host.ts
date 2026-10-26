/**
 * Versioned host entry for the portable memory persistence contract.
 *
 * Desktop/backend consumers must use this entry instead of reaching through
 * the extension's root implementation path. The implementation remains in
 * pi-core; the host entry is the stable composition boundary.
 */
export {
	MEMORY_INDEX,
	MEMORY_TYPES,
	MAX_INDEX_LINES,
	forgetMemory,
	listMemories,
	memoryDir,
	memorySlug,
	memoryIndexPrompt,
	parseMemory,
	renderMemoryIndex,
	serializeMemory,
	writeMemory,
} from "./memory";
export type { MemoryEntry, MemoryType } from "./memory";
