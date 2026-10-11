#!/usr/bin/env python3
"""Salmon quantification for the public Pasilla QC runner output."""

from __future__ import annotations

import csv
import gzip
import os
import shutil
import subprocess
import sys
import urllib.request
from pathlib import Path


REFERENCE_URL = (
    "https://ftp.ensembl.org/pub/release-109/fasta/"
    "drosophila_melanogaster/cdna/Drosophila_melanogaster.BDGP6.32.cdna.all.fa.gz"
)


def command(name: str) -> str:
    root = "/Data/Liuxingyue/home/gaoyangwei/miniconda3/envs/drone-rnaseq-demo/bin"
    candidate = Path(root) / name
    if candidate.is_file() and os.access(candidate, os.X_OK):
        return str(candidate)
    found = shutil.which(name)
    if found:
        return found
    raise RuntimeError(f"{name} is unavailable in the approved RNA-seq environment")


def ensure_reference(root: Path) -> Path:
    references = root / "references"
    references.mkdir(parents=True, exist_ok=True)
    compressed = references / "drosophila.BDGP6.32.cdna.fa.gz"
    fasta = references / "drosophila.BDGP6.32.cdna.fa"
    if not compressed.exists():
        temporary = compressed.with_suffix(".part")
        urllib.request.urlretrieve(REFERENCE_URL, temporary)
        temporary.replace(compressed)
    if not fasta.exists():
        with gzip.open(compressed, "rb") as source, fasta.open("wb") as target:
            shutil.copyfileobj(source, target)
    return fasta


def main() -> int:
    if len(sys.argv) != 2:
        raise SystemExit("usage: pasilla_quant.py PREVIOUS_RUN_ID")
    previous_run = sys.argv[1]
    root = Path(os.environ.get("DRONE_REMOTE_ROOT", Path.home() / ".drone")).expanduser()
    source = root / "runs" / previous_run / "outputs"
    if not source.is_dir():
        raise RuntimeError(f"previous Drone output directory is unavailable: {source}")
    out = Path.cwd() / "quant"
    out.mkdir(parents=True, exist_ok=True)
    salmon = command("salmon")
    fasta = ensure_reference(root)
    index = root / "references" / "salmon-index"
    if not (index / "versionInfo.json").exists():
        subprocess.run([salmon, "index", "-t", str(fasta), "-i", str(index), "-k", "31"], check=True)
    rows = []
    for sample in ("GSM461177", "GSM461180"):
        sample_out = out / sample
        subprocess.run(
            [
                salmon,
                "quant",
                "-i",
                str(index),
                "-l",
                "A",
                "-1",
                str(source / "trimmed" / f"{sample}_R1.trimmed.fastq"),
                "-2",
                str(source / "trimmed" / f"{sample}_R2.trimmed.fastq"),
                "-p",
                "2",
                "--validateMappings",
                "-o",
                str(sample_out),
            ],
            check=True,
        )
        with (sample_out / "quant.sf").open(newline="", encoding="utf-8") as handle:
            reader = csv.DictReader(handle, delimiter="\t")
            total = sum(float(row["NumReads"]) for row in reader)
        rows.append((sample, total))
    with (out / "summary.tsv").open("w", newline="", encoding="utf-8") as handle:
        writer = csv.writer(handle, delimiter="\t")
        writer.writerow(("sample", "estimated_fragments"))
        writer.writerows(rows)
    (out / "summary.md").write_text(
        "# Pasilla Salmon quantification\n\n"
        "Reference: Drosophila melanogaster BDGP6.32 cDNA (Ensembl release 109).\n\n"
        + "\n".join(f"- {sample}: {fragments:,.1f} estimated fragments" for sample, fragments in rows)
        + "\n",
        encoding="utf-8",
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
