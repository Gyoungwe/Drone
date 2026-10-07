import type { AgentToolResult, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
	buildSshArgs,
	resolveRegisteredHost,
	runLocalSsh,
	type SshApproval,
	type SshHostEntry,
	type SshRunner,
} from "../ssh";
import {
	applyVerification,
	type EnvRecord,
	type EnvRegistry,
	envsOnHost,
	findReusable,
	formatRecord,
	loadRegistry,
	parseVerifyOutput,
	remoteVerifyScript,
	removeEnv,
	saveRegistry,
	upsertEnv,
	verifyArgv,
} from "./env-registry";
import { parseVersion } from "./environment";
import { onPath, runWithCode } from "./exec";
import { osName } from "./platform";

export interface EnvRegistryToolOptions {
	agentDir: string;
	confirm?: SshApproval;
	hosts?: () => Promise<SshHostEntry[]>;
	run?: SshRunner;
	/** local verification runner (tests); default spawns `<manager> run -n <env> <tool> --version` */
	verifyLocal?: (argv: string[]) => Promise<{ code: number | null; output: string }>;
	now?: () => string;
	platform?: () => string;
}

const params = Type.Object({
	action: Type.Union(
		[
			Type.Literal("list"),
			Type.Literal("find"),
			Type.Literal("record"),
			Type.Literal("verify"),
			Type.Literal("forget"),
		],
		{
			description:
				"list: registered envs; find: envs covering `tools`; record: register/update an env you created; verify: re-check tools inside an env; forget: drop a stale entry (does not delete the env).",
		},
	),
	host: Type.Optional(
		Type.String({ minLength: 1, maxLength: 255, description: 'Registered SSH host alias; omit for "local"' }),
	),
	name: Type.Optional(Type.String({ pattern: "^[A-Za-z0-9._-]{1,64}$", description: "Environment name" })),
	manager: Type.Optional(
		Type.Union([Type.Literal("mamba"), Type.Literal("micromamba"), Type.Literal("conda")], {
			description: "Environment manager used to create it (record)",
		}),
	),
	prefix: Type.Optional(Type.String({ maxLength: 500, description: "Env prefix path when not a named env" })),
	tools: Type.Optional(
		Type.Array(Type.String({ pattern: "^[A-Za-z0-9._+-]{1,40}$" }), {
			maxItems: 30,
			description: "Command-line tools to find or verify (e.g. mafft, iqtree2, FastTree)",
		}),
	),
	packages: Type.Optional(Type.Array(Type.String({ maxLength: 80 }), { maxItems: 60 })),
	purpose: Type.Optional(Type.String({ maxLength: 200 })),
});

export interface EnvRegistryDetails {
	envs: EnvRecord[];
}

/**
 * bio_env_registry：跨会话复用分析环境。只读写 Drone 自己的登记文件；
 * 本地验证只运行 `<manager> run … --version`，远程验证走 SSH 并且每次都要用户批准。
 */
