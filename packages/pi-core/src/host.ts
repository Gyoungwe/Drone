/**
 * Versioned host entry for portable backend-facing contracts.
 *
 * Desktop/backend consumers must use this entry instead of reaching through
 * the extension's root implementation path. The implementation remains in
 * pi-core; the host entry is the stable composition boundary.
 */
export type { MemoryEntry, MemoryType } from "./memory";
export {
	forgetMemory,
	listMemories,
	MAX_INDEX_LINES,
	MEMORY_INDEX,
	MEMORY_TYPES,
	memoryDir,
	memoryIndexPrompt,
	memorySlug,
	parseMemory,
	renderMemoryIndex,
	serializeMemory,
	writeMemory,
} from "./memory";
export type { DeliverFilesDetails } from "./tools/deliver-files";
export { deliverFilesParams, makeDeliverFilesTool } from "./tools/deliver-files";
// Keep the legacy backend facades on the same versioned entry as memory.  The
// host entry is bundled and checked as a public package boundary; consumers do
// not reach through the extension root or private source paths.
export type { MemorySaveDetails } from "./tools/memory-save";
export { MEMORY_SAVE_TOOL, makeMemorySaveTool } from "./tools/memory-save";
export type { StatusToolDetails } from "./tools/status";
export { makeStatusTool } from "./tools/status";
export { formatTodoList, makeTodoTool, normalizeTodos } from "./tools/todo";
