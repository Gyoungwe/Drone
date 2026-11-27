/** The existing 15 s watchdog counts guest time, excluding actual host capability settlement. */
export class GuestTimeBudget {
	private remaining = 15000;
	private startedAt = performance.now();
	private waiting = 0;
	private finished = false;
	private timer: ReturnType<typeof setTimeout> | undefined;
	constructor(private readonly expire: () => void) {
		this.arm();
	}
	private arm(): void {
		this.startedAt = performance.now();
		this.timer = setTimeout(() => {
			this.finished = true;
			this.expire();
		}, this.remaining);
	}
	pause(): void {
		if (this.finished) return;
		if (this.waiting++ === 0) {
			this.remaining = Math.max(0, this.remaining - (performance.now() - this.startedAt));
			clearTimeout(this.timer);
		}
	}
	resume(): void {
		if (this.finished) return;
		if (--this.waiting === 0) this.arm();
	}
	dispose(): void {
		this.finished = true;
		clearTimeout(this.timer);
	}
}
