# Scientific resource search connectors

This is a planned, read-only resource discovery layer inspired by AIPOCH Open-Science's built-in connector catalog and its separation between scientific tools, connectors, and permissioned execution. It is not a LAN feature and it does not grant download, write, or execution permission.

Write destinations are a separate, explicit surface. The current reversible adapters are WebDAV files and Protocols.io bookmarks; both require a host-supplied authorized port and must complete create → readback → delete → absence readback. Zotero item writes remain create/readback only in the product path, and the real temporary-note deletion check is a separate acceptance probe. Search connectors remain read-only and can never be promoted to write capability by configuration alone.

## Scope

The first version should search literature, public datasets, workflows, and software metadata through provider-neutral results. Each result keeps its provider, stable identifier, title, URL, version or release, access/license information, observed time, and a source receipt. A search result is a lead until the host reads the source and records a receipt.

## Built-in connector catalog

The catalog is organized by scientific resource domain so it can serve biology, chemistry, materials, physics, environmental science, medicine, and computational research. The names below are the initial built-in planning baseline, drawn from the connector families described by AIPOCH Open-Science releases; the installed catalog remains versioned and can grow without changing the contract.

| Resource domain | Built-in connectors or tools | Typical use |
| --- | --- | --- |
| Literature and publication | OpenAlex, Crossref, Zenodo | papers, metadata, open-access links, public records, research-package deposits |
| Sequence and genome | NCBI BLAST, ENA, PRIDE, UniProt, NCBI reference genomes, HMMER, InterProScan, Clustal Omega, PDB | sequence search, accession/run resolution, protein annotation, alignment, structure lookup |
| Transcriptomics and single cell | GEO matrix discovery, CELLxGENE Discover, Bgee, MGnify | expression matrices, cell atlases, cross-species expression and microbiome datasets |
| Cancer and clinical genomics | GDC, cBioPortal, openFDA | cancer projects/cases/files, cancer portal data, drug and regulatory metadata |
| Functional, phenotype and model organisms | Alliance of Genome Resources, Monarch, g:Profiler, Enrichr | gene/phenotype associations, orthology context, enrichment and model-organism evidence |
| Pathways and interactions | Pathway Commons, STRING enrichment | pathway search, interaction graphs, protein interaction enrichment |
| Variants and functional scores | MaveDB | variant effect measurements and functional-score evidence |
| Metabolomics and immunology | Metabolomics Workbench, IEDB | metabolomics studies, epitopes, antigens and immune-assay evidence |
| Cell lines | Cellosaurus | cell-line identity, aliases and quality annotations |

The catalog also reserves non-life-science families for the same contract: chemical structures and reactions, materials and crystallography, physics and astronomy datasets, earth and environmental observations, clinical/public-health data, and software/workflow registries. A provider enters the catalog only with an owner, source/license, stable identifiers, schema, access policy, and evidence semantics.

Some rows are tools inside a larger connector, such as GEO discovery inside an omics connector or Clustal Omega inside a genomes connector. The catalog must preserve both the connector ID and the tool capability ID, rather than flattening them into one name list.

Built-in means that the adapter contract and catalog metadata ship with Drone. It does not mean that every source is enabled, credentialed, or allowed to download. Each entry declares `read`, `resolve`, `download-preflight`, and `acquire` separately; only the first two are eligible for the initial default profile.

## Cross-science scenario capability model

Connectors are resource providers. They must not encode the analysis method for one assay or one discipline. Analysis support is represented by versioned research-scenario packs that consume connector results:

| Research-scenario pack | Representative inputs | Representative outputs and gates |
| --- | --- | --- |
| Evidence and literature synthesis | papers, datasets, search strategy, inclusion rules | cited evidence table, screening decisions, uncertainty and provenance |
| Data discovery and acquisition | public/private resource IDs, licenses, manifests | acquisition plan, checksums, access decisions, immutable input manifest |
| Statistical and machine-learning analysis | tabular/matrix data, design, covariates, code and seed | model/estimate, metrics, split/seed record, sensitivity and limitation report |
| Simulation and computational modeling | equations, parameters, initial conditions, solver/runtime | simulation outputs, parameter provenance, convergence and validation checks |
| Visualization and scientific reporting | verified artifacts, figures, tables, narrative constraints | reproducible figures/reports, source links, caption and review evidence |
| Life-science analysis | FASTA/GFF, FASTQ/BAM, matrices, VCF, spectra, metadata | QC, annotation, differential/variant/assembly/omics outputs and domain review |
| Chemistry and materials | structures, reactions, spectra, compositions, crystal data | normalized structures, prediction/simulation outputs, units and method checks |
| Physics and engineering | experiment tables, instrument data, simulation inputs, meshes | calibrated measurements, solver results, uncertainty and conservation checks |
| Earth and environmental science | geospatial/time-series data, remote sensing, climate layers | spatial/temporal aggregates, coordinate/units checks, uncertainty and coverage gates |
| Clinical and public health | de-identified cohorts, guidelines, registries, safety data | cohort summaries, safety/effect estimates, privacy and evidence-strength gates |
| Reproducibility and publication | exact artifacts, code, environment, reviewer findings | replay record, RO-Crate/evidence capsule, release and handoff manifest |

