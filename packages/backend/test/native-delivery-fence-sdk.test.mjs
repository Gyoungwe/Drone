import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxAssistantMessage, fauxProvider, fauxThinking, fauxToolCall } from "@earendil-works/pi-ai";
import {
	createAgentSession,
	DefaultResourceLoader,
	ModelRuntime,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { expect, it, vi } from "vitest";
import { SessionEngine } from "../src/session-engine/engine";

function deferred() {
	let resolve;
	const promise = new Promise((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

async function actualSession(
	root,
	hostDeliveryBoundary,
	extensionFactories = [],
	response = fauxAssistantMessage("UNRELEASED_SYNTHETIC_DRAFT"),
	hostDeliveryRunStart,
) {
	const settingsManager = SettingsManager.inMemory({});
	const resourceLoader = new DefaultResourceLoader({
		cwd: root,
		agentDir: root,
		settingsManager,
		noExtensions: true,
		noSkills: true,
		noPromptTemplates: true,
		extensionFactories,
	});
	await resourceLoader.reload({ resolveProjectTrust: async () => true });
	expect(resourceLoader.getExtensions().errors).toEqual([]);
	const modelRuntime = await ModelRuntime.create({
		authPath: join(root, "auth.json"),
		modelsPath: null,
		allowModelNetwork: false,
		refreshOnCreate: false,
	});
	const faux = fauxProvider({ provider: "native-delivery-offline", tokensPerSecond: 0 });
	modelRuntime.registerNativeProvider(faux.provider);
	await modelRuntime.setRuntimeApiKey(faux.provider.id, "synthetic-offline-key");
	faux.setResponses([response]);
	const sessionManager = SessionManager.inMemory(root);
	const { session } = await createAgentSession({
		cwd: root,
		agentDir: root,
		settingsManager,
		resourceLoader,
		modelRuntime,
		model: faux.getModel(),
		sessionManager,
		tools: [],
		hostDeliveryBoundary,
		hostDeliveryRunStart,
	});
	await session.bindExtensions({
		onError: (error) => {
			throw error;
		},
	});
	return { session, sessionManager, faux, modelRuntime, settingsManager, resourceLoader };
}

it("awaits the host-only boundary after dynamically registered hooks and before public emit and append", async () => {
	const root = await mkdtemp(join(tmpdir(), "drone-native-delivery-"));
	const entered = deferred(),
		release = deferred();
	let session;
	const order = [],
		publicMessages = [];
	try {
		const actual = await actualSession(
			root,
			async (event, signal) => {
				order.push("boundary");
				expect(event.message.content[0].text).toBe("late SDK hook text");
				expect(signal).toBe(session.agent.signal);
				entered.resolve();
				await release.promise;
				event.message.content = [{ type: "text", text: "checked final text" }];
			},
			[
				(pi) => {
					pi.on("message_end", (event) => {
						if (event.message.role === "assistant") order.push("early-hook");
					});
					pi.on("agent_start", () =>
						pi.on("message_end", (event) => {
							if (event.message.role !== "assistant") return;
							order.push("dynamic-late-hook");
							event.message.content = [{ type: "text", text: "late SDK hook text" }];
						}),
					);
				},
			],
		);
		session = actual.session;
		session.subscribe((event) => {
			if (event.type !== "message_end" || event.message.role !== "assistant") return;
			order.push("public");
			expect(
				actual.sessionManager
					.getBranch()
					.some((entry) => entry.type === "message" && entry.message.role === "assistant"),
			).toBe(false);
			publicMessages.push(structuredClone(event.message));
		});
		let promptDone = false,
			idleDone = false;
		const prompt = session.prompt("Synthetic final delivery check.").finally(() => {
			promptDone = true;
		});
		await Promise.race([
			entered.promise,
			prompt.then(() => {
				throw new Error("SDK skipped the host-only delivery boundary");
			}),
		]);
		const idle = session.waitForIdle().then(() => {
			idleDone = true;
		});
		await new Promise((done) => setImmediate(done));
		expect({ promptDone, idleDone, public: publicMessages.length }).toEqual({
			promptDone: false,
			idleDone: false,
			public: 0,
		});
		expect(
			actual.sessionManager
				.getBranch()
				.some((entry) => entry.type === "message" && entry.message.role === "assistant"),
		).toBe(false);
		release.resolve();
		await Promise.all([prompt, idle]);
		expect(order).toEqual(["early-hook", "dynamic-late-hook", "boundary", "public"]);
		expect(publicMessages[0].content).toEqual([{ type: "text", text: "checked final text" }]);
		expect(
			actual.sessionManager
				.getBranch()
				.find((entry) => entry.type === "message" && entry.message.role === "assistant").message.content,
		).toEqual(publicMessages[0].content);
		expect(actual.faux.state.callCount).toBe(1);
	} finally {
		release.resolve();
		if (session) {
			await session.abort();
			session.dispose();
		}
		await rm(root, { recursive: true, force: true });
	}
});

it("rejects a late successful finalizer after real SDK abort without canceling another session or the next run", async () => {
	const root = await mkdtemp(join(tmpdir(), "drone-native-delivery-abort-"));
	const entered = deferred(),
		release = deferred();
	const signals = [],
		finals = [],
		siblingFinals = [];
	let session, sibling, faux;
	try {
		({ session, faux } = await actualSession(root, async (event, signal) => {
			signals.push(signal);
			if (signals.length === 1) {
				entered.resolve();
				await release.promise;
			}
			event.message.content = [{ type: "text", text: "LATE_SYNTHETIC_FINAL" }];
		}));
		({ session: sibling } = await actualSession(join(root, "sibling"), async (event) => {
			event.message.content = [{ type: "text", text: "sibling checked" }];
		}));
		session.subscribe((event) => {
			if (event.type === "message_end" && event.message.role === "assistant")
				finals.push(structuredClone(event.message));
		});
		sibling.subscribe((event) => {
			if (event.type === "message_end" && event.message.role === "assistant")
				siblingFinals.push(structuredClone(event.message));
		});
		const prompt = session.prompt("Synthetic interrupted request.");
		await entered.promise;
		let aborted = false;
		const abort = session.abort().then(() => {
			aborted = true;
		});
		await sibling.prompt("Synthetic independent request.");
		expect(aborted).toBe(false);
		expect(signals[0].aborted).toBe(true);
		expect(siblingFinals[0].content).toEqual([{ type: "text", text: "sibling checked" }]);
		release.resolve();
		await Promise.all([prompt, abort]);
		expect(finals[0]).toMatchObject({
			content: [],
			stopReason: "aborted",
			errorMessage: "Final delivery unavailable",
		});
		expect(JSON.stringify(session.sessionManager.getBranch())).not.toContain("LATE_SYNTHETIC_FINAL");
		faux.setResponses([fauxAssistantMessage("recovered underlying provider")]);
		await session.prompt("Synthetic recovery request.");
		expect(faux.state.callCount).toBe(2);
		expect(signals[1]).not.toBe(signals[0]);
		expect(signals[1].aborted).toBe(false);
		expect(finals[1].content).toEqual([{ type: "text", text: "LATE_SYNTHETIC_FINAL" }]);
	} finally {
		release.resolve();
		for (const current of [session, sibling])
			if (current) {
				await current.abort();
				current.dispose();
			}
		await rm(root, { recursive: true, force: true });
	}
});

it("neutralizes an unexpected boundary failure without publishing its private error or draft", async () => {
	const root = await mkdtemp(join(tmpdir(), "drone-native-delivery-failed-"));
	let session;
	const finals = [];
	try {
		({ session } = await actualSession(root, async () => {
			throw new Error("PRIVATE_SYNTHETIC_FAILURE");
		}));
		session.subscribe((event) => {
			if (event.type === "message_end" && event.message.role === "assistant")
				finals.push(structuredClone(event.message));
		});
		await session.prompt("Synthetic failed delivery.");
		expect(finals).toHaveLength(1);
		expect(finals[0]).toMatchObject({
			content: [],
			stopReason: "aborted",
			errorMessage: "Final delivery unavailable",
		});
		expect(JSON.stringify(session.sessionManager.getBranch())).not.toMatch(
			/PRIVATE_SYNTHETIC_FAILURE|UNRELEASED_SYNTHETIC_DRAFT/,
		);
		expect(finals[0].usage).toEqual(session.messages.find((message) => message.role === "assistant").usage);
	} finally {
		if (session) {
			await session.abort();
			session.dispose();
		}
		await rm(root, { recursive: true, force: true });
	}
});

it("never appends or publicly emits a held assistant after synchronous SDK dispose", async () => {
	const root = await mkdtemp(join(tmpdir(), "drone-native-delivery-disposed-"));
	const entered = deferred(),
		release = deferred();
	let session;
	const finals = [];
	try {
		({ session } = await actualSession(root, async (event) => {
			entered.resolve();
			await release.promise;
			event.message.content = [{ type: "text", text: "LATE_AFTER_DISPOSE" }];
		}));
		session.subscribe((event) => {
			if (event.type === "message_end" && event.message.role === "assistant") finals.push(event.message);
		});
		const prompt = session.prompt("Synthetic closing request.");
		await entered.promise;
		session.dispose();
		release.resolve();
		await prompt;
		expect(finals).toEqual([]);
		expect(
			session.sessionManager
				.getBranch()
				.some((entry) => entry.type === "message" && entry.message.role === "assistant"),
		).toBe(false);
	} finally {
		release.resolve();
		if (session) {
			await session.abort();
			session.dispose();
		}
		await rm(root, { recursive: true, force: true });
	}
});

it("keeps exact tool-call protocol and usage while suppressing private blocks when a boundary fails", async () => {
	const root = await mkdtemp(join(tmpdir(), "drone-native-delivery-protocol-"));
	let session;
	const call = fauxToolCall(
		"unavailable_tool",
		{ query: "synthetic scoped query" },
		{ id: "synthetic-call-id" },
	);
	const thinking = {
		...fauxThinking("PRIVATE_SYNTHETIC_THINKING"),
		thinkingSignature: "PRIVATE_SYNTHETIC_SIGNATURE",
	};
	const response = fauxAssistantMessage(
		[thinking, { type: "text", text: "PRIVATE_SYNTHETIC_PREFACE" }, call],
		{ stopReason: "toolUse", responseId: "synthetic-response-id" },
	);
	response.usage.input = 37;
	response.usage.output = 11;
	response.usage.totalTokens = 48;
	let beforeUsage;
	try {
		({ session } = await actualSession(
			root,
			async (event) => {
				beforeUsage = structuredClone(event.message.usage);
				throw new Error("PRIVATE_SYNTHETIC_PROTOCOL_FAILURE");
			},
			[],
			response,
		));
		await session.prompt("Synthetic tool protocol check.");
		const persisted = session.sessionManager
			.getBranch()
			.find((entry) => entry.type === "message" && entry.message.role === "assistant").message;
		expect(persisted.content).toEqual([call]);
		expect(persisted.responseId).toBe("synthetic-response-id");
		expect(persisted.usage).toEqual(beforeUsage);
		expect(JSON.stringify(persisted)).not.toMatch(/PRIVATE_SYNTHETIC/);
	} finally {
		if (session) {
			await session.abort();
			session.dispose();
		}
		await rm(root, { recursive: true, force: true });
	}
});

it("drains real finalizer cleanup before SessionEngine disposes the SDK session", async () => {
	const root = await mkdtemp(join(tmpdir(), "drone-native-delivery-engine-close-"));
	const entered = deferred(),
		aborted = deferred(),
		cleanupRelease = deferred();
	const order = [];
	let session;
	try {
		({ session } = await actualSession(root, async (event, signal) => {
			entered.resolve();
			await new Promise((done) => signal.addEventListener("abort", done, { once: true }));
			order.push("abort-observed");
			aborted.resolve();
			await cleanupRelease.promise;
			order.push("cleanup-done");
			event.message.content = [{ type: "text", text: "LATE_AFTER_HOST_CLOSE" }];
		}));
		const originalDispose = session.dispose.bind(session);
		session.dispose = () => {
			order.push("sdk-dispose");
			originalDispose();
		};
		const prompt = session.prompt("Synthetic host close check.");
		await entered.promise;
		let closeDone = false;
		const close = new SessionEngine().dispose(session).then(() => {
			closeDone = true;
		});
		await aborted.promise;
		await new Promise((done) => setImmediate(done));
		expect(closeDone).toBe(false);
		expect(order).toEqual(["abort-observed"]);
		cleanupRelease.resolve();
		await Promise.all([prompt, close]);
		expect(order).toEqual(["abort-observed", "cleanup-done", "sdk-dispose"]);
		expect(JSON.stringify(session.sessionManager.getBranch())).not.toContain("LATE_AFTER_HOST_CLOSE");
	} finally {
		cleanupRelease.resolve();
		if (session) {
			await session.abort();
			session.dispose();
		}
		await rm(root, { recursive: true, force: true });
	}
});

it("keeps ordinary official SDK chat unchanged when no host delivery policy is installed", async () => {
	const root = await mkdtemp(join(tmpdir(), "drone-native-delivery-absent-"));
	let session;
	try {
		({ session } = await actualSession(root, undefined));
		await session.prompt("Synthetic ordinary chat.");
		expect(
			session.sessionManager
				.getBranch()
				.find((entry) => entry.type === "message" && entry.message.role === "assistant").message.content,
		).toEqual([{ type: "text", text: "UNRELEASED_SYNTHETIC_DRAFT" }]);
	} finally {
		if (session) {
			await session.abort();
			session.dispose();
		}
		await rm(root, { recursive: true, force: true });
	}
});

it("distinguishes real SDK historical origins from a new live message with copied body, timestamp and ID", async () => {
	const root = await mkdtemp(join(tmpdir(), "drone-native-historical-origin-"));
	let session, faux, history;
	let round = 0;
	try {
		({ session, faux } = await actualSession(root, async (event) => {
			if (++round !== 2) return;
			// This is the genuine new agent-core message, with copied public historical data.
			for (const key of Object.keys(event.message)) delete event.message[key];
			Object.assign(event.message, structuredClone(history));
			expect(session.getHostPersistedMessage(event.message)).toBeUndefined();
		}));
		expect(typeof session.getHostPersistedMessage).toBe("function");
		await session.prompt("Synthetic historical answer.");
		history = session.messages.find((message) => message.role === "assistant");
		const entry = session.getHostPersistedMessage(history);
		expect(entry.type).toBe("message");
		expect(entry.message.content).toEqual(history.content);
		const copied = { ...structuredClone(history), id: entry.id };
		expect(session.getHostPersistedMessage(copied)).toBeUndefined();
		faux.setResponses([fauxAssistantMessage("new live answer before historical copy")]);
		await session.prompt("Synthetic fresh live answer.");
		expect(round).toBe(2);
	} finally {
		if (session) {
			await session.abort();
			session.dispose();
		}
		await rm(root, { recursive: true, force: true });
	}
});

it("recognizes actual SDK reload origins, rejects an old branch and invalidates disposed historical scope", async () => {
	const root = await mkdtemp(join(tmpdir(), "drone-native-historical-branch-"));
	let session;
	try {
		({ session } = await actualSession(root, undefined));
		expect(typeof session.getHostPersistedMessage).toBe("function");
		await session.prompt("Synthetic persisted branch.");
		await session.reload();
		const restored = session.messages.find((message) => message.role === "assistant");
		const actualEntry = session.getHostPersistedMessage(restored);
		expect(actualEntry.message.content).toEqual(restored.content);
		expect(session.getHostPersistedMessage(structuredClone(restored))).toBeUndefined();
		const user = session.sessionManager
			.getBranch()
			.find((entry) => entry.type === "message" && entry.message.role === "user");
		session.sessionManager.branch(user.id);
		session.refreshContext();
		expect(session.getHostPersistedMessage(restored)).toBeUndefined();
		const current = session.messages.find((message) => message.role === "user");
		expect(session.getHostPersistedMessage(current).id).toBe(user.id);
		session.dispose();
		expect(session.getHostPersistedMessage(current)).toBeUndefined();
	} finally {
		if (session) {
			await session.abort();
			session.dispose();
		}
		await rm(root, { recursive: true, force: true });
	}
});

async function abortAtOfficialMessageHook(boundary, start, onAgentStart) {
	const root = await mkdtemp(join(tmpdir(), "drone-native-ordinary-abort-"));
	const entered = deferred(),
		release = deferred();
	let session;
	try {
		({ session } = await actualSession(
			root,
			boundary,
			[
				(pi) => {
					pi.on("agent_start", () => onAgentStart?.());
					pi.on("message_end", async (event) => {
						if (event.message.role !== "assistant") return;
						entered.resolve();
						await release.promise;
					});
				},
			],
			undefined,
			start,
		));
		const prompt = session.prompt("Synthetic ordinary abort behavior.");
		await entered.promise;
		const aborted = session.abort();
		release.resolve();
		await Promise.all([prompt, aborted]);
		const actual = session.sessionManager
			.getBranch()
			.find((entry) => entry.type === "message" && entry.message.role === "assistant").message;
		return {
			content: actual.content,
			stopReason: actual.stopReason,
			errorMessage: actual.errorMessage,
			usage: actual.usage,
		};
	} finally {
		release.resolve();
		if (session) {
			await session.abort();
			session.dispose();
		}
		await rm(root, { recursive: true, force: true });
	}
}

it("keeps ordinary SDK abort identical to callback absence when the host proves this run has no required policy", async () => {
	const standard = await abortAtOfficialMessageHook(undefined);
	const noPolicy = await abortAtOfficialMessageHook(
		async () => false,
		() => undefined,
	);
	expect(noPolicy).toEqual(standard);
	expect(standard.content).toEqual([{ type: "text", text: "UNRELEASED_SYNTHETIC_DRAFT" }]);
});

it("runs the host start latch before SDK hooks and keeps a required-at-start run guarded after later source removal", async () => {
	const runs = new WeakMap();
	const order = [];
	let currentlyRequired = true;
	const actual = await abortAtOfficialMessageHook(
		async (_event, signal) => {
			expect(currentlyRequired).toBe(false);
			expect(runs.has(signal)).toBe(true);
			return runs.get(signal) ? undefined : false;
		},
		(signal) => {
			order.push("host-start");
			runs.set(signal, currentlyRequired);
		},
		() => {
			order.push("SDK-hook");
			currentlyRequired = false;
		},
	);
	expect(order).toEqual(["host-start", "SDK-hook"]);
	expect(actual).toMatchObject({
		content: [],
		stopReason: "aborted",
		errorMessage: "Final delivery unavailable",
	});
});

it.each([undefined, async () => false])(
	"fails closed when the host start callback fails even with final callback %s",
	async (boundary) => {
		const root = await mkdtemp(join(tmpdir(), "drone-native-start-failed-"));
		let session;
		const events = [];
		try {
			({ session } = await actualSession(root, boundary, [], undefined, () => {
				throw new Error("PRIVATE_START_INITIALIZATION_FAILURE");
			}));
			session.subscribe((event) => events.push(structuredClone(event)));
			await session.prompt("Synthetic host start failure.");
			const final = session.sessionManager
				.getBranch()
				.find((entry) => entry.type === "message" && entry.message.role === "assistant").message;
			expect(final).toMatchObject({
				content: [],
				stopReason: "aborted",
				errorMessage: "Host delivery initialization failed",
			});
			expect(JSON.stringify(events)).not.toMatch(
				/PRIVATE_START_INITIALIZATION_FAILURE|UNRELEASED_SYNTHETIC_DRAFT/,
			);
		} finally {
			if (session) {
				await session.abort();
				session.dispose();
			}
			await rm(root, { recursive: true, force: true });
		}
	},
);

it("forwards the host start/final hooks through actual SessionEngine create and open", async () => {
	const root = await mkdtemp(join(tmpdir(), "drone-native-start-engine-"));
	const sessions = [];
	const signals = [];
	let seed;
	vi.stubEnv("PI_CODING_AGENT_DIR", join(root, "agent"));
	const engine = new SessionEngine();
	try {
		seed = await actualSession(root, undefined);
		await engine.dispose(seed.session);
		const options = {
			agentDir: root,
			resourceLoader: seed.resourceLoader,
			settingsManager: seed.settingsManager,
			model: seed.faux.getModel(),
			tools: [],
			hostDeliveryRunStart: (signal) => {
				signals.push(signal);
			},
			hostDeliveryBoundary: async () => undefined,
		};
		const { session: created } = await engine.create(root, options, seed.modelRuntime);
		sessions.push(created);
		await created.bindExtensions({});
		await created.prompt("Synthetic created session with host start.");
		const file = created.sessionFile;
		expect(file).toContain(root);
		await engine.dispose(created);
		seed.faux.setResponses([fauxAssistantMessage("reopened actual SDK session")]);
		const { session: opened } = await engine.open(file, { ...options, cwd: root }, seed.modelRuntime);
		sessions.push(opened);
		await opened.bindExtensions({});
		await opened.prompt("Synthetic reopened session with host start.");
		expect(signals).toHaveLength(2);
		expect(signals[1]).not.toBe(signals[0]);
		expect(opened.messages.findLast((message) => message.role === "assistant").content).toEqual([
			{ type: "text", text: "reopened actual SDK session" },
		]);
	} finally {
		for (const session of sessions) await engine.dispose(session);
		if (seed) await engine.dispose(seed.session);
		vi.unstubAllEnvs();
		await rm(root, { recursive: true, force: true });
	}
});
