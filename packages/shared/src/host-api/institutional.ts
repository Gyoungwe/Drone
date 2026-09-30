import { Type } from "typebox";
import type {
	InstitutionalConfig,
	InstitutionalSaveInput,
	InstitutionalStatus,
	InstitutionalTestResult,
} from "../institutional";
import { defineDomain } from "./define";

const OptionalString = Type.Optional(Type.String());

const InstitutionalConfigSchema = Type.Object(
	{
		version: Type.Literal(1),
		ezproxyTemplate: OptionalString,
		openUrlResolver: OptionalString,
		institutionName: OptionalString,
		autoDownloadEnabled: Type.Boolean(),
		perTaskLimit: Type.Integer({ minimum: 1, maximum: 100 }),
		lastLoginAt: OptionalString,
		lastLoginUrl: OptionalString,
		configured: Type.Optional(Type.Boolean()),
	},
	{ additionalProperties: false },
);

const InstitutionalSessionSchema = Type.Object(
	{
		cookiesCount: Type.Integer({ minimum: 0 }),
		hasSessionCookies: Type.Boolean(),
		partition: Type.String({ minLength: 1 }),
		lastAccessAt: OptionalString,
	},
	{ additionalProperties: false },
);

const InstitutionalStatusSchema = Type.Object(
	{
		config: InstitutionalConfigSchema,
		session: InstitutionalSessionSchema,
		loggedIn: Type.Boolean(),
		electronAvailable: Type.Boolean(),
	},
	{ additionalProperties: false },
);

const InstitutionalSaveInputSchema = Type.Object(
	{
		ezproxyTemplate: OptionalString,
		openUrlResolver: OptionalString,
		institutionName: OptionalString,
		autoDownloadEnabled: Type.Optional(Type.Boolean()),
		perTaskLimit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
	},
	{ additionalProperties: false },
);

const InstitutionalTestResultSchema = Type.Object(
	{
		url: Type.String({ minLength: 1 }),
		proxiedUrl: OptionalString,
		status: Type.Integer({ minimum: 0, maximum: 999 }),
		ok: Type.Boolean(),
		contentType: OptionalString,
		redirected: Type.Optional(Type.Boolean()),
		finalUrl: OptionalString,
		error: OptionalString,
		via: Type.Union([Type.Literal("direct"), Type.Literal("ezproxy"), Type.Literal("institutional_session")]),
	},
	{ additionalProperties: false },
);

/** 合法机构访问通道：配置、持久登录窗口和会话可达性测试。 */
export const InstitutionalContract = defineDomain("institutional", {
	methods: {
		getStatus: { args: Type.Tuple([]), result: InstitutionalStatusSchema },
		saveConfig: { args: Type.Tuple([InstitutionalSaveInputSchema]), result: InstitutionalStatusSchema },
		openLogin: {
			args: Type.Union([Type.Tuple([]), Type.Tuple([Type.String()])]),
			result: Type.Object({ url: Type.String({ minLength: 1 }) }, { additionalProperties: false }),
		},
		openUrl: {
			args: Type.Tuple([Type.String({ minLength: 1 })]),
			result: Type.Object({ url: Type.String({ minLength: 1 }) }, { additionalProperties: false }),
		},
		clear: { args: Type.Tuple([]), result: InstitutionalStatusSchema },
		testAccess: {
			args: Type.Tuple([Type.String({ minLength: 1 })]),
			result: InstitutionalTestResultSchema,
		},
	},
});

export type InstitutionalSchemaTypes = {
	getStatus: [];
	saveConfig: [input: InstitutionalSaveInput];
	openLogin: [url?: string];
	openUrl: [url: string];
	clear: [];
	testAccess: [url: string];
};

export type { InstitutionalConfig, InstitutionalSaveInput, InstitutionalStatus, InstitutionalTestResult };
