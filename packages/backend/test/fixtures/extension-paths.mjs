import { join, resolve } from "node:path";

export const taskSdkExtensionPath = (name) =>
	join(resolve(import.meta.dirname, "../../../.."), ".pi", "extensions", name);
