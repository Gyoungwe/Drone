import type {
	ComputeHealthSnapshot,
	ComputeHost,
	ComputeHostInput,
	ComputeJob,
	ComputeLogChunk,
	ComputeOnboardingStatus,
	ComputeOnboardingStep,
	ComputeTerminal,
} from "@drone/shared";
import { create } from "zustand";
import { getPi } from "../api";

const EMPTY_HOSTS: ComputeHost[] = [];
const EMPTY_JOBS: ComputeJob[] = [];
const EMPTY_ONBOARDING: ComputeOnboardingStatus[] = [];
const EMPTY_LOG: ComputeLogChunk = { jobId: "", cursor: "", text: "", truncated: false, at: "" };

export interface ComputeState {
	hosts: ComputeHost[];
	health: ComputeHealthSnapshot | null;
	jobs: ComputeJob[];
	logsByJob: Record<string, ComputeLogChunk>;
	terminals: Record<string, ComputeTerminal>;
	onboarding: ComputeOnboardingStatus[];
	loading: boolean;
	error: string | null;
	initialized: boolean;
	init(): () => void;
	refresh(): Promise<void>;
	refreshJobs(): Promise<void>;
	refreshOnboarding(): Promise<void>;
	saveHost(input: ComputeHostInput): Promise<ComputeHost>;
	removeHost(id: string): Promise<void>;
	probeHost(id: string): Promise<ComputeHost>;
	cancelJob(id: string): Promise<void>;
	openTerminal(input: { hostId: string; cwd?: string; mode?: "shell" | "command" }): Promise<ComputeTerminal>;
	writeTerminal(id: string, text: string): Promise<void>;
	closeTerminal(id: string): Promise<void>;
	loadLogs(id: string, cursor?: string): Promise<ComputeLogChunk>;
	checkOnboardingStep(step: ComputeOnboardingStep): Promise<ComputeOnboardingStatus>;
}

let unsubscribers: Array<() => void> = [];

export const useComputeStore = create<ComputeState>((set, get) => ({
	hosts: EMPTY_HOSTS,
	health: null,
	jobs: EMPTY_JOBS,
	logsByJob: {},
	terminals: {},
	onboarding: EMPTY_ONBOARDING,
	loading: false,
	error: null,
	initialized: false,

	init: () => {
		if (get().initialized) return () => {};
		const pi = getPi();
		unsubscribers = [
			pi.onHealthChanged((health) =>
				set((state) => ({
					health,
					hosts: state.hosts.map((host) => {
						const update = health.hosts.find((item) => item.id === host.id);
						return update ? { ...host, health: { ...host.health, ...update } } : host;
					}),
				})),
			),
			pi.onJobUpdated((job) =>
				set((state) => ({
					jobs: state.jobs.some((item) => item.id === job.id)
						? state.jobs.map((item) => (item.id === job.id ? job : item))
						: [job, ...state.jobs].slice(0, 100),
				})),
			),
			pi.onLogChunk((chunk) =>
				set((state) => {
					const previous = state.logsByJob[chunk.jobId];
					const text =
						previous && previous.cursor !== chunk.cursor ? `${previous.text}${chunk.text}` : chunk.text;
					return {
						logsByJob: { ...state.logsByJob, [chunk.jobId]: { ...chunk, text: text.slice(-1_048_576) } },
					};
				}),
			),
			pi.onTerminalOutput(({ terminalId, text, truncated }) =>
				set((state) => {
					const terminal = state.terminals[terminalId];
					if (!terminal) return state;
					const output = `${terminal.output}${text}`.slice(-131_072);
					return {
						terminals: {
							...state.terminals,
							[terminalId]: { ...terminal, output, truncated: terminal.truncated || truncated },
						},
					};
				}),
			),
			pi.onTerminalClosed(({ terminalId }) =>
				set((state) => {
					const terminal = state.terminals[terminalId];
					if (!terminal) return state;
					return { terminals: { ...state.terminals, [terminalId]: { ...terminal, state: "closed" } } };
				}),
			),
		];
		set({ initialized: true });
		return () => {
			for (const unsubscribe of unsubscribers) unsubscribe();
			unsubscribers = [];
			set({ initialized: false });
		};
	},

	refresh: async () => {
		if (get().loading) return;
		set({ loading: true, error: null });
		try {
			const [hosts, health] = await Promise.all([getPi().listHosts(), getPi().getHealthSnapshot()]);
			set({ hosts, health, loading: false, error: null });
		} catch (error) {
			set({ loading: false, error: error instanceof Error ? error.message : String(error) });
		}
	},
	refreshJobs: async () => {
		try {
			const jobs = await getPi().listJobs();
			set({ jobs, error: null });
		} catch (error) {
			set({ error: error instanceof Error ? error.message : String(error) });
		}
	},
	refreshOnboarding: async () => {
		try {
			set({ onboarding: await getPi().getOnboardingStatus(), error: null });
		} catch (error) {
			set({ error: error instanceof Error ? error.message : String(error) });
		}
	},
	saveHost: async (input) => {
		const host = await getPi().saveHost(input);
		set((state) => ({
			hosts: [...state.hosts.filter((item) => item.id !== host.id && item.alias !== host.alias), host],
		}));
		return host;
	},
	removeHost: async (id) => {
		await getPi().removeHost(id);
		set((state) => ({ hosts: state.hosts.filter((host) => host.id !== id) }));
	},
	probeHost: async (id) => {
		const host = await getPi().probeHost(id);
		set((state) => ({ hosts: state.hosts.map((item) => (item.id === host.id ? host : item)) }));
		return host;
	},
	cancelJob: async (id) => {
		await getPi().cancelJob(id);
		set((state) => ({
			jobs: state.jobs.map((job) => (job.id === id ? { ...job, state: "cancelled" } : job)),
		}));
	},
	openTerminal: async (input) => {
		const terminal = await getPi().openTerminal(input);
		set((state) => ({ terminals: { ...state.terminals, [terminal.id]: terminal } }));
		return terminal;
	},
	writeTerminal: (id, text) => getPi().writeTerminal(id, text),
	closeTerminal: async (id) => {
		await getPi().closeTerminal(id);
		set((state) => {
			const terminal = state.terminals[id];
			return terminal ? { terminals: { ...state.terminals, [id]: { ...terminal, state: "closed" } } } : state;
		});
	},
	loadLogs: async (id, cursor) => {
		const chunk = await getPi().getLogs(id, cursor);
		set((state) => ({ logsByJob: { ...state.logsByJob, [id]: chunk } }));
		return chunk;
	},
	checkOnboardingStep: async (step) => {
		const result = await getPi().checkOnboardingStep(step);
		set((state) => ({
			onboarding: [...state.onboarding.filter((item) => item.step !== result.step), result],
		}));
		return result;
	},
}));

export function selectHosts(state: ComputeState): ComputeHost[] {
	return state.hosts.length ? state.hosts : EMPTY_HOSTS;
}

export function selectJobs(state: ComputeState): ComputeJob[] {
	return state.jobs.length ? state.jobs : EMPTY_JOBS;
}

export function selectOnboarding(state: ComputeState): ComputeOnboardingStatus[] {
	return state.onboarding.length ? state.onboarding : EMPTY_ONBOARDING;
}

export function selectJobLog(state: ComputeState, id: string | null): ComputeLogChunk {
	return id ? (state.logsByJob[id] ?? EMPTY_LOG) : EMPTY_LOG;
}
