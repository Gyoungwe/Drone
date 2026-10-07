import {
	type Credential,
	createProvider,
	type Model,
	type Provider,
	type ProviderStreams,
} from "@earendil-works/pi-ai";
import { parseDiscoveredModels, staticAntigravityModels } from "./catalog";
import { createAntigravityOAuth } from "./oauth";
import { fetchAvailableModels, streamAntigravity } from "./transport";
import {
	ANTIGRAVITY_API,
	ANTIGRAVITY_DISPLAY_NAME,
	ANTIGRAVITY_PRIMARY_ENDPOINT,
	ANTIGRAVITY_PROVIDER_ID,
	type AntigravityProviderFactoryOptions,
} from "./types";

export function createAntigravityProvider(options: AntigravityProviderFactoryOptions = {}): Provider {
	const streams: ProviderStreams = {
		stream: (model, context, streamOptions) =>
			streamAntigravity(model as Model<string>, context, {
				...(streamOptions ?? {}),
				...(options.endpoints ? { endpoints: options.endpoints } : {}),
				...(options.fetcher ? { fetch: options.fetcher } : {}),
			}),
		streamSimple: (model, context, streamOptions) =>
			streamAntigravity(model as Model<string>, context, {
				...(streamOptions ?? {}),
				...(options.endpoints ? { endpoints: options.endpoints } : {}),
				...(options.fetcher ? { fetch: options.fetcher } : {}),
			}),
	};
	return createProvider({
		id: ANTIGRAVITY_PROVIDER_ID,
		name: ANTIGRAVITY_DISPLAY_NAME,
		baseUrl: ANTIGRAVITY_PRIMARY_ENDPOINT,
		auth: { oauth: createAntigravityOAuth(options) },
		models: staticAntigravityModels(),
		api: streams,
		fetchModels: async (context) => {
			if (!context.allowNetwork || context.signal.aborted) return staticAntigravityModels();
			const credential = context.credential;
			const access = credential?.type === "oauth" ? credential.access : undefined;
			if (!access) return staticAntigravityModels();
			const payload = await fetchAvailableModels(access, {
				endpoints: options.endpoints,
				fetcher: options.fetcher,
				signal: context.signal,
			});
			if (!payload) return staticAntigravityModels();
			const byId = new Map(staticAntigravityModels().map((model) => [model.id, model]));
			for (const model of parseDiscoveredModels(payload)) byId.set(model.id, model);
			return [...byId.values()];
		},
	});
}

export function isAntigravityCredential(
	value: Credential | undefined,
): value is Credential & { type: "oauth"; access: string } {
	return value?.type === "oauth" && typeof value.access === "string" && value.access.length > 0;
}

export { ANTIGRAVITY_API, ANTIGRAVITY_PROVIDER_ID };
