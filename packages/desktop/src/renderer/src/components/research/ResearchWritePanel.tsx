import type {
  ResearchWriteAdapterDescriptor,
  ResearchWritePayload,
  ResearchWritePlan,
  ResearchWriteReceipt,
} from "@drone/shared";
import { useEffect, useMemo, useState } from "react";
import { getPi } from "../../api";
import { useT } from "../../i18n";

interface ResearchWritePanelProps {
  readonly targetRef: string | null;
  readonly payload: ResearchWritePayload;
}

/**
 * Explicit write controls for research connectors. Preparation is safe; the
 * execute button is disabled until the host reports an authorized write port.
 */
export function ResearchWritePanel({ targetRef, payload }: ResearchWritePanelProps) {
  const t = useT();
  const [adapters, setAdapters] = useState<ResearchWriteAdapterDescriptor[]>([]);
  const [plan, setPlan] = useState<ResearchWritePlan | null>(null);
  const [receipt, setReceipt] = useState<ResearchWriteReceipt | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void getPi()
      .listWriteAdapters()
      .then((next) => {
        if (!cancelled) setAdapters([...next.adapters]);
      })
      .catch((cause) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const adapter = useMemo(() => adapters[0], [adapters]);
  const prepare = async () => {
    if (!adapter || !targetRef) return;
    setBusy(true);
    setError(null);
    setReceipt(null);
    try {
      setPlan(
        await getPi().prepareWrite({
          adapterId: adapter.id,
          targetRef,
          payload,
          action: "prepare",
        }),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const execute = async () => {
    if (!plan || !adapter?.writeEnabled) return;
    if (!window.confirm(t("researchWrite.confirm"))) return;
    setBusy(true);
    setError(null);
    try {
      setReceipt(await getPi().executeWrite({ planId: plan.id, approved: true }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const revoke = async () => {
    if (!plan) return;
    setBusy(true);
    setError(null);
    try {
      await getPi().revokeWrite({ planId: plan.id });
      setPlan({ ...plan, status: "revoked" });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="research-browser-connectors" aria-label={t("researchWrite.title")} data-testid="research-write-panel">
      <div className="research-browser-connectors-head">
        <strong>{t("researchWrite.title")}</strong>
        <span>{adapters.length}</span>
      </div>
      <p className="research-browser-connectors-hint">{t("researchWrite.hint")}</p>
      {!adapter ? (
        <p className="research-browser-connectors-empty">{t("researchWrite.unavailable")}</p>
      ) : (
        <>
          <p className="research-browser-connectors-hint">
            {adapter.label} · {adapter.writeEnabled ? t("researchWrite.authorized") : t("researchWrite.dryRunOnly")}
          </p>
          <button type="button" className="research-browser-button" onClick={() => void prepare()} disabled={busy || !targetRef}>
            {t("researchWrite.prepare")}
          </button>
          {plan && (
            <div className="research-browser-write-plan">
              <small>{t("researchWrite.planReady", { id: plan.id })}</small>
              <div>
                <button
                  type="button"
                  className="research-browser-button"
                  onClick={() => void execute()}
                  disabled={busy || plan.status !== "ready" || !adapter.writeEnabled}
                >
                  {adapter.writeEnabled ? t("researchWrite.execute") : t("researchWrite.dryRunOnly")}
                </button>
                <button type="button" className="research-browser-button" onClick={() => void revoke()} disabled={busy || plan.status !== "ready"}>
                  {t("researchWrite.revoke")}
                </button>
              </div>
            </div>
          )}
        </>
      )}
      {receipt && <p className="research-browser-connectors-hint">{receipt.status === "executed" ? t("researchWrite.executed") : receipt.failureReason}</p>}
      {error && <p className="research-browser-error">{error}</p>}
    </section>
  );
}
