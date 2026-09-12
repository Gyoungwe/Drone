export const VAULT_PROFILES = {
  project: {
    id: "project",
    label: "科研项目型",
    description: "围绕单个研究项目组织问题、证据、结论、运行记录和产物；共享文献库保持精简。",
    projectTypes: ["Questions", "Concepts", "Entities", "Papers", "Sources", "Evidence", "Claims", "Decisions", "Runs", "Artifacts", "Wiki"],
    libraryTypes: ["Papers", "Methods", "Software", "Explainers"],
    deposition: { runSummaries: true, verifiedSources: true, validatedClaims: true, reusableConcepts: false, decisions: true, wiki: true },
  },
  literature: {
    id: "literature",
    label: "文献知识库型",
    description: "强调跨项目复用的论文、方法、概念、实体与软件知识，同时保留轻量项目层。",
    projectTypes: ["Questions", "Papers", "Evidence", "Claims", "Runs", "Wiki"],
    libraryTypes: ["Papers", "Methods", "Concepts", "Software", "Entities", "Explainers"],
    deposition: { runSummaries: true, verifiedSources: true, validatedClaims: true, reusableConcepts: true, decisions: false, wiki: true },
  },
  hybrid: {
    id: "hybrid",
    label: "混合型（推荐）",
    description: "项目层保存研究上下文与证据链，共享 Library 保存可复用知识；适合 Zotero + Obsidian + WikiLoop。",
    projectTypes: ["Questions", "Concepts", "Entities", "Papers", "Sources", "Evidence", "Claims", "Decisions", "Runs", "Artifacts", "Wiki"],
    libraryTypes: ["Papers", "Methods", "Concepts", "Software", "Entities", "Explainers"],
    deposition: { runSummaries: true, verifiedSources: true, validatedClaims: true, reusableConcepts: true, decisions: true, wiki: true },
  },
};

export const DEFAULT_VAULT_PROFILE = "hybrid";
export const SUBAGENT_MCP_POLICIES = ["none", "read-local"];

export function getVaultProfile(id = DEFAULT_VAULT_PROFILE) {
  const profile = VAULT_PROFILES[id];
  if (!profile) throw new Error(`Unknown knowledge profile: ${id}`);
  return profile;
}

export function listVaultProfiles() {
  return Object.values(VAULT_PROFILES).map((profile) => ({ ...profile, deposition: { ...profile.deposition } }));
}
