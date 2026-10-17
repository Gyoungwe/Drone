// Native Pi research package entry point. The domain logic is bundled into the
// package; no Electron, backend or Desktop module is reachable from this graph.
import researchLoop from "@drone/extensions/research-loop";
import { registerEvidenceLoop } from "./evidence-loop";

export default function piResearch(pi: unknown): void {
	registerEvidenceLoop(pi);
	// Keep the existing evidence-gate lifecycle available to native Pi. The
	// source archive/Zotero adapters remain host-specific and are intentionally
	// not loaded here until their package boundary is split from Electron.
	researchLoop(pi as any);
}
