# nf-core/rnaseq 三样本远端证据回执

## 运行

- 远端目标：`bee-brain-gaoxuze`（`gaoxuze@202.112.170.226`，配置哈希 `sha256:aaa1a6380a16274595b1e26a5d4da728e350caeaddfbdcefe77fde162c1bcd04`）。
- Durable run：`274cba68-b2b4-4048-bfc2-fc98c9cb48e3`；run id：`nextflow-rnaseq-v3-18-20261015-170404-a8736e94`。
- 工作流：`nf-core/rnaseq` 3.18.0，Nextflow 24.10.5，Singularity profile，HISAT2，串行比对上限 12 CPU。
- 样本：`70-MF-1`、`70-MF-2`、`70-MF-3`，均为 paired-end、unstranded；同一 70-MF 系列，未定义可支持差异表达的对照设计。
- 终态：Nextflow 返回码 0；trace 77 条，77 成功、0 失败。Qualimap 通过 `skip_qualimap=true` 跳过；此前独立失败证据显示 Qualimap 2.3 无法解析该 GTF 的缺失 feature 名称。

## 结果证据

- HISAT2 overall alignment rate：93.77%、92.25%、93.33%。
- Picard duplicate percentage：29.26%、14.69%、24.47%。
- featureCounts 使用 `transcript_id` + `exon` + unstranded；assigned counts：2,994,966、1,926,846、2,782,671。结果是 transcript-level，且 ambiguity 较高，尚未升级为 gene-level 结论。
- MultiQC：`/home/gaoxuze/02_Project/bee_brain/drone_v2_evidence/rnaseq-v3-18-3samples-transcripts-serial-noqualimap/results/multiqc/hisat2/multiqc_report.html`。
- 计数：`/home/gaoxuze/02_Project/bee_brain/drone_v2_evidence/rnaseq-v3-18-3samples-transcripts-serial-noqualimap/results/hisat2/featurecounts/`。
- provenance：`/home/gaoxuze/02_Project/bee_brain/drone_v2_evidence/rnaseq-v3-18-3samples-transcripts-serial-noqualimap/results/pipeline_info/nf_core_rnaseq_software_mqc_versions.yml`。
- execution evidence：`workflow/workflow/trace.txt`、`timeline.html`、`nextflow_report.html`、`dag.html`。

关键哈希：MultiQC HTML `530f7f8f2dfb5d92ec649471ce218759ebd619371851feb28c57b8e4dfd0c7ca`；MultiQC general stats `1c98c5b5d0e4a1f1b7586317dde8da97b326dbe32e3000fcbaa0bbef5b8c0177`；software versions `bc29a11e7952efc2bddac766aafb1e8c858c07e2425d459613d648fd557419f3`。

本回执证明远端执行、QC 和产物生成链闭合，不证明生物学差异。下一步应在核对 metadata 与 annotation/identifier 映射后，定义 replicate-aware contrast；不得直接对这三个同系列样本做差异表达结论。

