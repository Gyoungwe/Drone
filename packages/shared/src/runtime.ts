/** Explicit runtime contracts used while migrating legacy global bridges. */
export interface KeyedLocks {
  acquire(key: string): Promise<() => void>;
  run<T>(key: string, task: () => T | Promise<T>): Promise<T>;
  dispose(): Promise<void>;
}
export interface Logger {
  debug?(message: string, context?: unknown): void;
  info?(message: string, context?: unknown): void;
  warn?(message: string, context?: unknown): void;
  error?(message: string, context?: unknown): void;
}
export interface KnowledgeRuntime {
  publication?: KnowledgePublicationBridge;
  binding?: KnowledgeBindingBridge;
  workerPool?: unknown;
  specialists?: unknown;
}
export interface TaskRuntime {
  workbench?: unknown;
  acceptance?: AcceptanceVerifiersBridge;
  consent?: unknown;
}
export interface ToolManifestRegistry {
  tools: Map<string, unknown>;
  families?: Map<string, unknown>;
  register?(name: string, definition: unknown): void;
}
export interface KnowledgePublicationBridge {
  projectEvent?: (event: unknown) => unknown;
  projectSnapshot?: (messages: unknown[], persisted: unknown[]) => unknown[];
}
export interface KnowledgeBindingBridge { get?(): unknown; current?: unknown; }
export interface AcceptanceVerifiersBridge { verifiers?: Map<string, unknown>; register?(name: string, verifier: unknown): void; }
export interface UiBridge { plugins?: Map<string, unknown>; [key: string]: unknown; }
export interface WorkerPoolBridge { run?<T>(task: () => T | Promise<T>): Promise<T>; dispose?(): Promise<void> | void; }
export interface QueueBridge { enqueue?<T>(task: () => T | Promise<T>): Promise<T>; dispose?(): Promise<void> | void; }

export const DRONE_KNOWLEDGE_PUBLICATION_KEY = Symbol.for("drone.knowledge.publication.v1");
export const DRONE_TOOL_MANIFEST_KEY = Symbol.for("drone.tool-manifest.v1");
export const DRONE_WIKI_REVIEW_LOCKS_KEY = Symbol.for("drone.wiki-review-locks.v1");
export const DRONE_TOPIC_MEMORY_QUEUES_KEY = Symbol.for("drone.topic-memory-queues.v1");
export const DRONE_SEMANTIC_LOCK_KEY = Symbol.for("drone.semantic-lock.v1");
export const DRONE_WORKER_POOL_KEY = Symbol.for("drone.worker-pool.v1");
export const DRONE_KNOWLEDGE_BINDING_KEY = Symbol.for("drone.knowledge-binding.v1");
export const DRONE_UI_KEY = Symbol.for("drone.ui.v1");
export const DRONE_SPECIALISTS_KEY = Symbol.for("drone.specialists.v1");
export const DRONE_ACCEPTANCE_VERIFIERS_KEY = Symbol.for("drone.acceptance-verifiers.v1");

export interface DroneRuntime {
  knowledge: KnowledgeRuntime;
  tasks: TaskRuntime;
  tools: ToolManifestRegistry;
  scheduler: KeyedLocks;
  log: Logger;
  dispose(): Promise<void>;
}

/** Descriptive aliases retained for consumers that prefer the bridge terminology. */
export const KNOWLEDGE_PUBLICATION_BRIDGE_KEY = DRONE_KNOWLEDGE_PUBLICATION_KEY;
export const TOOL_MANIFEST_BRIDGE_KEY = DRONE_TOOL_MANIFEST_KEY;
export const WIKI_REVIEW_LOCKS_BRIDGE_KEY = DRONE_WIKI_REVIEW_LOCKS_KEY;
export const TOPIC_MEMORY_QUEUES_BRIDGE_KEY = DRONE_TOPIC_MEMORY_QUEUES_KEY;
export const SEMANTIC_LOCK_BRIDGE_KEY = DRONE_SEMANTIC_LOCK_KEY;
export const WORKER_POOL_BRIDGE_KEY = DRONE_WORKER_POOL_KEY;
export const KNOWLEDGE_BINDING_BRIDGE_KEY = DRONE_KNOWLEDGE_BINDING_KEY;
export const UI_BRIDGE_KEY = DRONE_UI_KEY;
export const SPECIALISTS_BRIDGE_KEY = DRONE_SPECIALISTS_KEY;
export const ACCEPTANCE_VERIFIERS_BRIDGE_KEY = DRONE_ACCEPTANCE_VERIFIERS_KEY;
