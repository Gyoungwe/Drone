import { type Static, Type } from "typebox";
import {
	DiscoveryCapabilitiesSchema,
	DiscoveryCriticReviewSchema,
	DiscoveryEvaluationSchema,
	DiscoveryExplorationPlanSchema,
	DiscoveryKernelLanguageSchema,
	DiscoveryKernelSessionSchema,
	DiscoveryMultipathAssessmentSchema,
} from "../discovery";
import { defineDomain } from "./define";

const EmptyArgs = Type.Tuple([]);
const IdArgs = Type.Tuple([Type.String({ minLength: 1, maxLength: 128 })]);
const LanguageArgs = Type.Tuple([DiscoveryKernelLanguageSchema]);
export const DiscoveryContract = defineDomain("discovery", {
	methods: {
		getCapabilities: { args: LanguageArgs, result: DiscoveryCapabilitiesSchema },
		listKernelSessions: {
			args: EmptyArgs,
			result: Type.Array(DiscoveryKernelSessionSchema, { maxItems: 256 }),
					},
		getKernelSession: {
			args: IdArgs,
			result: Type.Union([DiscoveryKernelSessionSchema, Type.Null()]),
					},
		closeKernelSession: { args: IdArgs, result: Type.Void() },
		listCriticReviews: {
			args: EmptyArgs,
			result: Type.Array(DiscoveryCriticReviewSchema, { maxItems: 256 }),
					},
		listMultipathAssessments: {
			args: EmptyArgs,
			result: Type.Array(DiscoveryMultipathAssessmentSchema, { maxItems: 256 }),
					},
		listExplorationPlans: {
			args: EmptyArgs,
			result: Type.Array(DiscoveryExplorationPlanSchema, { maxItems: 256 }),
					},
		listEvaluations: {
			args: EmptyArgs,
			result: Type.Array(DiscoveryEvaluationSchema, { maxItems: 256 }),
					},
	},
	events: {},
});
export type DiscoveryApi = import("./define").ClientOf<typeof DiscoveryContract>;
export type DiscoveryCapabilitiesResult = Static<typeof DiscoveryCapabilitiesSchema>;
