import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("knowledge host contracts are standalone and structurally usable by a provider", () => {
	const sourcePath = resolve(packageRoot, "test/knowledge-contract-fixture.ts");
	const source = `
import type {
  BackgroundReviewRequest,
  DailyIdea,
  DeliverableReviewFinding,
  ExperienceStorePort,
  MemoryNoteInput,
  TerminalJobExperienceInput,
} from "@gyoungwe/plugin-api/knowledge";
const idea: DailyIdea = {
  title: "idea", idea: "try", basis: ["Library/a.md"], test: "run", whyOverlooked: "new",
};
const memory: MemoryNoteInput = {
  id: 1, kind: "observation", title: "memory", body: "body", createdAt: 1,
};
const input: TerminalJobExperienceInput = {
  jobId: "job-1", summary: "ok", outcome: "success", observationId: "obs-1",
  provenance: { observationId: "obs-1" },
};
const store: ExperienceStorePort = {
  record: async (_input) => ({
    classification: "new",
    record: {} as never,
    revision: 1,
  }),
};
const request: BackgroundReviewRequest = {
  sessionId: "session-1",
  snapshot: { body: "draft" },
  trigger: "publication-projection",
};
const finding: DeliverableReviewFinding = {
  id: "finding-1",
  code: "untraceable-number",
  severity: "low",
  location: { kind: "body" },
  detail: "detail",
  suggestion: "check",
  handled: false,
};
void input; void store; void request; void finding; void idea; void memory;
`;
	const options = {
		target: ts.ScriptTarget.ES2022,
		module: ts.ModuleKind.ESNext,
		moduleResolution: ts.ModuleResolutionKind.Bundler,
		strict: true,
		noEmit: true,
		skipLibCheck: true,
		types: [],
		paths: {
			"@gyoungwe/plugin-api/knowledge": [resolve(packageRoot, "src/knowledge.ts")],
		},
	};
	const host = ts.createCompilerHost(options);
	const originalGetSourceFile = host.getSourceFile;
	host.getSourceFile = (name, languageVersion, ...rest) =>
		name === sourcePath
			? ts.createSourceFile(name, source, languageVersion, true)
			: originalGetSourceFile(name, languageVersion, ...rest);
	const program = ts.createProgram([sourcePath], options, host);
	const diagnostics = ts.getPreEmitDiagnostics(program);
	assert.equal(
		diagnostics.length,
		0,
		ts.formatDiagnosticsWithColorAndContext(diagnostics, {
			getCurrentDirectory: () => packageRoot,
			getCanonicalFileName: (name) => name,
			getNewLine: () => "\n",
		}),
	);
	const contracts = readFileSync(resolve(packageRoot, "src/knowledge-contracts.ts"), "utf8");
	assert.doesNotMatch(contracts, /@gyoungwe\/pi-knowledge/u);
});
