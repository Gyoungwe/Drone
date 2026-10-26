/**
 * Stable host fallback text used when a knowledge publication projection is
 * unavailable. Keeping this contract in shared lets the generic host fail
 * closed without importing the optional knowledge package.
 */
export const KNOWLEDGE_PUBLICATION_FALLBACK_NOTICE = "回答检查未完成，回答暂未展示。";
