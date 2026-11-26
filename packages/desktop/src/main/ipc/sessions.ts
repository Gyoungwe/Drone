import type { BackendServices, SessionServicePort } from "@drone/backend";
import type { SessionsApi } from "@drone/shared";
import { SessionsContract } from "@drone/shared";
import { bindContract, type ContractImplementation } from "./bind-contract";

type SessionContractMethod = keyof typeof SessionsContract.methods & string;

/** Register every session method through the schema-backed host contract. */
export function registerSessionsIpc(
	backendOrServices: SessionServicePort | Pick<BackendServices, "sessions">,
): void {
	const backend = "sessions" in backendOrServices ? backendOrServices.sessions : backendOrServices;
	const implementation = Object.fromEntries(
		(Object.keys(SessionsContract.methods) as SessionContractMethod[]).map((method) => {
			const fn = backend[method as keyof SessionsApi] as unknown;
			if (typeof fn !== "function") throw new Error(`Missing backend session method: ${method}`);
			return [
				method,
				(...args: unknown[]) => Reflect.apply(fn as (...args: unknown[]) => unknown, backend, args),
			];
		}),
	) as unknown as ContractImplementation<typeof SessionsContract>;

	bindContract(SessionsContract, implementation);
}
