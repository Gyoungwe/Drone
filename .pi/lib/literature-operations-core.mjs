// packages/research/src/literature-operations.ts
import { createHash, randomUUID } from "node:crypto";

// packages/research/src/literature-receipt.ts
function normalizeDoi(value) {
  const doi = String(value || "").trim().replace(/^(?:https?:\/\/(?:dx\.)?doi\.org\/|doi:\s*)/i, "").toLowerCase();
  return /^10\.\d{4,9}\/\S+$/.test(doi) ? doi : null;
}

// packages/research/src/literature-operations.ts
function destinationRecovery(receipt = {}) {
  const zotero = receipt.zotero?.status || "unavailable";
  const obsidian = receipt.obsidian?.status || "unavailable";
  return {
    zotero: {
      status: zotero,
      action: zotero === "verified" ? "reuse-existing-item" : zotero === "identity-mismatch" ? "resolve-identity-conflict" : "read-back-before-any-import",
      autoWrite: false
    },
    obsidian: {
      status: obsidian,
      action: obsidian === "verified" ? "preserve-existing-note" : obsidian === "missing" ? "deposit-missing-note-with-authorization" : obsidian === "identity-mismatch" ? "review-note-conflict-preserve-human-content" : "wait-and-recheck-vault",
      autoWrite: false
    },
    completed: zotero === "verified" && obsidian === "verified",
    scientificallyVerified: false
  };
}
function literatureOperationId(vault, revision, doi) {
  const normalized = normalizeDoi(doi);
  if (!normalized) throw new Error("Valid DOI required");
  return createHash("sha256").update(JSON.stringify([vault, revision, normalized])).digest("hex");
}
function createLiteratureOperations(ports) {
  const now = ports.now || (() => (/* @__PURE__ */ new Date()).toISOString());
  const createId = ports.createId || randomUUID;
  return {
    async reconcileLiteratureOperation({ cwd = process.cwd(), runDir, doi, zoteroKey, notePath }, { verify = ports.verify } = {}) {
      const normalized = normalizeDoi(doi);
      if (!normalized) throw new Error("Valid DOI required");
      const { file, vault, revision } = await ports.resolveRunJournal(cwd, runDir);
      if (!vault) throw new Error("No bound Vault");
      const id = literatureOperationId(vault, revision, normalized);
      return ports.exclusive(file, async () => {
        const journal = await ports.readJournal(file);
        const previous = journal.operations[id];
        if (previous && (previous.zoteroKey !== zoteroKey || previous.notePath !== notePath))
          throw new Error(
            "Operation identity changed; resolve the existing DOI/key/path mapping before retry"
          );
        const receipt = await verify({ doi: normalized, zotero_key: zoteroKey, note_path: notePath, vault });
        const destinations = destinationRecovery(receipt);
        const checkedAt = now();
        const operation = {
          id,
          doi: normalized,
          zoteroKey,
          notePath,
          vault,
          revision,
          status: destinations.completed ? "both-identities-verified" : "partial-or-unavailable",
          attempts: (previous?.attempts || 0) + 1,
          createdAt: previous?.createdAt || checkedAt,
          checkedAt,
          destinations,
          receipt,
          history: [
            ...previous?.history || [],
            { at: checkedAt, zotero: receipt.zotero?.status, obsidian: receipt.obsidian?.status }
          ].slice(-32)
        };
        journal.operations[id] = operation;
        await ports.writeJournal(file, journal);
        return {
          operation_id: id,
          log_path: file,
          status: operation.status,
          destinations,
          receipt,
          attempts: operation.attempts,
          writesToLibraries: 0
        };
      });
    },
    /** Append an observed write receipt; the journal never authorizes or drives a retry. */
    async recordZoteroWrite({
      cwd = process.cwd(),
      runDir,
      receipt
    }) {
      const doi = normalizeDoi(receipt?.doi);
      if (!doi) throw new Error("Valid DOI required");
      const { file } = await ports.resolveRunJournal(cwd, runDir);
      return ports.exclusive(file, async () => {
        const journal = await ports.readJournal(file);
        const entry = {
          id: createId(),
          doi,
          status: String(receipt.status || "unknown"),
          reason: receipt.reason || null,
          channel: receipt.channel || null,
          zoteroKey: receipt.zoteroKey || null,
          library: receipt.library || null,
          collection: receipt.collection || null,
          attachment: receipt.attachment || null,
          fulltextStatus: receipt.fulltextStatus || null,
          readBack: receipt.readBack || null,
          consent: receipt.consent || null,
          writesToLibraries: receipt.writesToLibraries || 0,
          at: receipt.write?.at || now()
        };
        journal.writes = [...Array.isArray(journal.writes) ? journal.writes : [], entry].slice(-64);
        await ports.writeJournal(file, journal);
        return {
          write_id: entry.id,
          log_path: file,
          writes: journal.writes.length,
          autoRetry: false
        };
      });
    }
  };
}
export {
  createLiteratureOperations,
  destinationRecovery,
  literatureOperationId
};
