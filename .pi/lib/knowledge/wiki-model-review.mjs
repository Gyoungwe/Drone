/** Compatibility adapter. Domain implementation lives in @drone/knowledge. */
import { consumeKnowledgeReviewPreview } from "./ui-service.mjs";
import { specialistSettings } from "./specialist-host.mjs";
import { configureKnowledgeHost } from "./runtime/runtime-host.mjs";
configureKnowledgeHost({ consumeKnowledgeReviewPreview, specialistSettings });
export * from "./runtime/wiki-model-review.mjs";