export function makeEnvRegistryTool(options: EnvRegistryToolOptions): ToolDefinition<typeof params> {
	const now = options.now ?? (() => new Date().toISOString());
	const platformLabel = () => {
		const raw = options.platform?.() ?? process.platform;
		return `${osName(raw)} ${process.arch}`;
	};
	const verifyLocal =
		options.verifyLocal ??
		(async (argv: string[]) => {
			const [command, ...args] = argv;
			const path = command ? await onPath(command) : null;
			return path ? runWithCode(path, args, 60_000) : { code: null, output: `${command} not found` };
		});
	const verify = async (record: EnvRecord, tools: string[], signal?: AbortSignal) => {
		if (record.host === "local") {
			const observed: Record<string, string | null> = {};
			for (const tool of tools) {
				const { code, output } = await verifyLocal(verifyArgv(record, tool));
				observed[tool] = code === 0 ? parseVersion(output) : null;
			}
			return observed;
		}
		const host = record.host;
		const command = remoteVerifyScript(record, tools);
		const approved = options.confirm
			? await options.confirm(
					`SSH access: ${host} :: bio_env_registry verify ${record.name}`,
					[
						"The agent wants to check that a registered analysis environment still works on a remote host.",
						`Host: ${host}`,
						`It only runs version flags inside env ${record.name}: ${tools.join(", ")}.`,
					].join("\n"),
				)
			: false;
		if (!approved) throw new Error("bio_env_registry: user approval required for remote verification");
		const { args } = buildSshArgs({ host, command });
		const result = await (options.run ?? runLocalSsh)(args, { signal, timeoutMs: 120_000 });
		return parseVerifyOutput(result.stdout);
	};
	return {
		name: "bio_env_registry",
		label: "Analysis environment registry",
		description:
			"Remember analysis environments (conda/mamba) across sessions, locally or on registered SSH hosts. Workflow: bio_environment → find (reuse an env that has the tools) → verify it → only if none, create one with mamba (inside the approved task plan) → record it → run tools via `<manager> run -n <env> <tool>`. Stores metadata only in Drone's environments.json; never stores passwords.",
		promptSnippet: "bio_env_registry({action:list|find|record|verify|forget, host?, name?, tools?})",
		parameters: params,
		executionMode: "sequential",
		execute: async (_id, input, signal, _update, _ctx): Promise<AgentToolResult<EnvRegistryDetails>> => {
			const host =
				input.host && input.host !== "local"
					? options.hosts
						? resolveRegisteredHost(input.host, await options.hosts())
						: input.host
					: "local";
			let registry: EnvRegistry = await loadRegistry(options.agentDir);
			const reply = (text: string, envs: EnvRecord[]) => ({
				content: [{ type: "text" as const, text }],
				details: { envs },
			});
			if (input.action === "list") {
				const envs = input.host ? envsOnHost(registry, host) : registry.envs;
				return reply(
					envs.length ? envs.map(formatRecord).join("\n") : "No analysis environments are registered yet.",
					envs,
				);
			}
			if (input.action === "find") {
				const tools = input.tools ?? [];
				const envs = findReusable(registry, host, tools);
				return reply(
					envs.length
						? `Reusable on ${host} (verify before use):\n${envs.map(formatRecord).join("\n")}`
						: `No registered env on ${host} has ${tools.join(", ") || "those tools"}. Create one (e.g. \`mamba create -n <name> -c conda-forge -c bioconda ${tools.join(" ").toLowerCase()}\`) inside the approved task plan, then call record.`,
					envs,
				);
			}
			const name = input.name;
			if (!name) throw new Error(`bio_env_registry ${input.action}: name is required`);
			const existing = registry.envs.find((e) => e.host === host && e.name === name);
			if (input.action === "forget") {
				registry = removeEnv(registry, host, name);
				await saveRegistry(options.agentDir, registry);
				return reply(`Forgot ${name} @ ${host} (the environment itself was not deleted).`, []);
			}
			if (input.action === "record") {
				let record: EnvRecord = {
					...(existing ?? {}),
					name,
					host,
					manager: input.manager ?? existing?.manager ?? "mamba",
					...(input.prefix ? { prefix: input.prefix } : {}),
					tools: existing?.tools ?? {},
					...(input.packages ? { packages: input.packages } : {}),
					...(input.purpose ? { purpose: input.purpose } : {}),
					platform: host === "local" ? platformLabel() : (existing?.platform ?? "remote"),
					createdAt: existing?.createdAt ?? now(),
					status: existing?.status ?? "unverified",
				};
				const tools = input.tools ?? [];
				if (tools.length) record = applyVerification(record, await verify(record, tools, signal), now());
				registry = upsertEnv(registry, record);
				await saveRegistry(options.agentDir, registry);
				return reply(`Recorded:\n${formatRecord(record)}`, [record]);
			}
			// verify
			if (!existing) throw new Error(`bio_env_registry verify: ${name} is not registered on ${host}`);
			const tools = input.tools?.length ? input.tools : Object.keys(existing.tools);
			if (!tools.length) throw new Error("bio_env_registry verify: pass tools to check");
			const updated = applyVerification(existing, await verify(existing, tools, signal), now());
			registry = upsertEnv(registry, updated);
			await saveRegistry(options.agentDir, registry);
			const missing = tools.filter((t) => !updated.tools[t]);
			return reply(
				`${formatRecord(updated)}${missing.length ? `\nMissing now: ${missing.join(", ")} — install them into this env (\`${updated.manager} install -n ${updated.name} -c conda-forge -c bioconda ${missing.join(" ").toLowerCase()}\`) or create a new one.` : ""}`,
				[updated],
			);
		},
	};
}
