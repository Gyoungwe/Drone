import { cloudflareAskCopy, looksLikeCloudflare } from "@drone/research/source-archive-policy";
import type { ExtensionContext, InlineExtension } from "./sdk";

const BROWSER_TOOL = /playwright|browser/i;

export interface CloudflareToolEvent {
	toolName: string;
	content?: unknown;
	isError?: boolean;
}

export interface CloudflareToolRewrite {
	content: { type: "text"; text: string }[];
	isError?: boolean;
}

function resultText(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.map((block) => {
			if (typeof block === "string") return block;
			const text = (block as { text?: unknown } | null)?.text;
			return typeof text === "string" ? text : "";
		})
		.join("\n");
}

/**
 * When a browser tool comes back with a Cloudflare interstitial, ask the user once.
 * Continue tells the model to re-read the page. Skip or closing the card is not evidence.
 * No ask UI leaves the original result untouched. The host does not call the tool again.
 */
export async function cloudflareToolResult(
	event: CloudflareToolEvent,
	ask?: () => Promise<"continue" | "skip" | undefined>,
): Promise<CloudflareToolRewrite | undefined> {
	if (!BROWSER_TOOL.test(event.toolName || "")) return undefined;
	if (!looksLikeCloudflare(null, resultText(event.content))) return undefined;
	if (!ask) return undefined;
	const copy = cloudflareAskCopy();
	let choice: "continue" | "skip" | undefined;
	try {
		choice = await ask();
	} catch {
		choice = "skip";
	}
	if (choice === "continue") return { content: [{ type: "text", text: copy.retryNote }] };
	return { content: [{ type: "text", text: copy.skipNote }], isError: true };
}

export function makeCloudflareAskExtension(): InlineExtension {
	return {
		name: "cloudflare-ask",
		factory: (pi) => {
			pi.on("tool_result", async (event, ctx: ExtensionContext) => {
				const select = ctx.ui?.select;
				if (typeof select !== "function") return undefined;
				return cloudflareToolResult(event, async () => {
					const copy = cloudflareAskCopy();
					const choice = await select(
						`${copy.title}\n\n${copy.body}`,
						[copy.continueLabel, copy.skipLabel],
						ctx.signal ? { signal: ctx.signal } : undefined,
					);
					return choice === copy.continueLabel ? "continue" : "skip";
				});
			});
		},
	};
}
