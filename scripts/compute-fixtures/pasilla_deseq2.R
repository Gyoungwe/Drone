#!/usr/bin/env Rscript

args <- commandArgs(trailingOnly = TRUE)
if (length(args) != 1) stop("usage: pasilla_deseq2.R PREVIOUS_QUANT_RUN_ID")
previous_run <- args[[1]]
root <- Sys.getenv("DRONE_REMOTE_ROOT", path.expand("~/.drone"))
quant_root <- file.path(root, "runs", previous_run, "outputs", "quant")
out <- file.path(getwd(), "deseq2")
dir.create(out, recursive = TRUE, showWarnings = FALSE)

samples <- c("GSM461177", "GSM461180")
conditions <- factor(c("untreated", "treated"), levels = c("untreated", "treated"))
quant_paths <- file.path(quant_root, samples, "quant.sf")
if (!all(file.exists(quant_paths))) stop("missing Salmon quant.sf input: ", paste(quant_paths[!file.exists(quant_paths)], collapse = ", "))
reference_fasta <- file.path(root, "references", "drosophila.BDGP6.32.cdna.fa")
if (!file.exists(reference_fasta)) stop("missing Ensembl cDNA reference: ", reference_fasta)

quant <- lapply(quant_paths, function(path) read.delim(path, check.names = FALSE, stringsAsFactors = FALSE))
common <- Reduce(intersect, lapply(quant, `[[`, "Name"))
if (!length(common)) stop("no common transcript features in Salmon outputs")
counts <- sapply(quant, function(tab) tab[match(common, tab$Name), "NumReads"])
counts <- as.matrix(counts)
rownames(counts) <- common
colnames(counts) <- samples
counts_integer <- round(counts)
headers <- readLines(reference_fasta)
headers <- headers[startsWith(headers, ">")]
tx_ids <- sub("^>(\\S+).*", "\\1", headers)
gene_ids <- sub(".* gene:([^ ]+).*", "\\1", headers)
tx2gene <- data.frame(transcript_id = tx_ids, gene_id = gene_ids, stringsAsFactors = FALSE)
tx2gene <- tx2gene[match(rownames(counts_integer), tx2gene$transcript_id), , drop = FALSE]
if (anyNA(tx2gene$gene_id)) stop("reference is missing gene mapping for Salmon transcripts")
write.table(tx2gene, file = file.path(out, "tx2gene.tsv"), sep = "\t", quote = FALSE, row.names = FALSE)
gene_counts <- rowsum(counts_integer, group = tx2gene$gene_id, reorder = FALSE)
counts_integer <- gene_counts
write.table(
  data.frame(feature_id = rownames(counts_integer), counts_integer, check.names = FALSE),
  file = file.path(out, "counts.tsv"), sep = "\t", quote = FALSE, row.names = FALSE,
)
write.table(
  data.frame(sample = samples, condition = conditions),
  file = file.path(out, "design.tsv"), sep = "\t", quote = FALSE, row.names = FALSE,
)

suppressPackageStartupMessages(library(DESeq2))
coldata <- data.frame(condition = conditions, row.names = samples)
dds <- DESeqDataSetFromMatrix(countData = counts_integer, colData = coldata, design = ~ condition)
dds <- estimateSizeFactors(dds)

standard_status <- "standard DESeq2 dispersion estimation was not run"
standard_error <- ""
tryCatch({
  DESeq(dds)
  standard_status <- "standard DESeq2 completed"
}, error = function(e) {
  standard_status <<- "standard DESeq2 stopped because there are no within-condition replicates"
  standard_error <<- conditionMessage(e)
})

# The two-file demo has one library per condition. DESeq2 cannot estimate an
# empirical dispersion in this design. A fixed dispersion is used only to
# exercise the complete result-writing path; its p-values are exploratory and
# must not be interpreted as replicated differential-expression evidence.
mcols(dds)$dispersion <- 0.1
dispersionFunction(dds) <- function(mu) 0.1
dds <- nbinomWaldTest(dds, betaPrior = FALSE)
res <- results(dds, contrast = c("condition", "treated", "untreated"), independentFiltering = FALSE)
res_out <- data.frame(feature_id = rownames(res), as.data.frame(res), check.names = FALSE)
write.table(res_out, file = file.path(out, "results.tsv"), sep = "\t", quote = FALSE, row.names = FALSE)
writeLines(capture.output(sessionInfo()), file.path(out, "sessionInfo.txt"))

summary_lines <- c(
  "# Pasilla DESeq2 workflow",
  "",
  paste0("Input: Salmon transcript-level quantification from Drone run `", previous_run, "`."),
  "Contrast: treated (GSM461180) versus untreated (GSM461177).",
  "Features: Ensembl gene IDs obtained by aggregating common Salmon transcript NumReads; values rounded for DESeq2 input.",
  "",
  "## Replicate warning",
  "",
  "This demo contains one biological library per condition (n=1 untreated, n=1 treated). It has no within-condition biological replication.",
  "Standard DESeq2 dispersion estimation is therefore not statistically identifiable and is not a valid basis for inferential differential-expression claims.",
  "",
  paste0("Standard path: ", standard_status, "."),
  if (nzchar(standard_error)) paste0("Observed message: ", standard_error) else "",
  "",
  "## Exploratory path",
  "",
  "The result table was produced with DESeq2's Wald-test machinery after setting a fixed dispersion of 0.1 solely to validate the end-to-end output path.",
  "The log2 fold changes and p-values in results.tsv are exploratory diagnostics, not publishable differential-expression results.",
  "",
  paste0("Rows in results.tsv: ", nrow(res_out)),
  paste0("Rows with nominal p < 0.05: ", sum(!is.na(res_out$pvalue) & res_out$pvalue < 0.05)),
  paste0("Rows with BH padj < 0.1: ", sum(!is.na(res_out$padj) & res_out$padj < 0.1)),
  "",
  "To make inferential DESeq2 valid, rerun with biological replicates in each condition and use the standard DESeq() path."
)
writeLines(summary_lines[nzchar(summary_lines)], file.path(out, "summary.md"))
