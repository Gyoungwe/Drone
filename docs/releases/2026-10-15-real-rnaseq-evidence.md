# 2026-10-15 real RNA-seq evidence

This receipt records a bounded real-data run on the user-authorized host. The
raw reads, reference, BAM, count table, HTML reports and trimmed reads remain
on that host; none of them are copied into the repository.

## Run identity

- Host: `gaoxuze@202.112.170.226` (`dell.zx`)
- Remote evidence root: `/home/gaoxuze/02_Project/bee_brain/drone_v2_evidence/70-MF-2`
- Sample: `70-MF-2` (one paired-end biological sample; operational smoke only)
- Samplesheet: `/home/gaoxuze/02_Project/bee_brain/drone_v2_evidence/70-MF-2/metadata/samplesheet.csv`
- FASTQ inputs:
  - `/home/gaoxuze/02_Project/bee_brain/00_data/raw_data/70-MF-2/70-MF-2_1.fq.gz`
  - `/home/gaoxuze/02_Project/bee_brain/00_data/raw_data/70-MF-2/70-MF-2_2.fq.gz`
- Reference: `/home/gaoxuze/02_Project/bee_brain/00_genome/GCF_029169275.2_AcerK_1.0_genomic.fna`
- Annotation: `/home/gaoxuze/02_Project/bee_brain/00_genome/genomic.gtf`

Input SHA-256 values recorded by the remote run:

| Input | SHA-256 |
|---|---|
| FASTQ R1 | `b31b0729b955e0faf74d163a3828bb60d81047278cd30b4d608b241b9e1e3730` |
| FASTQ R2 | `eefe3eb6e0ce357ce649494a0e09d2b1d09e22f5882e1707b1c643bb6bcf26ab` |
| Reference FASTA | `124d76eb63ea520cf6e9ad1fef742281bfea3de3d148cc6546a76edf7eda8489` |
| Annotation GTF | `a867511c5a80b99a8eb820accef82b9179f8554fda358b7d8d80ce58dc8a6979` |

## Observed execution

The remote tool chain was `fastp 0.23.2` → `FastQC 0.13.0` → `HISAT2 2.2.1`
→ `samtools sort/index` → `featureCounts 2.1.1` → `MultiQC 1.31`.

- FASTP: 6,598,962 reads before filtering; 6,574,172 after filtering;
  post-filter Q30 rate 97.6313%; post-filter GC 36.9269%; 279,984 reads had
  adapter sequence trimmed.
- HISAT2: 3,287,086 read pairs; 96.15% overall alignment rate.
- featureCounts: 6,808,332 alignments; 1,977,918 assigned (29.0514%). The
  supplied GTF has no `gene_id` attribute, so the run used its observed
  `transcript_id` attribute after recording the initial validation error.
- MultiQC produced HTML and machine-readable data under
  `multiqc/70-MF-2.multiqc_report_data/`.

Key remote artifact hashes:

| Artifact | SHA-256 |
|---|---|
| MultiQC HTML | `67c99ccd14d2036421d4bd490b28246f7c52529fd116757e2cc400dc898a5c54` |
| MultiQC data JSON | `78b37a3f3a602cd60ed7ae7ab2f54ceb69931ab9cffec2ab3549322ed57054a5` |
| HISAT2 summary | `090279b82dbc6656641e943695629118adab875b7e2ace0c02e18c868387fc7b` |
| featureCounts summary | `16329e76572f1ba3b142c89c3af456fa79f369bc5887d63acfbee0835c4704f9` |

## Gate result

The real input manifest, reference readability, checksums, QC, alignment,
counting and MultiQC collection gates passed for this bounded smoke. The run
does not support a biological conclusion: it has one sample, no contrast or
replicate design, and no scientific review. The supplied host has no Nextflow
executable, so the pinned `nf-core/rnaseq` execution and its Nextflow trace,
timeline and provenance gate remain blocked. The remote receipt records this as
`nextflow_status=blocked_missing_remote_nextflow`; the native tool chain is not
represented as an nf-core run.

The MultiQC FastQC table retained two entries because raw and trimmed files
share sample-derived names; all four FastQC reports remain in the remote QC
directory. This is recorded as a collection limitation rather than a QC pass.

