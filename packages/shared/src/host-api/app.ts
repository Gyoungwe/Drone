import { Type } from "typebox";
import type { DiagnosticsSnapshot } from "../diagnostics";
import type { HostEnvironment } from "../host-env";
import type { FigureAnnotation, ImportedAttachment, ResourcePreviewResult } from "../ipc";
import type { AppInfo, SavedTabs, UiState } from "../session";
import type {
	SkillRepositoryAddInput,
	SkillRepositoryCheckResult,
	SkillRepositoryRecord,
	SkillRepositoryUpdateResult,
} from "../skill-repository";
import { defineDomain } from "./define";

const AppInfoSchema = Type.Object(
	{
		name: Type.String(),
		version: Type.String(),
		electron: Type.String(),
		chrome: Type.String(),
		node: Type.String(),
		platform: Type.String(),
		arch: Type.String(),
		repoUrl: Type.String(),
	},
	{ additionalProperties: false },
);

// The diagnostics payload is already defined as a shared, redacted snapshot.
// Keep the contract schema intentionally shallow here so adding diagnostic
// metadata remains backward compatible with older renderers.
const DiagnosticsSnapshotSchema = Type.Unsafe<DiagnosticsSnapshot>({ type: "object" });
const SavedTabsSchema = Type.Unsafe<SavedTabs>({ type: "object" });
const UiStateSchema = Type.Unsafe<UiState>({ type: "object" });
const ResourcePreviewResultSchema = Type.Unsafe<ResourcePreviewResult>({ type: "object" });
const FigureAnnotationSchema = Type.Unsafe<FigureAnnotation>(
	Type.Object(
		{
			id: Type.String({ minLength: 1, maxLength: 64 }),
			x: Type.Number({ minimum: 0, maximum: 1 }),
			y: Type.Number({ minimum: 0, maximum: 1 }),
			text: Type.String({ maxLength: 2000 }),
			createdAt: Type.String({ maxLength: 64 }),
		},
		{ additionalProperties: false },
	),
);
const ImportedAttachmentSchema = Type.Object(
	{ path: Type.String(), name: Type.String(), bytes: Type.Integer({ minimum: 0 }) },
	{ additionalProperties: false },
);
const GitBranchesSchema = Type.Object(
	{ current: Type.Union([Type.String(), Type.Null()]), branches: Type.Array(Type.String()) },
	{ additionalProperties: false },
);
const NullableString = Type.Union([Type.String(), Type.Null()]);
const SkillRepositoryAddInputSchema = Type.Unsafe<SkillRepositoryAddInput>(
	Type.Object(
		{
			kind: Type.Union([Type.Literal("git"), Type.Literal("local")]),
			source: Type.String({ minLength: 1, maxLength: 4096 }),
			ref: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })),
			subpath: Type.Optional(Type.String({ maxLength: 1024 })),
			license: Type.String({ minLength: 1, maxLength: 256 }),
			licenseEvidence: Type.Optional(Type.String({ maxLength: 4096 })),
			name: Type.Optional(Type.String({ maxLength: 256 })),
		},
		{ additionalProperties: false },
	),
);
const SkillRepositoryRecordSchema = Type.Unsafe<SkillRepositoryRecord>(
	Type.Object(
		{
			id: Type.String({ minLength: 1, maxLength: 64 }),
			name: Type.String({ minLength: 1, maxLength: 256 }),
			kind: Type.Union([Type.Literal("git"), Type.Literal("local")]),
			source: Type.String({ minLength: 1, maxLength: 4096 }),
			ref: Type.Optional(Type.String({ maxLength: 256 })),
			subpath: Type.Optional(Type.String({ maxLength: 1024 })),
			license: Type.String({ minLength: 1, maxLength: 256 }),
			licenseEvidence: Type.Optional(Type.String({ maxLength: 4096 })),
			status: Type.Union([Type.Literal("ready"), Type.Literal("update-available"), Type.Literal("error")]),
			skillCount: Type.Integer({ minimum: 0, maximum: 1000 }),
			lastCheckedAt: Type.Optional(Type.String({ maxLength: 64 })),
			lastAppliedAt: Type.Optional(Type.String({ maxLength: 64 })),
			lastError: Type.Optional(Type.String({ maxLength: 2000 })),
			updateAvailable: Type.Optional(Type.Boolean()),
		},
		{ additionalProperties: false },
	),
);
const SkillRepositoryListSchema = Type.Array(SkillRepositoryRecordSchema, { maxItems: 100 });
const SkillRepositoryCheckResultSchema = Type.Unsafe<SkillRepositoryCheckResult>(
	Type.Object(
		{
			repository: SkillRepositoryRecordSchema,
			changedFiles: Type.Array(Type.String({ maxLength: 1024 }), { maxItems: 1000 }),
		},
		{ additionalProperties: false },
	),
);
const SkillRepositoryUpdateResultSchema = Type.Unsafe<SkillRepositoryUpdateResult>(
	Type.Object(
		{
			repository: SkillRepositoryRecordSchema,
			changedFiles: Type.Array(Type.String({ maxLength: 1024 }), { maxItems: 1000 }),
			restartedRequired: Type.Literal(true),
		},
		{ additionalProperties: false },
	),
);

