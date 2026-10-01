/** Compatibility adapter. Domain implementation lives in @drone/knowledge. */
import { consumeKnowledgeReviewPreview } from "./ui-service.mjs";
import { specialistSettings } from "./specialist-host.mjs";
import { configureKnowledgeHost } from "../../../packages/knowledge/src/runtime-host.ts";
configureKnowledgeHost({ consumeKnowledgeReviewPreview, specialistSettings });
export * from "../../../packages/knowledge/src/wiki-model-review.ts";
