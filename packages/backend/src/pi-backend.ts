/**
 * @deprecated Import `SessionService` from `./session-service` or consume
 * `BackendServices.sessions` from `createBackend`. This compatibility module
 * remains for existing integrations during the migration window.
 */

export type { SessionServiceOptions, SessionServiceOptions as PiBackendOptions } from "./session-service";
export { SessionService, SessionService as PiBackend } from "./session-service";