/** Host API contract for application metadata and diagnostics. */
export const AppContract = defineDomain("app", {
	methods: {
		getInfo: {
			args: Type.Tuple([]),
			result: Type.Unsafe<AppInfo>(AppInfoSchema),
		},
		getDiagnostics: {
			args: Type.Tuple([]),
			result: DiagnosticsSnapshotSchema,
		},
		getDailyDir: {
			args: Type.Tuple([]),
			result: Type.String({ minLength: 1 }),
		},
		openExternal: { args: Type.Tuple([Type.String()]), result: Type.Void() },
		filePreview: {
			args: Type.Union([
				Type.Tuple([Type.String()]),
				Type.Tuple([Type.String(), Type.String()]),
				Type.Tuple([Type.String(), Type.String(), Type.Boolean()]),
			]),
			result: ResourcePreviewResultSchema,
		},
		htmlPreviewUrl: {
			args: Type.Union([Type.Tuple([Type.String()]), Type.Tuple([Type.String(), Type.String()])]),
			result: Type.String({ minLength: 1 }),
		},
		getFigureAnnotations: {
			args: Type.Union([Type.Tuple([Type.String()]), Type.Tuple([Type.String(), Type.String()])]),
			result: Type.Array(FigureAnnotationSchema),
		},
		saveFigureAnnotations: {
			args: Type.Tuple([
				Type.String({ minLength: 1 }),
				Type.Union([Type.String(), Type.Null()]),
				Type.Array(FigureAnnotationSchema, { maxItems: 200 }),
			]),
			result: Type.Array(FigureAnnotationSchema),
		},
		importDroppedFile: {
			args: Type.Tuple([Type.String({ minLength: 1 }), Type.String({ minLength: 1 })]),
			result: Type.Unsafe<ImportedAttachment>(ImportedAttachmentSchema),
		},
		resourceOpenExternal: {
			args: Type.Union([
				Type.Tuple([Type.String()]),
				Type.Tuple([Type.String(), Type.String()]),
				Type.Tuple([Type.String(), Type.String(), Type.Boolean()]),
			]),
			result: Type.Void(),
		},
		/** 文件右键菜单的宿主动作（P7）：action, target, cwd, arg（rename 的新文件名） */
		fileAction: {
			args: Type.Tuple([
				Type.Union(
					["download", "openDefault", "reveal", "openInEditor", "cut", "copy", "rename", "trash"].map((a) =>
						Type.Literal(a),
					),
				),
				Type.String({ minLength: 1 }),
				NullableString,
				NullableString,
			]),
			result: NullableString,
		},
		/** 本机环境探测（P10）：固定只读命令 */
		pickDownloadDir: { args: Type.Tuple([]), result: NullableString },
		/** 待答数角标（P14）：count, Windows overlay 图（data URL）或 null */
		setAttentionBadge: {
			args: Type.Tuple([Type.Integer({ minimum: 0, maximum: 999 }), NullableString]),
			result: Type.Void(),
		},
		hostEnvironment: {
			args: Type.Tuple([]),
			result: Type.Unsafe<HostEnvironment>(Type.Object({}, { additionalProperties: true })),
		},
		loadTabs: { args: Type.Tuple([]), result: Type.Union([SavedTabsSchema, Type.Null()]) },
		saveTabs: { args: Type.Tuple([SavedTabsSchema]), result: Type.Void() },
		loadUiState: { args: Type.Tuple([]), result: Type.Union([UiStateSchema, Type.Null()]) },
		saveUiState: {
			args: Type.Tuple([Type.Unsafe<Partial<UiState>>({ type: "object" })]),
			result: Type.Void(),
		},
		pickBackgroundImage: { args: Type.Tuple([]), result: NullableString },
		checkForUpdates: { args: Type.Tuple([]), result: Type.Void() },
		downloadUpdate: { args: Type.Tuple([]), result: Type.Void() },
		installUpdate: { args: Type.Tuple([]), result: Type.Void() },
		checkResearchSkills: { args: Type.Tuple([]), result: Type.Void() },
		updateResearchSkills: { args: Type.Tuple([]), result: Type.Void() },
		restartForResearchSkills: { args: Type.Tuple([]), result: Type.Void() },
		listSkillRepositories: { args: Type.Tuple([]), result: SkillRepositoryListSchema },
		addSkillRepository: {
			args: Type.Tuple([SkillRepositoryAddInputSchema]),
			result: SkillRepositoryRecordSchema,
		},
		checkSkillRepository: {
			args: Type.Tuple([Type.String({ minLength: 1, maxLength: 64 })]),
			result: SkillRepositoryCheckResultSchema,
		},
		updateSkillRepository: {
			args: Type.Tuple([Type.String({ minLength: 1, maxLength: 64 })]),
			result: SkillRepositoryUpdateResultSchema,
		},
		removeSkillRepository: {
			args: Type.Tuple([Type.String({ minLength: 1, maxLength: 64 })]),
			result: Type.Void(),
		},
		saveFileDialog: {
			args: Type.Tuple([Type.String(), Type.String()]),
			result: NullableString,
		},
		pickPath: {
			args: Type.Union([
				Type.Tuple([Type.Union([Type.Literal("file"), Type.Literal("directory")])]),
				Type.Tuple([Type.Union([Type.Literal("file"), Type.Literal("directory")]), Type.String()]),
			]),
			result: NullableString,
		},
		pickDirectory: { args: Type.Tuple([]), result: NullableString },
		getGitBranch: { args: Type.Tuple([Type.String()]), result: NullableString },
		listGitBranches: { args: Type.Tuple([Type.String()]), result: GitBranchesSchema },
		checkoutBranch: { args: Type.Tuple([Type.String(), Type.String()]), result: Type.String() },
	},
});
