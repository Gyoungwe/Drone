/**
 * Manifest `drone.networkPolicy`: the network capabilities the user may be asked
 * to approve when a package is installed.
 *
 * A *declared* host (`permissions.network`) is a host the package may always
 * reach.  A *runtime* endpoint is one the user configures on their own
 * machine — a self-hosted WebDAV server, a local service — and the host may
 * only grant one to a package whose manifest asks for it and whose install the
 * user approved.
 *
 * The policy is a declaration, not a grant.  Nothing here enables anything by
 * itself: the host still has to obtain the user's approval, and the runtime
 * endpoint still has to parse, match the slot's hosts and attach the secret
 * only on an authenticated request.
 *
 * See `.local/tickets/notes/p6-credential-policy-design-2026-11-23.md` and
 * decision D-P6-3 (2026-11-20).
 */
export interface PluginNetworkPolicy {
	/** Whether the package may be granted a user-configured runtime endpoint. */
	readonly runtimeEndpoint?: {
		readonly allowed: true;
		/**
		 * The credential slot whose secret may be attached to a request toward the
		 * granted endpoint.  The slot must be declared in `drone.credentials` with
		 * `authentication: "http-basic-digest"`, and its `hosts` must include the
		 * endpoint's host:port.
		 */
		readonly credentialSlot: string;
	};
}
