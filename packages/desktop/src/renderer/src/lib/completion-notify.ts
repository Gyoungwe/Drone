import { type CompletionKind, shouldNotify, shouldPlaySound } from "@drone/shared";
import { useDesktopPrefsStore } from "../stores/desktop-prefs";

export interface NotifyEnv {
	focused: () => boolean;
	notify: (title: string, body: string, onClick: () => void) => void;
	beep: () => void;
}

let audio: AudioContext | null = null;

/** 两声短促正弦（不打包音频文件）。 */
function defaultBeep(): void {
	try {
		audio ??= new AudioContext();
		const now = audio.currentTime;
		for (const [i, freq] of [880, 1320].entries()) {
			const osc = audio.createOscillator();
			const gain = audio.createGain();
			osc.frequency.value = freq;
			gain.gain.setValueAtTime(0.0001, now + i * 0.12);
			gain.gain.exponentialRampToValueAtTime(0.12, now + i * 0.12 + 0.02);
			gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.12 + 0.18);
			osc.connect(gain).connect(audio.destination);
			osc.start(now + i * 0.12);
			osc.stop(now + i * 0.12 + 0.2);
		}
	} catch {
		// 无音频设备：静默
	}
}

const browserEnv: NotifyEnv = {
	focused: () => typeof document !== "undefined" && document.hasFocus(),
	notify: (title, body, onClick) => {
		if (typeof Notification === "undefined" || Notification.permission === "denied") return;
		const n = new Notification(title, { body, silent: true });
		n.onclick = () => {
			window.focus();
			onClick();
		};
	},
	beep: defaultBeep,
};

/** 回合结束 / 需要确认时调用（P11）：后台发系统通知，开启提示音时响一声。 */
export function notifyCompletion(
	kind: CompletionKind,
	title: string,
	body: string,
	onClick: () => void = () => {},
	env: NotifyEnv = browserEnv,
): { notified: boolean; sounded: boolean } {
	const prefs = useDesktopPrefsStore.getState().prefs;
	const notified = shouldNotify(prefs, env.focused());
	if (notified) env.notify(title, body, onClick);
	const sounded = shouldPlaySound(prefs, kind);
	if (sounded) env.beep();
	return { notified, sounded };
}
