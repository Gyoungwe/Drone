import type {
	PluginProviderEnumeration,
	PluginProviderEnumerationInput,
	PluginProviderInspection,
	PluginProviderInspectionInput,
	PluginProviderInvocationInput,
	PluginServiceRequirement,
	PluginServiceRole,
} from "@gyoungwe/plugin-api/runtime";
import { Type } from "typebox";
import { hostText } from "../reply-language";
import type { PluginRuntimeBridgeOptions, PluginRuntimeSource } from "./coordinator";
import type {
	PluginCapabilityContext,
	PluginCapabilityHandler,
	PluginNativeInvocation,
} from "./runtime-capabilities";

type CatalogEntry =
	NonNullable<PluginRuntimeBridgeOptions["sources"]> extends () => readonly (infer T)[] ? T : never;
export interface PluginServiceTarget extends CatalogEntry {
	readonly service: string;
	readonly operations: readonly string[];
}
interface Dependencies {
	readonly consumer: PluginRuntimeSource;
	sources(): readonly CatalogEntry[];
	check(context: PluginCapabilityContext, effect: "read" | "write"): void;
	invoke(
		context: PluginCapabilityContext,
		target: PluginServiceTarget,
		input: PluginProviderInvocationInput,
		effect: "read" | "write",
	): Promise<unknown>;
	invokeNative(
		context: PluginCapabilityContext,
		target: PluginServiceTarget,
		input: PluginProviderInvocationInput,
		effect: "read" | "write",
		origin: PluginNativeInvocation,
	): Promise<unknown>;
}

const text = Type.String({ minLength: 1, maxLength: 128 });
const address = (extra: Record<string, ReturnType<typeof Type.String> | typeof json> = {}) =>
	Type.Union([
		Type.Object({ alias: text, ...extra }, { additionalProperties: false }),
		Type.Object({ role: text, member: text, ...extra }, { additionalProperties: false }),
	]);
const inspectionFields = {
	state: Type.Union(
		["available", "absent", "disabled", "unavailable", "incompatible", "ambiguous"].map((state) =>
			Type.Literal(state),
		),
	),
	service: Type.String({ minLength: 1, maxLength: 256 }),
	requestedVersion: Type.Integer({ minimum: 1 }),
	provider: Type.Union([
		Type.Null(),
		Type.Object(
			{ pluginId: Type.String(), version: Type.Integer({ minimum: 1 }), contentHash: Type.String() },
			{ additionalProperties: false },
		),
	]),
};
const json = Type.Cyclic(
	{
		Json: Type.Union([
			Type.Null(),
			Type.Boolean(),
			Type.Number(),
			Type.String(),
			Type.Array(Type.Ref("Json")),
			Type.Record(Type.String(), Type.Ref("Json")),
		]),
	},
	"Json",
);

/** The sole installed source catalog selects services. Package names are informational, never a requirement. */
export function serviceCapabilityHandlers(
	deps: Dependencies,
): Record<
	"provider.inspect" | "provider.enumerate" | "provider.read" | "provider.write" | "provider.native",
	PluginCapabilityHandler
