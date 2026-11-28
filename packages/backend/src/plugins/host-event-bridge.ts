import type { PluginHostEvent, PluginHostEventSource } from "@gyoungwe/plugin-api/host-events";
import { createLogger } from "../log";
import { type HostEventTopic, isHostEventTopic } from "./host-event-topics";

const log = createLogger("plugin-host-events");

interface Subscription {
	readonly topic: HostEventTopic;
	readonly listener: (event: PluginHostEvent) => void;
	close(): void;
}

export class HostEventBridge {
	private sequence = 0;
	private readonly listeners = new Map<HostEventTopic, Set<Subscription>>();

	publish(topic: HostEventTopic, payload: unknown): void {
		const event: PluginHostEvent = { topic, sequence: ++this.sequence, payload };
		for (const subscription of [...(this.listeners.get(topic) ?? [])]) {
			if (!this.listeners.get(topic)?.has(subscription)) continue;
			try {
				subscription.listener(event);
			} catch (error) {
				subscription.close();
				log.warn("host event listener removed after failure", {
					topic,
					errorName: error instanceof Error ? error.name : typeof error,
				});
			}
		}
	}

	source(topics: readonly HostEventTopic[], signal: AbortSignal): PluginHostEventSource {
		const allowed = new Set(topics.filter(isHostEventTopic));
		const subscriptions = new Set<Subscription>();
		let aborted = signal.aborted;
		const closeAll = () => {
			if (aborted) return;
			aborted = true;
			for (const subscription of [...subscriptions]) subscription.close();
			signal.removeEventListener("abort", closeAll);
		};
		if (!aborted) signal.addEventListener("abort", closeAll, { once: true });

		return {
			subscribe: (topic, listener) => {
				if (aborted || signal.aborted) throw new Error("Host event source is aborted");
				if (!isHostEventTopic(topic) || !allowed.has(topic))
					throw new Error(`Host event topic is not declared: ${topic}`);
				let active = true;
				const subscription: Subscription = {
					topic,
					listener,
					close: () => {
						if (!active) return;
						active = false;
						subscriptions.delete(subscription);
						const listeners = this.listeners.get(topic);
						listeners?.delete(subscription);
						if (listeners?.size === 0) this.listeners.delete(topic);
					},
				};
				const listeners = this.listeners.get(topic) ?? new Set<Subscription>();
				listeners.add(subscription);
				this.listeners.set(topic, listeners);
				subscriptions.add(subscription);
				return subscription.close;
			},
		};
	}
}
