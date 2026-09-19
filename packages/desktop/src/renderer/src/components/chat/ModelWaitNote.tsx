import type { ModelWaitEvent } from "@drone/shared";
import { useState } from "react";
import { getPi } from "../../api";
import { useT } from "../../i18n";

export function ModelWaitNote({ info, sessionId }: { info: ModelWaitEvent; sessionId: string }) {
	const t = useT();
	const [stopping, setStopping] = useState(false);
	const [error, setError] = useState("");
	const stop = async () => {
		setStopping(true);
		try {
			await getPi().abort(sessionId);
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : String(cause));
		} finally {
			setStopping(false);
		}
	};
	return (
		<div className="model-wait-note" role="status">
			<span>
				{t(
					info.status === "stopping"
						? "error.modelStopping"
						: info.status === "stop-failed"
							? "error.modelStopFailed"
							: "error.modelWaiting",
					{ minutes: info.timeoutMs / 60_000 },
				)}
			</span>
			{info.errorMessage && <span role="alert">{info.errorMessage}</span>}
			<button
				type="button"
				className="error-note-act"
				disabled={stopping || info.status === "stopping"}
				onClick={() => void stop()}
			>
				{t("composer.stop")}
			</button>
			{error && <span role="alert">{error}</span>}
		</div>
	);
}
