import { type Static, Type } from "typebox";
import { type ClientOf, defineDomain } from "./define";

const dailyTokenLimit = Type.Integer({ minimum: 1 });
const status = Type.Object(
	{
		enabled: Type.Boolean(),
		dailyTokenLimit,
		usedTokens: Type.Integer({ minimum: 0 }),
		exhausted: Type.Boolean(),
		unknownUsage: Type.Boolean(),
	},
	{ additionalProperties: false },
);

export type P5BackgroundStatus = Static<typeof status>;

export const BackgroundJobsContract = defineDomain("backgroundJobs", {
	methods: {
		getBackgroundJobsStatus: { args: Type.Tuple([Type.String()]), result: status, access: "desktop" },
		setBackgroundJobsEnabled: {
			args: Type.Tuple([Type.String(), Type.Boolean()]),
			result: status,
			access: "desktop",
		},
		setBackgroundJobsDailyLimit: {
			args: Type.Tuple([Type.String(), dailyTokenLimit]),
			result: status,
			access: "desktop",
		},
	},
});

export type BackgroundJobsApi = ClientOf<typeof BackgroundJobsContract>;
