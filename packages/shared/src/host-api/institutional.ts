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

export interface InstitutionalApi {
	/** 机构访问状态（配置 + 会话 Cookie + 是否已登录）；文献库面板用 */
	getInstitutionalStatus(): Promise<InstitutionalStatus>;
	/** 保存机构访问配置（EZproxy 模板 / OpenURL / 机构名 / 自动下载开关 / 上限） */
	saveInstitutionalConfig(input: InstitutionalSaveInput): Promise<InstitutionalStatus>;
	/** 打开机构登录窗口（可选 URL，未传则用上次或模板） */
	openInstitutionalLogin(url?: string): Promise<{ url: string }>;
	/** 在机构会话窗口中打开指定 URL（用于手动下载或测试） */
	openInstitutionalUrl(url: string): Promise<{ url: string }>;
	/** 清除机构会话（Cookie + 存储） */
	clearInstitutionalSession(): Promise<InstitutionalStatus>;
	/** 测试机构访问是否可达（经 EZproxy 模板与会话） */
	testInstitutionalAccess(url: string): Promise<InstitutionalTestResult>;
}

export type { InstitutionalConfig, InstitutionalSaveInput, InstitutionalStatus, InstitutionalTestResult };
