// @ts-nocheck
import {
  lastWikiModelReview,
  reviewWikiWithModel
} from "./chunks/chunk-XMIU2T7G.mjs";
import {
  MANAGED_END,
  MANAGED_START,
  immutableWikiProposalHash,
  managedParts,
  proposedWikiText,
  targetWikiPath,
  validateSpecialistHtml,
  validateWikiSourcePaths
} from "./chunks/chunk-AKW2CMNR.mjs";
import {
  saveSpecialistExplainer
} from "./chunks/chunk-GMBJR4N3.mjs";
import {
  createKnowledgeSpecialists,
  knowledgeReadStart,
  shouldOrientKnowledge
} from "./chunks/chunk-IMVE6DZY.mjs";
import {
  createTaskFeedback,
  guardResearchToolResult
} from "./chunks/chunk-YQFL2X6C.mjs";
import {
  createToolBudget
} from "./chunks/chunk-BHQUJ6MZ.mjs";
import {
  autoTopicCandidate
} from "./chunks/chunk-P4SVSIRY.mjs";
import {
  TOPIC_MEMORY_LIMITS,
  TOPIC_MEMORY_VERSION,
  archiveTopic,
  classifyTopic,
  createTopicMemory,
  listTopics,
  readTopic,
  topicRunHash,
  updateTopic
} from "./chunks/chunk-NW54BXAU.mjs";
import {
  archiveKnowledgeTopic,
  cancelKnowledgeSemanticIndex,
  consumeKnowledgeReviewPreview,
  dailyDiscoveryContext,
  getKnowledgeTopics,
  indexKnowledgeSemantic,
  knowledgeDecideReview,
  knowledgeGraph,
  knowledgeJobs,
  knowledgeMaintenance,
  knowledgeNoteLinks,
  knowledgeOpenTarget,
  knowledgeOverview,
  knowledgePreviewReview,
  knowledgeReadNote,
  knowledgeReviews,
  knowledgeSemanticStatus,
  knowledgeSetupPreview,
  knowledgeSpecialistSettings,
  saveDiscoveryIdea,
  saveKnowledgeSemanticSettings,
  searchKnowledge,
  testKnowledgeSemanticProvider
} from "./chunks/chunk-4N3CQY4U.mjs";
import {
  autoApplyWikiProposal,
  decideWikiProposal,
  listWikiProposals,
  mergeWikiProposal,
  previewWikiProposal,
  stageWikiProposal,
  undoWikiUpdate,
  validateWikiSourcePaths as validateWikiSourcePaths2,
  wikiHistory
} from "./chunks/chunk-4QHZ475S.mjs";
import {
  SPECIALIST_LIMITS,
  contextSessionId,
  knowledgeSpecialistHost,
  registerKnowledgeSpecialistHost,
  setSpecialistSettings,
  specialistQueueSnapshot,
  specialistSettings,
  withSpecialistSlot
} from "./chunks/chunk-XSFQUT2B.mjs";
import {
  buildKnowledgeSearchExpression,
  splitKnowledgeChunks,
  tokenizeKnowledgeText
} from "./chunks/chunk-4LTSNIAR.mjs";
import {
  assignCommunities,
  classifyRelation,
  createSemanticModel,
  isInfrastructureNode,
  nodeType
} from "./chunks/chunk-W74KFO4J.mjs";
import {
  normalizeSourceLinks,
  onlineSourceLink
} from "./chunks/chunk-LE6NM7SB.mjs";
import {
  runNavigationMaintenance,
  updateNavigation
} from "./chunks/chunk-EJFIMVBU.mjs";
import {
  SPECIALIST_DECISIONS,
  createSpecialistBudget,
  decideSpecialistRun,
  specialistRequestSignature
} from "./chunks/chunk-BRQ6C4CR.mjs";
import {
  projectKnowledgeEvent,
  projectKnowledgeSnapshot,
  registerAnswerPublication
} from "./chunks/chunk-7CZDQL3H.mjs";
import {
  evaluateMetacognitivePublication
} from "./chunks/chunk-TT3YMRLM.mjs";
import {
  advisoryLine,
  advisoryNotice,
  knowledgeFailure,
  publicationFallbackNotice,
  publicationNotice,
  publicationNotices
} from "./chunks/chunk-CBTQ2Q6U.mjs";
import {
  KnowledgeService,
  closeKnowledgeServices,
  getKnowledgeService,
  notifyKnowledgeChange
} from "./chunks/chunk-5PIDULPV.mjs";
import {
  embedTexts,
  validateSemanticConfig
} from "./chunks/chunk-OWE2DUY5.mjs";
import {
  createSemanticSettingsApi,
  createSemanticSettingsState,
  readSemanticSettings,
  saveSemanticSettings,
  validateSemanticConfig as validateSemanticConfig2
} from "./chunks/chunk-O536IQIE.mjs";
import {
  beginKnowledgeFlow,
  clearKnowledgeFlow,
  emitKnowledgeUi,
  flowFor,
  invalidateKnowledgeUi,
  noteKnowledgeOperation,
  noteKnowledgeRead,
  noteKnowledgeSearch,
  noteKnowledgeSpecialist,
  notifyKnowledgeUi,
  publicationKnowledgeFlow,
  requestWikiReviewUi,
  subscribeKnowledgeUi,
  updateKnowledgeFlow
} from "./chunks/chunk-6YLIZTKN.mjs";
import {
  advisoryCodes,
  readReviewMode,
  saveReviewMode
} from "./chunks/chunk-6LT3KQRY.mjs";
import {
  KnowledgeReuseIndex,
  checkKnowledgeReceiptFreshness,
  checkKnowledgeSnapshotReuse,
  ingestKnowledgeSnapshot,
  knowledgeEvidenceGradeRank,
  knowledgeReuseLevelRank,
  resolveKnowledgeContext,
  validateKnowledgeSourceReceipt
} from "./chunks/chunk-E62NM7KD.mjs";
import {
  cardField,
  cardLink,
  failureCard,
  flowCard,
  literatureCard,
  statusTone
} from "./chunks/chunk-H6MOV67K.mjs";
import "./chunks/chunk-RCUF5QK4.mjs";
import {
  VaultFileConflictError,
  containedVaultFile,
  createVaultFileOnly,
  initializeProjectContext,
  initializeSharedNavigation,
  updateVaultNavigation
} from "./chunks/chunk-KUCMRWBG.mjs";
import {
  MAX_NOTE_BYTES,
  allowedSegment,
  canRead,
  fileVersion,
  inspectNote,
  noteScope,
  readNoteFile,
  safeNotePath,
  snippet,
  validateNote
} from "./chunks/chunk-AHEUR5VB.mjs";
import {
  readCapabilitySources
} from "./chunks/chunk-EUGIYDMB.mjs";
import {
  compareClaimSets,
  compareClaims
} from "./chunks/chunk-BMV53RD4.mjs";
import "./chunks/chunk-EFQIVCL3.mjs";
import {
  BackgroundReviewer,
  reviewDeliverable,
  selectReviewerProvider
} from "./chunks/chunk-N7KIJQYP.mjs";
import {
  EXPERIENCE_LIMITS,
  EXPERIENCE_VERSION,
  createExperienceStore,
  experienceInputFromTerminalJob,
  recordTerminalJobExperience,
  searchExperiences,
  terminalJobExperienceInput
} from "./chunks/chunk-32K2IHL3.mjs";
import {
  configureKnowledgeRuntime
} from "./chunks/chunk-4VUDROQV.mjs";
import {
  continuationHint,
  continuesTopic,
  currentProject,
  explainerTopicId,
  result,
  sessionIdentity
} from "./chunks/chunk-GSBWYZ2Z.mjs";
import "./chunks/chunk-FQL2U4DN.mjs";
import {
  createKnowledgeConfigApi,
  createKnowledgeConfigState,
  knowledgeDirectory,
  projectIdentity,
  readKnowledgeBinding,
  saveKnowledgeBinding,
  withKnowledgeBinding
} from "./chunks/chunk-CXEKIGAQ.mjs";
import "./chunks/chunk-VIHIR2BE.mjs";
export {
  BackgroundReviewer,
  EXPERIENCE_LIMITS,
  EXPERIENCE_VERSION,
  KnowledgeReuseIndex,
  KnowledgeService,
  MANAGED_END,
  MANAGED_START,
  MAX_NOTE_BYTES,
  SPECIALIST_DECISIONS,
  SPECIALIST_LIMITS,
  TOPIC_MEMORY_LIMITS,
  TOPIC_MEMORY_VERSION,
  VaultFileConflictError,
  advisoryCodes,
  advisoryLine,
  advisoryNotice,
  allowedSegment,
  archiveKnowledgeTopic,
  archiveTopic,
  assignCommunities,
  autoApplyWikiProposal,
  autoTopicCandidate,
  beginKnowledgeFlow,
  buildKnowledgeSearchExpression,
  canRead,
  cancelKnowledgeSemanticIndex,
  cardField,
  cardLink,
  checkKnowledgeReceiptFreshness,
  checkKnowledgeSnapshotReuse,
  classifyRelation,
  classifyTopic,
  clearKnowledgeFlow,
  closeKnowledgeServices,
  compareClaimSets,
  compareClaims,
  configureKnowledgeRuntime,
  consumeKnowledgeReviewPreview,
  containedVaultFile,
  contextSessionId,
  continuationHint,
  continuesTopic,
  createExperienceStore,
  createKnowledgeConfigApi,
  createKnowledgeConfigState,
  createKnowledgeSpecialists,
  createSemanticModel,
  createSemanticSettingsApi,
  createSemanticSettingsState,
  createSpecialistBudget,
  createTaskFeedback,
  createToolBudget,
  createTopicMemory,
  createVaultFileOnly,
  currentProject,
  dailyDiscoveryContext,
  decideSpecialistRun,
  decideWikiProposal,
  embedTexts,
  emitKnowledgeUi,
  evaluateMetacognitivePublication,
  experienceInputFromTerminalJob,
  explainerTopicId,
  failureCard,
  fileVersion,
  flowCard,
  flowFor,
  getKnowledgeService,
  getKnowledgeTopics,
  guardResearchToolResult,
  immutableWikiProposalHash,
  indexKnowledgeSemantic,
  ingestKnowledgeSnapshot,
  initializeProjectContext,
  initializeSharedNavigation,
  inspectNote,
  invalidateKnowledgeUi,
  isInfrastructureNode,
  knowledgeDecideReview,
  knowledgeDirectory,
  knowledgeEvidenceGradeRank,
  knowledgeFailure,
  knowledgeGraph,
  knowledgeJobs,
  knowledgeMaintenance,
  knowledgeNoteLinks,
  knowledgeOpenTarget,
  knowledgeOverview,
  knowledgePreviewReview,
  knowledgeReadNote,
  knowledgeReadStart,
  knowledgeReuseLevelRank,
  knowledgeReviews,
  knowledgeSemanticStatus,
  knowledgeSetupPreview,
  knowledgeSpecialistHost,
  knowledgeSpecialistSettings,
  lastWikiModelReview,
  listTopics,
  listWikiProposals,
  literatureCard,
  managedParts,
  mergeWikiProposal,
  nodeType,
  normalizeSourceLinks,
  noteKnowledgeOperation,
  noteKnowledgeRead,
  noteKnowledgeSearch,
  noteKnowledgeSpecialist,
  noteScope,
  notifyKnowledgeChange,
  notifyKnowledgeUi,
  onlineSourceLink,
  previewWikiProposal,
  projectIdentity,
  projectKnowledgeEvent,
  projectKnowledgeSnapshot,
  proposedWikiText,
  publicationFallbackNotice,
  publicationKnowledgeFlow,
  publicationNotice,
  publicationNotices,
  readCapabilitySources,
  readKnowledgeBinding,
  readNoteFile,
  readReviewMode,
  readSemanticSettings,
  readTopic,
  recordTerminalJobExperience,
  registerAnswerPublication,
  registerKnowledgeSpecialistHost,
  requestWikiReviewUi,
  resolveKnowledgeContext,
  result,
  reviewDeliverable,
  reviewWikiWithModel,
  runNavigationMaintenance,
  safeNotePath,
  saveDiscoveryIdea,
  saveKnowledgeBinding,
  saveKnowledgeSemanticSettings,
  saveReviewMode,
  saveSemanticSettings,
  saveSpecialistExplainer,
  searchExperiences,
  searchKnowledge,
  selectReviewerProvider,
  sessionIdentity,
  setSpecialistSettings,
  shouldOrientKnowledge,
  snippet,
  specialistQueueSnapshot,
  specialistRequestSignature,
  specialistSettings,
  splitKnowledgeChunks,
  stageWikiProposal,
  statusTone,
  subscribeKnowledgeUi,
  targetWikiPath,
  terminalJobExperienceInput,
  testKnowledgeSemanticProvider,
  tokenizeKnowledgeText,
  topicRunHash,
  undoWikiUpdate,
  updateKnowledgeFlow,
  updateNavigation,
  updateTopic,
  updateVaultNavigation,
  validateKnowledgeSourceReceipt,
  validateNote,
  validateWikiSourcePaths2 as validateRuntimeWikiSourcePaths,
  validateSemanticConfig2 as validateSemanticConfig,
  validateSemanticConfig as validateSemanticProviderConfig,
  validateSpecialistHtml,
  validateWikiSourcePaths,
  wikiHistory,
  withKnowledgeBinding,
  withSpecialistSlot
};
