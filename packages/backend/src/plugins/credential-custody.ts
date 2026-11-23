import type { PluginCredentialSlot } from "./plugin-credentials";

/** The kinds of secret the host keeps on a plugin's behalf. */
export type HostCustodyKind = "zotero-local-key" | "webdav-password";

/**
 * The secrets the host keeps on a plugin's behalf.
 *
 * A manifest declares a custody *kind*, never a variable name: naming one would
 * let a package point the host at any secret in its environment.  The host owns
 * the map from a kind to a secret it already holds, and matches a slot by the
 * **shape** the slot declares — so a package can only reach a secret whose shape
 * it matches exactly, and cannot ask for a different one.
 *
 * The shape decides *which* secret; it never decides *whether*.  Handing a secret
 * over also needs the user's approval of the package's policy (see
 * `credential-override.ts`), so declaring the right shape alone gets nothing.
 */
export interface HostCustodyEntry {
	/** The kind of secret, shown to the user when they approve the policy. */
	readonly custody: HostCustodyKind;
	/** The slot name this entry answers to. */
	readonly slot: string;
	/** The request header this secret travels in. */
	readonly header: string;
	/** The non-secret values that come with the secret. */
	readonly fields: readonly string[];
	/** The hosts this secret may be sent to; empty means the slot's own hosts decide. */
	readonly hosts: readonly string[];
	/** The HTTP authentication the secret rides with; absent means a literal header. */
	readonly authentication?: "http-basic-digest";
	/**
	 * What the user's own saved secret is worth for this slot.
	 *
	 * `never`: the host's secret is the only one, and the user cannot save one for
	 * the slot.  `fallback`: the host's secret wins while it is set, and a secret
	 * the user saved is used when it is not.
	 */
	readonly saved: "never" | "fallback";
	/** Read the secret and its fields from the host's environment. */
	read(
		env: NodeJS.ProcessEnv,
	): { readonly secret: string; readonly fields: Readonly<Record<string, string>> } | undefined;
}

/**
 * The Zotero local-write key the host authorizes in its own settings.
 *
 * The key lives in the host's environment, so a plugin can only reach it through
 * this table — never by naming the variable.  It is managed in Zotero settings,
 * so the slot has no saved secret of its own.
 */
const ZOTERO_LOCAL_KEY: HostCustodyEntry = {
	custody: "zotero-local-key",
	slot: "zotero-local",
	header: "Zotero-API-Key",
	fields: ["serverId"],
	hosts: ["127.0.0.1:23119"],
	saved: "never",
	read(env) {
		const secret = env.ZOTERO_LOCAL_API_KEY;
		if (!secret) return undefined;
		const serverId = env.ZOTERO_LOCAL_SERVER_ID;
		const fields: Record<string, string> = {};
		if (serverId !== undefined) fields.serverId = serverId;
		return { secret, fields };
	},
};

/**
 * The WebDAV password the host accepts from its environment.
 *
 * It overrides the password the user saved in settings while it is set, and is
 * read on every call so authorization, clearing and user-provided environment
 * values take effect.  The slot's own hosts decide where the secret may go: the
 * runtime endpoint adds a host to that list, and the secret follows the slot
 * rather than the entry.
 */
const WEBDAV_PASSWORD: HostCustodyEntry = {
	custody: "webdav-password",
	slot: "webdav",
	header: "Authorization",
	fields: [],
	hosts: [],
	authentication: "http-basic-digest",
	saved: "fallback",
	read(env) {
		const secret = env.DRONE_WEBDAV_PASSWORD;
		return secret ? { secret, fields: {} } : undefined;
	},
};

const HOST_CUSTODY: readonly HostCustodyEntry[] = [ZOTERO_LOCAL_KEY, WEBDAV_PASSWORD];

/**
 * The host custody entry a slot matches by shape, or undefined when it declares
 * no custody or no entry matches.
 *
 * The match is on the secret's *identity* — header, fields and authentication —
 * and on the hosts the host itself wrote the entry for.  A slot that declares a
 * different header, a different field set or an extra host does not match, so it
 * stays an ordinary slot the user fills, and never receives the host's secret.
 */
export function hostCustodyEntry(slot: PluginCredentialSlot): HostCustodyEntry | undefined {
	if (slot.custody !== "host-environment") return undefined;
	return HOST_CUSTODY.find(
		(entry) =>
			entry.slot === slot.slot &&
			entry.header === slot.header &&
			entry.authentication === slot.authentication &&
			entry.fields.length === slot.fields.length &&
			entry.fields.every((field) => slot.fields.includes(field)) &&
			(entry.hosts.length === 0 ||
				(entry.hosts.length === slot.hosts.length && entry.hosts.every((host) => slot.hosts.includes(host)))),
	);
}
