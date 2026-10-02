// @ts-nocheck
// packages/knowledge/src/metacognitive-policy.ts
var MAX_FAILURES = 16;
var MAX_TEXT = 600;
var SHA256 = /^[a-f0-9]{64}$/i;
function bounded(value, max = MAX_TEXT) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return String(text ?? "").replace(/[\r\n]+/g, " ").slice(0, max);
}
function sameValue(left, right) {
  if (Object.is(left, right)) return true;
  if (typeof left === "number" && typeof right === "number" && Number.isFinite(left) && Number.isFinite(right))
    return left === right;
  try {
    return JSON.stringify(left) === JSON.stringify(right);
  } catch {
    return false;
  }
}
function hasKey(value, key) {
  return Object.hasOwn(value, key);
}
function subset(expected, observed) {
  if (!expected) return [];
  if (!observed) return Object.keys(expected);
  return Object.keys(expected).filter((key) => !hasKey(observed, key) || !sameValue(expected[key], observed[key]));
}
function numberValue(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && value.trim() !== "" ? parsed : null;
}
function numberMatches(expected, observed, tolerance = 0) {
  const left = numberValue(expected);
  const right = numberValue(observed);
  if (left !== null && right !== null) return Math.abs(left - right) <= Math.max(0, tolerance);
  return String(expected).trim() === String(observed).trim();
}
function artifactHasNumber(artifact, claim) {
  const tolerance = claim.rounding?.tolerance ?? (typeof claim.rounding?.digits === "number" && claim.rounding.digits >= 0 ? 0.5 * 10 ** -claim.rounding.digits : 0);
  if (artifact.numbers?.some((item) => numberMatches(claim.value, item.value, item.tolerance ?? tolerance))) return true;
  if (typeof artifact.text !== "string") return false;
  const rendered = claim.rendered ?? String(claim.value);
  if (artifact.text.includes(rendered)) return true;
  return artifact.text.includes(String(claim.value));
}
function citedPaths(answer) {
  return new Set(
    Array.from(answer.matchAll(/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g), (match) => {
      const path = (match[1] || "").trim();
      return path.endsWith(".md") ? path : `${path}.md`;
    })
  );
}
function addFailure(failures, failure) {
  if (failures.length < MAX_FAILURES) failures.push(failure);
}
function evaluateMetacognitivePublication(answer, snapshot) {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot))
    return { ok: true, failures: [], findings: [] };
  const input = snapshot;
  if (input.enabled === false) return { ok: true, failures: [], findings: [] };
  const failures = [];
  const citations = citedPaths(answer);
  const artifacts = /* @__PURE__ */ new Map();
  for (const artifact of Array.isArray(input.artifacts) ? input.artifacts : []) {
    if (artifact && typeof artifact.path === "string") artifacts.set(artifact.path, artifact);
  }
  const checkedPaths = /* @__PURE__ */ new Set();
  const checkArtifact = (path, subject) => {
    const artifact = artifacts.get(path);
    if (!artifact) {
      addFailure(failures, {
        code: "artifact-checksum-stale",
        subject,
        detail: `No current checksum receipt for ${bounded(path, 240)}`,
        path
      });
      return void 0;
    }
    if (!SHA256.test(String(artifact.sha256 || "")) || !SHA256.test(String(artifact.currentSha256 || ""))) {
      addFailure(failures, {
        code: "artifact-checksum-stale",
        subject,
        detail: `Missing or malformed checksum receipt for ${bounded(path, 240)}`,
        path
      });
    } else if (artifact.sha256?.toLowerCase() !== artifact.currentSha256?.toLowerCase()) {
      addFailure(failures, {
        code: "artifact-checksum-stale",
        subject,
        detail: `Cited artifact changed after observation (${bounded(artifact.sha256, 16)}\u2026 \u2192 ${bounded(artifact.currentSha256, 16)}\u2026)`,
        path
      });
    }
    checkedPaths.add(path);
    return artifact;
  };
  for (const claim of Array.isArray(input.numbers) ? input.numbers : []) {
    if (!claim || typeof claim.artifactPath !== "string") {
      addFailure(failures, {
        code: "metacognition-invalid",
        subject: "report-number",
        detail: "A report number has no cited artifact path"
      });
      continue;
    }
    const rendered = claim.rendered ?? String(claim.value);
    if (!answer.includes(rendered)) {
      addFailure(failures, {
        code: "report-number-unbound",
        subject: claim.id || rendered,
        detail: `Reported number ${bounded(rendered, 80)} is not present in the final answer`,
        path: claim.artifactPath
      });
    }
    if (!citations.has(claim.artifactPath)) {
      addFailure(failures, {
        code: "report-number-unbound",
        subject: claim.id || rendered,
        detail: `Reported number ${bounded(rendered, 80)} is not tied to citation ${bounded(claim.artifactPath, 240)}`,
        path: claim.artifactPath
      });
    }
    const artifact = checkArtifact(claim.artifactPath, claim.id || rendered);
    if (artifact && !artifactHasNumber(artifact, claim))
      addFailure(failures, {
        code: "report-number-unbound",
        subject: claim.id || rendered,
        detail: `Artifact does not contain ${bounded(String(claim.value), 80)} with the declared rounding`,
        path: claim.artifactPath
      });
  }
  for (const path of citations) {
    if (artifacts.has(path) && !checkedPaths.has(path)) checkArtifact(path, "citation");
  }
  for (const method of Array.isArray(input.methods) ? input.methods : []) {
    const executed = input.executed;
    if (!method || typeof method.description !== "string" || !method.description.trim()) {
      addFailure(failures, { code: "metacognition-invalid", subject: "method", detail: "Method description is empty" });
      continue;
    }
    if (!answer.includes(method.description))
      addFailure(failures, {
        code: "method-mismatch",
        subject: method.id || method.description,
        detail: "Method description is not present in the final answer"
      });
    if (!executed) {
      addFailure(failures, {
        code: "method-mismatch",
        subject: method.id || method.description,
        detail: "No host-observed workflow execution was supplied"
      });
      continue;
    }
    if (method.workflow && !executed.workflows?.includes(method.workflow))
      addFailure(failures, {
        code: "method-mismatch",
        subject: method.id || method.workflow,
        detail: `Workflow ${bounded(method.workflow, 120)} was not observed`
      });
    for (const module of method.modules || [])
      if (!executed.modules?.includes(module))
        addFailure(failures, {
          code: "method-mismatch",
          subject: method.id || module,
          detail: `Module ${bounded(module, 120)} was not observed`
        });
    for (const key of subset(method.params, executed.params))
      addFailure(failures, {
        code: "method-mismatch",
        subject: method.id || key,
        detail: `Parameter ${bounded(key, 120)} differs from the observed workflow`
      });
  }
  const findingMap = /* @__PURE__ */ new Map();
  const findingEvidence = [];
  for (const rawFinding of Array.isArray(input.findings) ? input.findings : []) {
    const finding = rawFinding;
    if (!finding || typeof finding.id !== "string" || typeof finding.text !== "string") {
      addFailure(failures, { code: "metacognition-invalid", subject: "finding", detail: "Finding is malformed" });
      continue;
    }
    findingMap.set(finding.id, finding);
    const paths = Array.from(
      new Set(
        (Array.isArray(finding.citationPaths) ? finding.citationPaths : []).filter(
          (path) => typeof path === "string"
        )
      )
    );
    findingEvidence.push({ id: finding.id, text: bounded(finding.text), label: finding.label, citationPaths: paths });
    for (const path of paths) {
      if (!citations.has(path))
        addFailure(failures, {
          code: "finding-label-conflict",
          subject: finding.id,
          detail: `Finding is missing its cited artifact ${bounded(path, 240)}`,
          path
        });
      else checkArtifact(path, finding.id);
    }
  }
  for (const use of Array.isArray(input.uses) ? input.uses : []) {
    const finding = findingMap.get(use?.findingId || "");
    if (!finding) {
      addFailure(failures, {
        code: "finding-label-conflict",
        subject: use?.findingId || "finding",
        detail: "The final answer references an unknown finding"
      });
      continue;
    }
    if (["exploratory", "overturned", "unstable"].includes(finding.label)) {
      const invalidRole = finding.label === "exploratory" ? ["conclusion", "validation"].includes(use.role) : use.role !== "exploratory";
      if (invalidRole)
        addFailure(failures, {
          code: "finding-label-conflict",
          subject: finding.id,
          detail: `Finding labelled ${finding.label} cannot be used as ${use.role}`
        });
    }
  }
  for (const diagnostic of Array.isArray(input.diagnostics) ? input.diagnostics : []) {
    if (!diagnostic || typeof diagnostic.id !== "string" || !sameValue(diagnostic.reported, diagnostic.observed))
      addFailure(failures, {
        code: "diagnostic-drift",
        subject: diagnostic?.id || "diagnostic",
        detail: `Reported diagnostic differs from the observed control/result (${bounded(diagnostic?.reported)} vs ${bounded(diagnostic?.observed)})`
      });
  }
  return { ok: failures.length === 0, failures, findings: findingEvidence };
}

export {
  evaluateMetacognitivePublication
};
