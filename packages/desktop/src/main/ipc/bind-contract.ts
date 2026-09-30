import type { ArgsOf, DomainContract, HostApiAccess, HostApiMethod, ResultOf, UiError } from "@drone/shared";
import { channelOf } from "@drone/shared";
import { ipcMain } from "electron";
import { Check } from "typebox/value";

/** Structured errors returned by contract adapters before an implementation runs. */
export interface HostApiValidationError extends UiError {
	code: "invalid_arguments" | "invalid_result";
	severity: "error";
	source: "app";
	titleKey: string;
	detail: string;
	actions: ["copyDetail"];
	timestamp: number;
}

export type ContractImplementation<TContract extends DomainContract> = {
	[K in keyof TContract["methods"] & string]: (
		...args: ArgsOf<TContract, K>
	) => ResultOf<TContract, K> | Promise<ResultOf<TContract, K>>;
};

export interface BindContractOptions {
	/** Override the IPC module in tests or an alternate Electron host. */
	ipc?: Pick<typeof ipcMain, "handle" | "removeHandler">;
	/** Validate result schemas even when NODE_ENV is production (for tests/host hardening). */
	validateResult?: boolean;
	/** Access policy is carried by the contract; this hook can disable LAN-only methods for a host. */
	allowedAccess?: readonly HostApiAccess[];
	/** Override the default `<domain>:<method>` channel during incremental migrations. */
	channelForMethod?: (contract: DomainContract, method: string) => string;
}

function validationError(code: HostApiValidationError["code"], method: string): HostApiValidationError {
	return {
		code,
		severity: "error",
		source: "app",
		titleKey: code === "invalid_arguments" ? "error.title.invalidArguments" : "error.title.invalidResult",
		detail: `${code === "invalid_arguments" ? "Invalid arguments" : "Invalid result"} for host method ${method}`,
		actions: ["copyDetail"],
		timestamp: Date.now(),
	};
}

/**
 * Register all methods in a domain contract with Electron's invoke bridge.
 * Validation happens before the implementation is called and never includes
 * argument values in the returned error envelope.
 */
export function bindContract<TContract extends DomainContract>(
	contract: TContract,
	implementation: ContractImplementation<TContract>,
	options: BindContractOptions = {},
): () => void {
	const ipc = options.ipc ?? ipcMain;
	const validateResult = options.validateResult ?? process.env.NODE_ENV !== "production";
	const allowedAccess = options.allowedAccess;
	const registeredChannels: string[] = [];

	for (const [methodName, method] of Object.entries(contract.methods) as [
		keyof TContract["methods"] & string,
		HostApiMethod,
	][]) {
		if (allowedAccess && method.access && !allowedAccess.includes(method.access)) continue;
		const channel = options.channelForMethod?.(contract, methodName) ?? channelOf(contract, methodName);
		const implementationMethod = implementation[methodName];
		if (typeof implementationMethod !== "function") {
			throw new Error(`Missing implementation for host method ${channel}`);
		}
		ipc.handle(channel, async (_event, ...args: unknown[]) => {
			if (!Check(method.args, args)) return validationError("invalid_arguments", channel);
			const result = await Reflect.apply(implementationMethod, implementation, args);
			if (validateResult && !Check(method.result, result)) return validationError("invalid_result", channel);
			return result;
		});
		registeredChannels.push(channel);
	}

	return () => {
		for (const channel of registeredChannels) ipc.removeHandler(channel);
	};
}

/** Result type used by adapters that need to expose validation errors explicitly. */
export type ContractResult<
	TContract extends DomainContract,
	TMethod extends keyof TContract["methods"] & string,
> = ResultOf<TContract, TMethod> | HostApiValidationError;
