import type { Static, TSchema } from "typebox";

/** Transport visibility for a host API method. */
export type HostApiAccess = "desktop" | "lan-read" | "lan-control";

/** A method's runtime schemas and transport policy. */
export interface HostApiMethod<TArgs extends TSchema = TSchema, TResult extends TSchema = TSchema> {
	readonly args: TArgs;
	readonly result: TResult;
	readonly access?: HostApiAccess;
}

export type HostApiMethods = Readonly<Record<string, HostApiMethod>>;
type NormalizedAccess<TMethod extends HostApiMethod> = TMethod["access"] extends HostApiAccess
	? TMethod["access"]
	: "desktop";
export type NormalizedMethods<TMethods extends HostApiMethods> = {
	readonly [K in keyof TMethods]: Omit<TMethods[K], "access"> & {
		readonly access: NormalizedAccess<TMethods[K]>;
	};
};
export type HostApiEvents = Readonly<Record<string, TSchema>>;

export interface DomainContract<
	TName extends string = string,
	TMethods extends HostApiMethods = HostApiMethods,
	TEvents extends HostApiEvents = HostApiEvents,
> {
	readonly name: TName;
	readonly methods: TMethods;
	readonly events: TEvents;
}

/**
 * Define a host API domain. The object is intentionally data-only so it can be
 * projected into Electron IPC, LAN HTTP/SSE, and plugin adapters.
 */
export function defineDomain<
	const TName extends string,
	const TMethods extends HostApiMethods,
	const TEvents extends HostApiEvents = Record<never, never>,
>(
	name: TName,
	spec: { readonly methods: TMethods; readonly events?: TEvents },
): DomainContract<TName, NormalizedMethods<TMethods>, TEvents> {
	const methods = Object.fromEntries(
		Object.entries(spec.methods).map(([methodName, method]) => [
			methodName,
			{ ...method, access: method.access ?? "desktop" },
		]),
	) as NormalizedMethods<TMethods>;
	return {
		name,
		methods,
		events: (spec.events ?? {}) as TEvents,
	};
}

/** Return the stable channel name for a domain method or event. */
export function channelOf<const TName extends string, const TMethod extends string>(
	domain: TName | Pick<DomainContract<TName>, "name">,
	method: TMethod,
): `${TName}:${TMethod}` {
	const name = typeof domain === "string" ? domain : domain.name;
	return `${name}:${method}` as `${TName}:${TMethod}`;
}

/**
 * Return methods visible to a particular transport.
 *
 * Contracts are runtime data as well as a source of TypeScript types. Keeping
 * this selector beside `defineDomain` lets adapters derive their allow-list
 * from the same access labels used by the desktop binder.
 */
export function methodsWithAccess<TContract extends DomainContract>(
	contract: TContract,
	access: HostApiAccess,
): Array<keyof TContract["methods"] & string> {
	return (Object.entries(contract.methods) as [keyof TContract["methods"] & string, HostApiMethod][])
		.filter(([, method]) => method.access === access)
		.map(([methodName]) => methodName);
}

type MethodArgs<TMethod> =
	TMethod extends HostApiMethod<infer TArgs, TSchema>
		? Static<TArgs> extends readonly unknown[]
			? Static<TArgs>
			: never
		: never;
type MethodResult<TMethod> = TMethod extends HostApiMethod<TSchema, infer TResult> ? Static<TResult> : never;
type EventCallback<TSchemaType> = TSchemaType extends TSchema
	? (payload: Static<TSchemaType>) => void
	: never;
type EventMethodName<TName extends string> = TName extends `on${string}` ? TName : `on${Capitalize<TName>}`;

/**
 * Type-level client generated from a domain contract. Method arguments are
 * inferred from the TypeBox tuple, while events expose an unsubscribe function.
 */
export type ClientOf<TContract extends DomainContract> = {
	[K in keyof TContract["methods"] & string]: (
		...args: MethodArgs<TContract["methods"][K]>
	) => Promise<MethodResult<TContract["methods"][K]>>;
} & {
	[K in keyof TContract["events"] & string as EventMethodName<K>]: (
		cb: EventCallback<TContract["events"][K]>,
	) => () => void;
};

/** Schema-derived method arguments, useful to adapters that need one method. */
export type ArgsOf<
	TContract extends DomainContract,
	TMethod extends keyof TContract["methods"] & string,
> = MethodArgs<TContract["methods"][TMethod]>;

/** Schema-derived result type for one contract method. */
export type ResultOf<
	TContract extends DomainContract,
	TMethod extends keyof TContract["methods"] & string,
> = MethodResult<TContract["methods"][TMethod]>;