> {
	function declaredRole(role: string) {
		const declaration = deps.consumer.consumes;
		if (!declaration || !Object.hasOwn(declaration, role))
			throw new Error(`Undeclared provider role: ${role}`);
		return declaration[role] as PluginServiceRole;
	}
	function requirementFor(address: PluginProviderInspectionInput): { service: string; version: number } {
		if ("alias" in address) {
			const requires = deps.consumer.requires;
			if (!requires || !Object.hasOwn(requires, address.alias))
				throw new Error(`Undeclared provider alias: ${address.alias}`);
			return requires[address.alias] as PluginServiceRequirement;
		}
		const role = declaredRole(address.role);
		return { service: role.servicePrefix + address.member, version: role.version };
	}
	function resolve(address: PluginProviderInspectionInput): {
		inspection: PluginProviderInspection;
		target: PluginServiceTarget | null;
	} {
		const requirement = requirementFor(address);
		const candidates = deps.sources().flatMap((item) => {
			const declaration = item.source.provides;
			const provision =
				declaration && Object.hasOwn(declaration, requirement.service)
					? declaration[requirement.service]
					: undefined;
			return provision ? [{ ...item, provision }] : [];
		});
		const compatible = candidates.filter((item) => item.provision.version === requirement.version);
		const enabled = compatible.filter((item) => item.state === "enabled" && item.source.contentHash);
		let state: PluginProviderInspection["state"];
		if (!candidates.length) state = "absent";
		else if (!compatible.length) state = "incompatible";
		else if (enabled.length > 1) state = "ambiguous";
		else if (enabled.length === 1) state = "available";
		else state = compatible.some((item) => item.state !== "disabled") ? "unavailable" : "disabled";
		const selected = state === "available" ? enabled[0] : undefined;
		return {
			inspection: {
				state,
				service: requirement.service,
				requestedVersion: requirement.version,
				provider: selected
					? {
							pluginId: selected.source.pluginId,
							version: requirement.version,
							contentHash: selected.source.contentHash as string,
						}
					: null,
			},
			target: selected
				? {
						...selected,
						service: requirement.service,
						operations: selected.provision.operations,
					}
				: null,
		};
	}
	const execute = async (
		raw: unknown,
		context: PluginCapabilityContext,
		effect: "read" | "write",
		invoke: Dependencies["invoke"],
	) => {
		deps.check(context, effect);
		const input = raw as PluginProviderInvocationInput;
		const { inspection, target } = resolve(input);
		if (!target) throw new Error(`Provider ${inspection.service} is ${inspection.state}`);
		if (!target.operations.includes(input.operation))
			throw new Error(`Provider operation is not declared: ${input.operation}`);
		const result = await invoke(context, target, input, effect);
		deps.check(context, effect);
		const current = resolve(input);
		if (current.inspection.state !== "available" || current.target?.source !== target.source)
			throw new Error("Provider source selection changed during invocation");
		return result;
	};
	const invocation = (effect: "read" | "write"): PluginCapabilityHandler => ({
		effect,
		inputSchema: address({ operation: text, input: json }),
		resultSchema: json,
		approvalDetail: (raw) => {
			const input = raw as PluginProviderInvocationInput;
			const name = "alias" in input ? input.alias : `${input.role}/${input.member}`;
			return `${hostText("插件服务", "Plugin service")} ${name}: ${input.operation}`;
		},
		execute: (raw, context) => execute(raw, context, effect, deps.invoke),
	});
	return {
		"provider.inspect": {
			effect: "read",
			bootstrap: true,
			inputSchema: address(),
			resultSchema: Type.Object(inspectionFields, { additionalProperties: false }),
			execute: async (raw, context) => {
				deps.check(context, "read");
				return resolve(raw as PluginProviderInspectionInput).inspection;
			},
		},
		"provider.enumerate": {
			effect: "read",
			bootstrap: true,
			inputSchema: Type.Object({ role: text }, { additionalProperties: false }),
			resultSchema: Type.Object(
				{
					members: Type.Array(
						Type.Object({ member: text, ...inspectionFields }, { additionalProperties: false }),
					),
				},
				{ additionalProperties: false },
			),
			execute: async (raw, context): Promise<PluginProviderEnumeration> => {
				deps.check(context, "read");
				const { role } = raw as PluginProviderEnumerationInput;
				const { servicePrefix } = declaredRole(role);
				const members = new Set(
					deps
						.sources()
						.flatMap((item) => Object.keys(item.source.provides ?? {}))
						.filter((service) => service.startsWith(servicePrefix) && service.length > servicePrefix.length)
						.map((service) => service.slice(servicePrefix.length)),
				);
				return {
					members: [...members].sort().map((member) => ({ member, ...resolve({ role, member }).inspection })),
				};
			},
		},
		"provider.read": invocation("read"),
		"provider.write": invocation("write"),
		"provider.native": {
			effect: "read",
			inputSchema: address({ operation: text, input: json }),
			resultSchema: json,
			execute: (raw, context) => {
				const origin = context.nativeInvocation,
					effect = context.invocationEffect;
				if (!origin || !effect || context.bootstrap || context.scope.kind !== "session")
					throw new Error("Provider native calls require an in-flight actual SDK native event");
				return execute(raw, context, effect, (caller, target, input, ceiling) =>
					deps.invokeNative(caller, target, input, ceiling, origin),
				);
			},
		},
	};
}
