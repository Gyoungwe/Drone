export interface PluginHostEvent {
	readonly topic: string;
	readonly sequence: number;
	readonly payload: unknown;
}

export interface PluginHostEventSource {
	subscribe(topic: string, listener: (event: PluginHostEvent) => void): () => void;
}
