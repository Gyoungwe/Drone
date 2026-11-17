import type { zhError } from "./error.zh";

export const enError: typeof zhError = {
	continueMessage: "Continue",
	continueFrom: "(Resume from step {step}, tool {tool}; do not redo completed steps)",
	meta: {
		llm: "Model request",
		session: "Session",
		tool: "Tool",
		extension: "Extension",
		app: "App",
		network: "Network",
	},
	action: {
		retry: "Retry",
		continue: "Continue",
		compact: "Compact context",
		openSettings: "Open settings",
		copyDetail: "Copy detail",
	},
	card: {
		continueHint: "Progress is saved. Reply “continue” to resume.",
		resumed: "Run failed · resumed",
		noContinue: "This error can't be continued; compact the context or start a new task.",
	},
	copied: "Copied",
	title: {
		llmAuth: "Model request failed: invalid credentials",
		llmRateLimit: "Model request failed: rate limited",
		llmOverflow: "Model request failed: context limit exceeded",
		llmNetwork: "Model request failed: network error",
		llmGeneric: "Model request failed",
		modelTimeout: "Model stopped responding; request stopped",
		streamGuard: "Reply aborted by safety guard",
		sendFailed: "Failed to send",
		sendReadOnly: "Session is read-only, cannot send",
	},
	hint: {
		checkApiKey: "API credentials are invalid or expired. Check the API key in Settings → Model providers.",
		rateLimit: "Too many requests or server-side throttling; try again shortly.",
		compact: "Context is too long. Run /compact to compress, or fork from here to start a new session.",
		network: "Network connection issue; check your connection and retry.",
		streamGuard: "Abnormal model output (pathological stream) was aborted by the safety guard.",
		modelTimeout:
			"No new model events for 5 minutes. Check your model service or continue the remaining work in this conversation. Completed tool operations are not automatically repeated.",
	},
	retrying: "Auto-retrying · attempt {attempt}/{maxAttempts} · waiting {delay}s",
	modelWaiting:
		"No new model events for over 60 seconds. Still waiting; the request will stop after {minutes} minutes of silence.",
	modelStopping: "Model silent; requesting stop. Completion is not confirmed yet.",
	modelStopFailed: "Stop failed; the task may still be running. Try stopping again or check the service.",
};
