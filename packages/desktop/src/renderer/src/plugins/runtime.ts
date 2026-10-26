import type { PluginUiRuntimeClient } from "@gyoungwe/plugin-api/ui";
import { type ComponentType, createContext, createElement, useContext } from "react";

const PluginRuntimeContext = createContext<PluginUiRuntimeClient | undefined>(undefined);

/** Main owns the binding and validates its package, window and activation generation. */
export function createPluginRuntimeClient(invoke: PluginUiRuntimeClient["invoke"]): PluginUiRuntimeClient {
	return Object.freeze({ invoke });
}

/** Available only inside a contribution with an approved desktop runtime. */
export function usePluginRuntime(): PluginUiRuntimeClient {
	const runtime = useContext(PluginRuntimeContext);
	if (!runtime) throw new Error("Plugin runtime is unavailable for this UI module");
	return runtime;
}

/** Each module gets its own context, including modules without a desktop runtime. */
export function bindPluginRuntime<Props extends object>(
	Component: ComponentType<Props>,
	runtime: PluginUiRuntimeClient | undefined,
): ComponentType<Props> {
	return function BoundPluginComponent(props: Props) {
		return createElement(PluginRuntimeContext.Provider, { value: runtime }, createElement(Component, props));
	};
}
