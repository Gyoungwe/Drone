/**
 * @deprecated Import the host session implementation from `./session-service`
 * or consume `BackendServices.sessions` from `createBackend`. This file remains
 * as a one-release compatibility export for existing integrations.
 */

export type { PiBackendOptions } from "./session-service";
export { PiBackend } from "./session-service";
