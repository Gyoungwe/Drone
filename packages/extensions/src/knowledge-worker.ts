// Dedicated worker resource for the generated `.pi/extensions` graph. It is
// intentionally not a Pi extension entry: the workbench runtime starts it via
// worker_threads when indexing the knowledge Vault.
import "@drone/knowledge/worker";
