# Scientific workbench status contract

The v2 scientific workbench uses one shared vocabulary for evidence, claims,
validation scope and freshness. The contract lives in
`packages/shared/src/research-status.ts` and is exported from `@drone/shared`.

| Dimension | Values | Meaning |
|---|---|---|
| Evidence state | `observed`, `reproduced`, `verified`, `partial`, `stale`, `unsupported`, `unknown`, `blocked` | What the host actually observed and validated |
| Claim state | `supported`, `mixed`, `inferred`, `hypothesis`, `unsupported` | How far a statement may be interpreted |
| Validation scope | `fixture`, `integration`, `real-data`, `scientific-review` | The data and review boundary behind the status |
| Freshness | `fresh`, `stale`, `unknown` | Whether the evidence still matches the current source/input |

Only `verified` or `reproduced` evidence with `fresh` inputs can be evidence
green. A scientific claim also requires `supported`, `scientific-review`, and
`scientificallyVerified: true`. Therefore a successful fixture validation is
represented conservatively as:

```json
{
  "evidenceState": "verified",
  "claimState": "inferred",
  "validationScope": "fixture",
  "freshness": "fresh",
  "scientificallyVerified": false
}
```

`ValidationEvidenceCapsule` writes this projection automatically. Legacy
capsules may omit the projection fields and remain readable, but creating a
new capsule derives the conservative values and rejects inconsistent or
scientifically promoted combinations. This keeps fixture/contract evidence
separate from real-data execution and scientific review.
