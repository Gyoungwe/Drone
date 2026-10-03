/**
 * Compatibility facade for tests and hosts that historically imported the
 * research host as one module. The published extension is the canonical
 * source-archive entry; this facade only re-exports its host helpers.
 */
export { default } from "../source-archive";
export * from "./research-host";
