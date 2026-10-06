import { Type } from "typebox";
import type { DiagnosticsSnapshot } from "../diagnostics";
import type { FigureAnnotation, ImportedAttachment, ResourcePreviewResult } from "../ipc";
import type { AppInfo, SavedTabs, UiState } from "../session";
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
			args: Type.Union([Type.Tuple([Type.String()]), Type.Tuple([Type.String(), Type.String()])]),
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
			args: Type.Union([Type.Tuple([Type.String()]), Type.Tuple([Type.String(), Type.String()])]),
			result: Type.Void(),
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
