/**
 * Stable host entry point for the knowledge capability.
 *
 * P1 keeps the existing implementation modules intact and narrows all host
 * consumers to this single package subpath. P2 will replace the implementation
 * behind this entry with the installable plugin package.
 */
export * from "./index";
