// @ts-nocheck
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
} from "./chunks/chunk-IJHRYYDY.mjs";
import {
  lastWikiModelReview,
  reviewWikiWithModel
} from "./chunks/chunk-TPF5L26G.mjs";
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
  autoApplyWikiProposal,
  decideWikiProposal,
  listWikiProposals,
  mergeWikiProposal,
  previewWikiProposal,
  stageWikiProposal,
  undoWikiUpdate,
  validateWikiSourcePaths as validateWikiSourcePaths2,
  wikiHistory
} from "./chunks/chunk-IMC2GAXA.mjs";
import {
  normalizeSourceLinks,
  onlineSourceLink
} from "./chunks/chunk-LE6NM7SB.mjs";
import {
  saveSpecialistExplainer
} from "./chunks/chunk-GMBJR4N3.mjs";
import {
  createKnowledgeSpecialists,
  knowledgeReadStart,
  shouldOrientKnowledge
} from "./chunks/chunk-6H2S6YM4.mjs";
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
  createTaskFeedback,
  guardResearchToolResult
} from "./chunks/chunk-TW476WMJ.mjs";
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
} from "./chunks/chunk-MFL6DGIT.mjs";
import {
  projectKnowledgeEvent,
  projectKnowledgeSnapshot,
  registerAnswerPublication
} from "./chunks/chunk-PJQRVYSJ.mjs";
import {
  buildKnowledgeSearchExpression,
  splitKnowledgeChunks,
  tokenizeKnowledgeText
} from "./chunks/chunk-4LTSNIAR.mjs";
import {
  KnowledgeService,
  closeKnowledgeServices,
  getKnowledgeService,
  notifyKnowledgeChange
} from "./chunks/chunk-V6PECWHO.mjs";
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
  cardField,
  cardLink,
  failureCard,
  flowCard,
  literatureCard,
  statusTone
} from "./chunks/chunk-H6MOV67K.mjs";
import "./chunks/chunk-RCUF5QK4.mjs";
import {
  runNavigationMaintenance,
  updateNavigation
} from "./chunks/chunk-Q4ULDE2G.mjs";
import {
  containedVaultFile,
  createVaultFileOnly,
  initializeProjectContext,
  initializeSharedNavigation,
  updateVaultNavigation
} from "./chunks/chunk-DY4DWRNO.mjs";
import {
  evaluateMetacognitivePublication
} from "./chunks/chunk-TT3YMRLM.mjs";
import {
  SPECIALIST_DECISIONS,
  createSpecialistBudget,
  decideSpecialistRun,
  specialistRequestSignature
} from "./chunks/chunk-BRQ6C4CR.mjs";
import {
  advisoryLine,
  advisoryNotice,
  knowledgeFailure,
  publicationFallbackNotice,
  publicationNotice,
  publicationNotices
} from "./chunks/chunk-U3GNWHNQ.mjs";
import {
  compareClaimSets,
  compareClaims
} from "./chunks/chunk-BMV53RD4.mjs";
import "./chunks/chunk-EFQIVCL3.mjs";
import {
  BackgroundReviewer,
  reviewDeliverable,
  selectReviewerProvider
} from "./chunks/chunk-O7VIOV5D.mjs";
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
} from "./chunks/chunk-56KZ2R3S.mjs";
import {
  createKnowledgeConfigApi,
  createKnowledgeConfigState,
  knowledgeDirectory,
  projectIdentity,
  readKnowledgeBinding,
  saveKnowledgeBinding,
  withKnowledgeBinding
} from "./chunks/chunk-CXEKIGAQ.mjs";
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
export {
  BackgroundReviewer,
  EXPERIENCE_LIMITS,
  EXPERIENCE_VERSION,
  KnowledgeService,
  MANAGED_END,
  MANAGED_START,
  MAX_NOTE_BYTES,
  SPECIALIST_DECISIONS,
  SPECIALIST_LIMITS,
  TOPIC_MEMORY_LIMITS,
  TOPIC_MEMORY_VERSION,
  advisoryCodes,
  advisoryLine,
  advisoryNotice,
  allowedSegment,
  archiveKnowledgeTopic,
  archiveTopic,
  autoApplyWikiProposal,
  autoTopicCandidate,
  beginKnowledgeFlow,
  buildKnowledgeSearchExpression,
  canRead,
  cancelKnowledgeSemanticIndex,
  cardField,
  cardLink,
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
  initializeProjectContext,
  initializeSharedNavigation,
  inspectNote,
  invalidateKnowledgeUi,
  knowledgeDecideReview,
  knowledgeDirectory,
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
  readKnowledgeBinding,
  readNoteFile,
  readReviewMode,
  readSemanticSettings,
  readTopic,
  recordTerminalJobExperience,
  registerAnswerPublication,
  registerKnowledgeSpecialistHost,
  requestWikiReviewUi,
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
