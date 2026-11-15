import { createHash } from "node:crypto";
import { lstat, readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import type {
	ControlledKernelRunner,
	CriticProvider,
	InquiryDiscoveryPort,
	KernelLanguage,
	KernelSession,
} from "@drone/discovery";
import type { DiscoveryHostInput, DiscoveryHostServices, DiscoveryJournalName } from "@gyoungwe/plugin-api";
import {
	ContainerSandboxRunner as ContainerKernelRunner,
	type ContainerSandboxOptions as ContainerKernelRunnerOptions,
} from "@gyoungwe/plugin-api/node/execution";
import { JsonStore, JsonStoreCorruptedError } from "../json-store";
import type { StorageRegistry } from "../storage/registry";
import { ProjectRunFileWriter } from "./run-files";

export type DiscoveryAuthorizationOperation =
	| { readonly kind: "create-kernel-session"; readonly projectId: string }
	| { readonly kind: "execute-kernel"; readonly projectId: string; readonly sessionId: string }
	| { readonly kind: "export-kernel"; readonly projectId: string; readonly sessionId: string }
	| { readonly kind: "close-kernel-session"; readonly projectId: string; readonly sessionId: string }
	| { readonly kind: "multipath-execution"; readonly projectId: string; readonly planId: string }
	| { readonly kind: "evaluation-execution"; readonly projectId: string; readonly runId: string };

export type DiscoveryAuthorization = (operation: DiscoveryAuthorizationOperation) => Promise<void>;

export interface DiscoveryServiceOptions {
	readonly projectId: string;
	readonly projectRoot: string;
	readonly storage?: StorageRegistry;
	readonly agentDir?: string;
	/** Existing unassigned journal root, reported without automatic adoption. */
	readonly legacyJournalRoot?: string;
	readonly inquiry?: InquiryDiscoveryPort;
	readonly authorize?: DiscoveryAuthorization;
	readonly runner?: ControlledKernelRunner;
	readonly runnerFactory?: (language: KernelLanguage) => Promise<ControlledKernelRunner>;
	readonly container?: Omit<ContainerKernelRunnerOptions, "projectRoot">;
	readonly criticProvider?: CriticProvider;
	readonly onExecution?: (input: {
		readonly sessionId: string;
		readonly projectId: string;
		readonly cwd: string;
		readonly runDirectory: string;
		readonly language: string;
		readonly code: string;
		readonly execution: Awaited<ReturnType<KernelSession["execute"]>>;
	}) => void | Promise<void>;
}

const journalNames: readonly DiscoveryJournalName[] = [
	"sessions",
	"critics",
	"multipath",
	"plans",
	"evaluations",
	"baselines",
];

/** Infrastructure is constructed only for an installed capability; kernels remain lazy. */
export function createDiscoveryHostInput(
	options: DiscoveryServiceOptions,
	reserveWriter: () => Promise<void>,
	retainWriter: (error: unknown) => void,
): DiscoveryHostInput {
	const projectRoot = resolve(options.projectRoot);
	const root = resolve(options.agentDir ?? join(projectRoot, "runs", ".drone-discovery"));
	options.storage?.registerDiscoveredRoot("discovery-root", root, "discovery/service", "private");
	let runnerPromise: Promise<ControlledKernelRunner> | undefined;
	const files = new ProjectRunFileWriter(projectRoot);
	const services: DiscoveryHostServices = {
		journal: <T>(name: DiscoveryJournalName) => {
			if (!journalNames.includes(name)) throw new Error("Unknown discovery journal");
			const entry = options.storage?.registerDiscoveredRoot(
				`discovery-${name}`,
				join(root, `${name}.json`),
				`discovery/${name}`,
				"private",
			);
			const store = new JsonStore<T[]>({
				path: join(root, `${name}.json`),
				storageId: entry?.id ?? `agent-discovery-${name}`,
				defaultValue: () => [],
			});
			let expectedVersion: string | null | undefined;
			const snapshot = async () => {
				const path = join(root, `${name}.json`);
				let text: string;
				try {
					if ((await lstat(root)).isSymbolicLink() || (await lstat(path)).isSymbolicLink())
						throw new Error("Discovery journal path contains a symlink");
					text = await readFile(path, "utf8");
				} catch (error) {
					if ((error as NodeJS.ErrnoException).code === "ENOENT") return { value: [] as T[], version: null };
					throw error;
				}
				let value: unknown;
				try {
					value = JSON.parse(text);
				} catch (error) {
					throw new JsonStoreCorruptedError(path, error);
				}
				if (!Array.isArray(value))
					throw new JsonStoreCorruptedError(path, new Error("Discovery journal must contain an array"));
				return { value: value as T[], version: createHash("sha256").update(text).digest("hex") };
			};
			return {
				read: async () => {
					const current = await snapshot();
					expectedVersion = current.version;
					return current.value;
				},
				write: async (records: T[]) => {
					await reserveWriter();
					const writtenHash = createHash("sha256")
						.update(`${JSON.stringify(records, null, 2)}\n`)
						.digest("hex");
					const current = await store
						.writeChecked(records, {
							check: async () => {
								if (expectedVersion === undefined || (await snapshot()).version !== expectedVersion)
									throw new Error("Discovery journal changed; close and reopen this owner before writing");
							},
							readBack: async () => {
								const stored = await snapshot();
								if (stored.version !== writtenHash)
									throw new Error("Discovery journal did not read back after write");
								return stored;
							},
						})
						.catch((error) => {
							if (error instanceof AggregateError) retainWriter(error);
							throw error;
						});
					expectedVersion = current.version;
				},
			};
		},
		authorize: async (operation) => {
			if (operation.projectId !== options.projectId)
				throw new Error("Discovery authorization belongs to another project");
			if (!options.authorize) throw new Error("discovery operation requires task authorization");
			await options.authorize(operation);
			await reserveWriter();
		},
		runner: async (language) => {
			let runner: ControlledKernelRunner;
			if (options.runner) runner = options.runner;
			else if (options.runnerFactory) runner = await options.runnerFactory(language);
			else {
				if (!runnerPromise)
					runnerPromise = ContainerKernelRunner.create({ projectRoot, ...options.container }).then(
						(value) =>
							value ?? {
								capabilities: {
									kind: "unavailable" as const,
									languages: ["python", "r"],
									networkDisabled: false,
									writesOnlyToRunDirectory: false,
								},
								run: async () => {
									throw new Error("needs-container");
								},
							},
					);
				runner = await runnerPromise;
			}
			if (runner.capabilities.kind !== "fixture") return runner;
			return {
				capabilities: runner.capabilities,
				run: async (request) => {
					// Logical creation has no filesystem effect. Legacy fixture execution prepares its real cwd
					// only after the service's actual execute authorization, using the same confined writer.
					await files.prepareDirectory(request.runDirectory);
					return runner.run({ ...request, runDirectory: resolve(projectRoot, request.runDirectory) });
				},
			};
		},
		files,
		...(options.inquiry ? { inquiry: options.inquiry } : {}),
		...(options.criticProvider ? { criticProvider: options.criticProvider } : {}),
		legacyJournal: async () => {
			if (!options.legacyJournalRoot || resolve(options.legacyJournalRoot) === root) return undefined;
			for (const name of journalNames) {
				try {
					if ((await stat(join(options.legacyJournalRoot, `${name}.json`))).isFile())
						return { status: "unassigned", path: options.legacyJournalRoot };
				} catch (error) {
					if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
				}
			}
			return undefined;
		},
		onExecution: (receipt) =>
			options.onExecution?.({ ...receipt, projectId: options.projectId, cwd: projectRoot }),
	};
	return { projectId: options.projectId, projectRoot, agentDir: root, services };
}
