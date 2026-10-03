import type {
	AskRequest,
	LoginEventPayload,
	PermissionRequest,
	PermissionResolved,
	SessionEvent,
	TrustRequest,
} from "@drone/shared";
export type EventHandler = (sessionId: string, event: SessionEvent) => void;
export type AskHandler = (req: AskRequest) => void;
export type PermissionHandler = (req: PermissionRequest) => void;
export type PermissionResolvedHandler = (result: PermissionResolved) => void;
export type TrustHandler = (req: TrustRequest) => void;
export type LoginHandler = (payload: LoginEventPayload) => void;
