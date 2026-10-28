import type {
	PluginProviderInspection,
	PluginProviderInspectionInput,
	PluginProviderInvocationInput,
} from "@gyoungwe/plugin-api/runtime";
import { Type } from "typebox";
import { hostText } from "../reply-language";
import type { PluginRuntimeBridgeOptions, PluginRuntimeSource } from "./coordinator";
import type { PluginCapabilityContext, PluginCapabilityHandler } from "./runtime-capabilities";

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
}

const text = Type.String({ minLength: 1, maxLength: 128 });
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
): Record<"provider.inspect" | "provider.read" | "provider.write", PluginCapabilityHandler> {
	function resolve(alias: string): {
		inspection: PluginProviderInspection;
		target: PluginServiceTarget | null;
	} {
		const requirement = deps.consumer.requires?.[alias];
		if (!requirement || !Object.hasOwn(deps.consumer.requires, alias))
			throw new Error(`Undeclared provider alias: ${alias}`);
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
	const invocation = (effect: "read" | "write"): PluginCapabilityHandler => ({
		effect,
		inputSchema: Type.Object({ alias: text, operation: text, input: json }, { additionalProperties: false }),
		resultSchema: json,
		approvalDetail: (raw) => {
			const input = raw as PluginProviderInvocationInput;
			return `${hostText("插件服务", "Plugin service")} ${input.alias}: ${input.operation}`;
		},
		execute: async (raw, context) => {
			deps.check(context, effect);
			const input = raw as PluginProviderInvocationInput;
			const { inspection, target } = resolve(input.alias);
			if (!target) throw new Error(`Provider ${input.alias} is ${inspection.state}`);
			if (!target.operations.includes(input.operation))
				throw new Error(`Provider operation is not declared: ${input.operation}`);
			const result = await deps.invoke(context, target, input, effect);
			deps.check(context, effect);
			const current = resolve(input.alias);
			if (current.inspection.state !== "available" || current.target?.source !== target.source)
				throw new Error("Provider source selection changed during invocation");
			return result;
		},
	});
	return {
		"provider.inspect": {
			effect: "read",
			bootstrap: true,
			inputSchema: Type.Object({ alias: text }, { additionalProperties: false }),
			resultSchema: Type.Object(
				{
					state: Type.Union(
						["available", "absent", "disabled", "unavailable", "incompatible", "ambiguous"].map((state) =>
							Type.Literal(state),
						),
					),
					service: text,
					requestedVersion: Type.Integer({ minimum: 1 }),
					provider: Type.Union([
						Type.Null(),
						Type.Object(
							{ pluginId: Type.String(), version: Type.Integer({ minimum: 1 }), contentHash: Type.String() },
							{ additionalProperties: false },
						),
					]),
				},
				{ additionalProperties: false },
			),
			execute: async (raw, context) => {
				deps.check(context, "read");
				return resolve((raw as PluginProviderInspectionInput).alias).inspection;
			},
		},
		"provider.read": invocation("read"),
		"provider.write": invocation("write"),
	};
}
