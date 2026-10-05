import { Type } from "typebox";
import type {
	InquiryArtifactProvenance,
	InquiryArtifactRecord,
	InquiryArtifactRerunResult,
} from "../inquiry";
import { defineDomain } from "./define";

const ProjectId = Type.Union([Type.String({ minLength: 1, maxLength: 4096 }), Type.Undefined()]);
const ArtifactId = Type.String({ minLength: 1, maxLength: 512, pattern: "^[^\\u0000-\\u001f\\u007f]+$" });
const ArtifactIdArgs = Type.Union([Type.Tuple([ArtifactId]), Type.Tuple([ArtifactId, ProjectId])]);
const ProjectArgs = Type.Union([Type.Tuple([]), Type.Tuple([ProjectId])]);
const ObjectResult = <T>() => Type.Unsafe<T>({ type: "object" });
const ArrayResult = <T>() => Type.Array(ObjectResult<T>(), { maxItems: 256 });
const UiErrorSchema = Type.Object(
	{
		code: Type.String({ minLength: 1, maxLength: 128 }),
		severity: Type.Union([Type.Literal("error"), Type.Literal("warning"), Type.Literal("info")]),
		source: Type.Literal("app"),
		titleKey: Type.String({ minLength: 1, maxLength: 256 }),
		detail: Type.Optional(Type.String({ maxLength: 4096 })),
		actions: Type.Array(Type.String({ minLength: 1, maxLength: 64 }), { maxItems: 8 }),
		timestamp: Type.Number(),
	},
	{ additionalProperties: true },
);

export const InquiryContract = defineDomain("inquiry", {
	methods: {
		listArtifacts: { args: ProjectArgs, result: ArrayResult<InquiryArtifactRecord>(), access: "lan-read" },
		artifactProvenance: {
			args: ArtifactIdArgs,
			result: Type.Union([ObjectResult<InquiryArtifactProvenance>(), UiErrorSchema]),
			access: "lan-read",
		},
		rerunArtifact: {
			args: ArtifactIdArgs,
			result: Type.Union([ObjectResult<InquiryArtifactRerunResult>(), UiErrorSchema]),
		},
	},
	events: {
		rerunUpdated: ObjectResult<InquiryArtifactRerunResult>(),
	},
});

export type InquiryApi = import("./define").ClientOf<typeof InquiryContract>;