Life-science packs remain a major family inside the general model. Their concrete subpacks include reference/annotation, bulk and long-read transcriptomics, single-cell/spatial, assembly/Hi-C, variants/population, metagenomics, epigenomics, proteomics/metabolomics, and functional/pathway/phenotype. They are not the platform boundary.

Every pack binds to a common `ResearchScenarioPlan`/`AnalysisAdapterRegistry` boundary and declares inputs, references, workflow revision, runtime, resource budget, outputs, validation checks, scientific-review checks, and limitations. A connector can feed multiple packs; a pack can use multiple connectors. A successful run in one scenario never validates a different scenario.

## Layer placement

```text
renderer → preload/window.pi → desktop IPC → backend connector adapter
                                      ↓
                         @drone/research ResourceSearchPort
                                      ↓
                         provider-neutral result + receipt
                                      ↓
                         knowledge/inquiry/run provenance
```

- `@drone/shared` owns `ResourceSearchContract`, request/result/receipt schemas, stable provider IDs, pagination cursors, freshness, access level, and `unknown`/`blocked` reasons. It must remain network-free.
- `@drone/research` owns the `ResourceSearchPort`, query normalization, result identity, deduplication, and receipt semantics. It must not import Electron or provider SDKs.
- `@drone/backend` owns provider adapters and composition-root registration. An adapter declares source, version, license, rate limits, credential readiness, pagination, cancellation, and whether it can only search or can also acquire data.
- `packages/desktop/src/main/ipc/` exposes only the typed read-only contract. Renderer code never calls a provider URL directly.
- `@drone/knowledge` and `@drone/inquiry` consume verified receipts and exact resource IDs; they do not become a second search implementation. `@drone/compute` receives an approved acquisition manifest only after search and source validation.
- `@drone/compute` owns scenario/workflow packs and execution bindings, not provider-specific HTTP logic. Local, SSH, Slurm, container, Nextflow, and future executors implement the same run/harvest contract.

## Evidence and safety gates

1. Search is read-only. It never downloads, imports, writes a Vault note, or submits a compute job automatically.
2. Every result carries a provider ID, stable resource ID, query fingerprint, observed timestamp, source URL, release/version when available, license/access level, and a receipt hash.
3. Missing provider metadata, rate-limit responses, ambiguous identity, and inaccessible sources remain `unknown` or `blocked`; they cannot be promoted to evidence.
4. Acquisition is a separate, user-visible plan with destination, byte/checksum limits, and authorization. The connector may produce a manifest, but the compute or storage layer performs the side effect.
5. Provider adapters use bounded timeouts, pagination limits, cancellation, SSRF-safe URL handling, and explicit terms/credential policy. No arbitrary URL fetch is exposed as a search connector.

## Delivery sequence

- P7a: define shared schemas and a provider-neutral port; add fixtures for exact IDs, pagination, freshness, blocked results, and receipt hashes.
- P7b: implement one public literature provider and one public dataset provider behind the backend adapter registry; verify rate limits and no-credential behavior.
- P7c: add a desktop search panel and resource cards that show source, version, access/license, freshness, and the next read/verify action.
- P7d: add an explicit search-result → acquisition-plan handoff for public FASTQ/reference assets; keep download and compute execution behind existing authorization and provenance gates.

For cross-science coverage, P8 follows with the generic scenario-pack contract, then adds packs in risk order: evidence/data acquisition, statistical/ML analysis, life sciences, chemistry/materials, physics/engineering, earth/environment, clinical/public health, and reproducibility/publication. Each pack can ship independently against the same connector catalog.

The exit gate is a replayable read-only search fixture plus one live provider receipt, with no renderer-to-network imports, no unbounded URL fetch, and a clear distinction between discovered, read/verified, acquired, and scientifically reviewed.
