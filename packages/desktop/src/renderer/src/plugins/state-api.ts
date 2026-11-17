import type { PluginStoreCreator } from "@gyoungwe/plugin-api/ui";
import { create } from "zustand";

/**
 * Each call creates plugin-owned state with the host's installed Zustand.
 * The returned selector hook unsubscribes on unmount. Select existing slices or
 * memoized values: unchanged selections must keep the same reference.
 */
export const createPluginStore: PluginStoreCreator = create;
