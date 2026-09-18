import { createHash } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { RESEARCH_SKILL_SOURCES } from "@drone/shared";
import type { ExtensionAPI, ExtensionFactory, RegisteredCommand } from "@earendil-works/pi-coding-agent";
import type { CapabilityRuntime } from "./runtime";

type Hook = (event: any, ctx: any) => any;
const STATE = "ars-pi-state";
const ARS_SKILL = /^(deep-research|academic-paper|academic-paper-reviewer|academic-pipeline)$/;
const CONTROL = /^ars-pi-(start|stop|doctor)$/;

/** Delegates to the pinned, unmodified upstream wrapper. The host owns final task visibility. */
export async function attachAcademicPiBridge(pi: ExtensionAPI, runtime: CapabilityRuntime, root: string) {
	const source = RESEARCH_SKILL_SOURCES.find((s) => s.id === "academic");
	if (!source) throw new Error("Missing academic source lock");
	const receipt = JSON.parse(readFileSync(join(root, ".drone-pack.json"), "utf8"));
	if (
		receipt.commit !== source.commit ||
		!["noncommercial", "separate-permission"].includes(receipt.licenseAuthorization)
	)
		throw new Error("ARS Pi requires a verified source and explicit license authorization");
	const canonicalRoot = realpathSync(root);
	for (const file of source.runtimeFiles) {
		if (realpathSync(join(root, file.path)) !== join(canonicalRoot, file.path))
			throw new Error(`ARS Pi runtime must not be redirected: ${file.path}`);
		const actual = createHash("sha256")
			.update(readFileSync(join(root, file.path)))
			.digest("hex");
		if (actual !== file.sha256) throw new Error(`ARS Pi runtime integrity mismatch: ${file.path}`);
	}
	const original = (await import(/* @vite-ignore */ pathToFileURL(join(root, "pi/wrapper.js")).href))
		.default as ExtensionFactory;
	const hooks = new Map<string, Hook>();
	const commands = new Map<string, Omit<RegisteredCommand, "name" | "sourceInfo">>();
	const facade = new Proxy(pi, {
		get(target, key) {
			if (key === "on")
				return (name: string, handler: Hook) => {
					hooks.set(name, handler);
				};
			if (key === "registerCommand")
				return (name: string, command: Omit<RegisteredCommand, "name" | "sourceInfo">) => {
					commands.set(name, command);
				};
			if (key === "appendEntry")
				return (type: string, data: any) => {
					target.appendEntry(type, data);
					if (type === STATE) runtime.setAcademicMode(data?.active === true);
				};
			return Reflect.get(target, key);
		},
	});
	await original(facade);
	runtime.manageAcademic();
	const feedback = (message: string) =>
		pi.sendMessage({ customType: "ars-pi-bridge", content: message, display: true });
	const matchesSource = (name: string) => {
		const path = runtime.skillPath(name);
		if (!path) return false;
		try {
			return realpathSync(path) === realpathSync(join(root, name, "SKILL.md"));
		} catch {
			return false;
		}
	};
	const restore = async (event: any, ctx: any, name: string) => {
		await hooks.get(name)?.(event, ctx);
		const entry = ctx.sessionManager
			.getBranch()
			.filter((e: any) => e.type === "custom" && e.customType === STATE)
			.pop();
		runtime.restoreRouting(entry?.data?.active === true);
	};
	pi.on("session_start", (event, ctx) => restore(event, ctx, "session_start"));
	pi.on("session_tree", (event, ctx) => restore(event, ctx, "session_tree"));
	for (const [name, command] of commands)
		pi.registerCommand(name, {
			...command,
			handler: async (args, ctx) => {
				if (name !== "ars-pi-doctor" && !ctx.isIdle()) {
					feedback(
						"ARS mode changes require an idle agent. Nothing changed; retry this command after the current run finishes.",
					);
					return;
				}
				if (name === "ars-pi-start" && !source.skills.every((s) => matchesSource(s.name))) {
					feedback(
						"ARS cannot start: a required skill is missing or shadowed by another installed skill. Resolve the catalog collision first; no user skill was overwritten.",
					);
					return;
				}
				await command.handler(args, ctx);
			},
		});
	return {
		async input(event: any, ctx: any): Promise<{ result: any; routingText?: string }> {
			const command = event.text.match(/^\/(ars-[a-z0-9-]+)(?:\s+([\s\S]*))?$/);
			const direct = event.text.match(/^\/skill:([a-z0-9-]+)(?:\s+([\s\S]*))?$/);
			const isArs = !!command || (direct && ARS_SKILL.test(direct[1]));
			if (!isArs) return { result: { action: "continue" } };
			if (event.streamingBehavior !== undefined || !ctx.isIdle()) {
				feedback(
					"Submit ARS commands while the agent is idle. Streaming steer/follow-up cannot safely switch the active workflow; no ARS command was queued.",
				);
				return { result: { action: "handled" } };
			}
			// Guard the exact files native /skill expansion would use, not just the skill names.
			if (!source.skills.every((s) => matchesSource(s.name))) {
				feedback(
					"ARS skill paths do not match the authorized package (missing or shadowed). Resolve the collision before invoking ARS.",
				);
				return { result: { action: "handled" } };
			}
			if (
				command &&
				!CONTROL.test(command[1]) &&
				!source.runtimeFiles.some((f) => f.path === `commands/${command[1]}.md`)
			) {
				feedback(`Unknown ARS command: /${command[1]}. Use an installed /ars-* command.`);
				return { result: { action: "handled" } };
			}
			const result = (await hooks.get("input")?.(event, ctx)) ?? { action: "continue" };
			const transformed = result.action === "transform" ? result.text : event.text;
			const target = transformed.match(/^\/skill:([a-z0-9-]+)(?:\s|$)/)?.[1];
			const args = command?.[2] ?? direct?.[2] ?? "";
			// Route ONLY the canonical target + original user arguments, never the expanded command body.
			const routingText = target ? `/skill:${target}${args ? ` ${args}` : ""}` : args || "ARS utility";
			runtime.prepareForPrompt(routingText, false);
			if (command && !target) runtime.activate(["coding"]);
			return { result, routingText };
		},
		async beforeAgentStart(event: any, ctx: any) {
			// Never add a session-global note to an unrelated turn; never run the wrapper's second XML filter.
			if (!runtime.state().visibleSkills.some((name) => ARS_SKILL.test(name) && matchesSource(name)))
				return undefined;
			return hooks.get("before_agent_start")?.(event, ctx);
		},
	};
}
