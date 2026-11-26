import {
	custodyGrants,
	type HostCustodyKind,
	hostText,
	type PluginCredentialSlot,
	type PluginNetworkPolicy,
} from "@drone/backend";
import { type BrowserWindow, dialog, type MessageBoxOptions } from "electron";

/**
 * The install-time policy the host asks the user to approve (approval category
 * `install-credential-network-policy`).
 *
 * The policy names a *shape*, never a secret and never an address: the user
 * agrees to "the host fills this slot with a secret it keeps" and to "this
 * package may use an address you set", not to any particular key or URL.
 */
export interface PolicyApprovalRequest {
	/** The package the policy belongs to. */
	readonly pluginId: string;
	/** The package's declared credential slots. */
	readonly credentials?: readonly PluginCredentialSlot[];
	/** The package's declared network policy. */
	readonly networkPolicy?: PluginNetworkPolicy;
}

interface Copy {
	readonly zh: string;
	readonly en: string;
}

/** Title and buttons as approved by the user (design note §5.1 and §5.3). */
const TITLE: Copy = {
	zh: "授权插件的凭据与网络策略",
	en: "Authorize a plugin's credential and network policy",
};
const ALLOW: Copy = { zh: "允许", en: "Allow" };
const DENY: Copy = { zh: "拒绝", en: "Deny" };

const CUSTODY_SENTENCES: Readonly<Record<HostCustodyKind, Copy>> = {
	"webdav-password": {
		zh: "• 由宿主代填你的 WebDAV 同步密码（插件不会直接读取原始环境变量或密钥文件）。",
		en: "• Let the host fill your WebDAV sync password (the plugin never reads the raw environment variable or secret file).",
	},
	"zotero-local-key": {
		zh: "• 由宿主代填本地 Zotero 写入密钥，仅用于请求本机 Zotero 服务。",
		en: "• Let the host fill your local Zotero write key for requests to the local Zotero service only.",
	},
};
const RUNTIME_ENDPOINT_SENTENCE: Copy = {
	zh: "• 允许该插件连接到你在环境变量中指定的自定义服务端点。",
	en: "• Allow this plugin to connect to a custom server endpoint you configure via environment variables.",
};

/** The sentences a request shows, one per policy element, in declaration order. */
export function policySentences(request: Omit<PolicyApprovalRequest, "pluginId">): readonly Copy[] {
	return [
		...custodyGrants(request.credentials).map((grant) => CUSTODY_SENTENCES[grant.kind]),
		...(request.networkPolicy?.runtimeEndpoint ? [RUNTIME_ENDPOINT_SENTENCE] : []),
	];
}

/** The composite message (§5.4): the package, then one line per policy element. */
export function policyApprovalMessage(request: PolicyApprovalRequest): Copy {
	const sentences = policySentences(request);
	const items = (language: keyof Copy) => sentences.map((sentence) => sentence[language]).join("\n");
	return {
		zh: `${request.pluginId} 申请以下策略。仅对本版本生效；插件更新后会重新询问。\n\n${items("zh")}`,
		en: `${request.pluginId} requests the following policy. It applies to this version only; you are asked again after an update.\n\n${items("en")}`,
	};
}

/**
 * Ask the user, in the host's own dialog, whether to allow a package's policy.
 *
 * Deny is the default and the cancel answer, as in the host's other approval
 * dialogs: dismissing the dialog never approves anything.
 */
export async function requestPolicyApproval(
	request: PolicyApprovalRequest,
	parent?: BrowserWindow,
): Promise<boolean> {
	const message = policyApprovalMessage(request);
	const options: MessageBoxOptions = {
		type: "question",
		title: hostText(TITLE.zh, TITLE.en),
		message: hostText(message.zh, message.en),
		buttons: [hostText(ALLOW.zh, ALLOW.en), hostText(DENY.zh, DENY.en)],
		defaultId: 1,
		cancelId: 1,
	};
	const { response } = parent
		? await dialog.showMessageBox(parent, options)
		: await dialog.showMessageBox(options);
	return response === 0;
}
