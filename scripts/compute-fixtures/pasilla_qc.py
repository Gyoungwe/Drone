#!/usr/bin/env python3
"""Small public Pasilla paired-end RNA-seq QC/trim workflow for Drone.

The runner invokes this file with a fixed argv from its host workflow registry.
It intentionally uses only the public Zenodo subsample and writes every result
below the runner-owned outputs directory.
"""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import subprocess
import urllib.request
from pathlib import Path


ZENODO = "https://zenodo.org/records/6457007/files"
SAMPLES = {
    "GSM461177": (
        f"{ZENODO}/GSM461177_1_subsampled.fastqsanger",
        f"{ZENODO}/GSM461177_2_subsampled.fastqsanger",
    ),
    "GSM461180": (
        f"{ZENODO}/GSM461180_1_subsampled.fastqsanger",
        f"{ZENODO}/GSM461180_2_subsampled.fastqsanger",
    ),
}


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def download(url: str, destination: Path) -> None:
    if destination.exists() and destination.stat().st_size > 0:
        return
    temporary = destination.with_suffix(destination.suffix + ".part")
    temporary.parent.mkdir(parents=True, exist_ok=True)
    urllib.request.urlretrieve(url, temporary)
    temporary.replace(destination)


def fastp_path() -> str:
    candidates = [
        os.environ.get("DRONE_FASTP"),
        shutil.which("fastp"),
        "/Data/Liuxingyue/home/gaoyangwei/miniconda3/envs/fastp/bin/fastp",
    ]
    for candidate in candidates:
        if candidate and Path(candidate).is_file() and os.access(candidate, os.X_OK):
            return candidate
    raise RuntimeError("fastp is unavailable; prepare the approved conda environment first")


def main() -> int:
    root = Path.cwd()
    inputs = root / "input"
    qc = root / "qc"
    trimmed = root / "trimmed"
    inputs.mkdir(parents=True, exist_ok=True)
    qc.mkdir(parents=True, exist_ok=True)
    trimmed.mkdir(parents=True, exist_ok=True)
    fastp = fastp_path()
    records = []
    for sample, (read1_url, read2_url) in SAMPLES.items():
        read1 = inputs / f"{sample}_R1.fastq"
        read2 = inputs / f"{sample}_R2.fastq"
        download(read1_url, read1)
        download(read2_url, read2)
        json_path = qc / f"{sample}.fastp.json"
        html_path = qc / f"{sample}.fastp.html"
        log_path = qc / f"{sample}.fastp.log"
        subprocess.run(
            [
                fastp,
                "--in1",
                str(read1),
                "--in2",
                str(read2),
                "--out1",
                str(trimmed / f"{sample}_R1.trimmed.fastq"),
                "--out2",
                str(trimmed / f"{sample}_R2.trimmed.fastq"),
                "--json",
                str(json_path),
                "--html",
                str(html_path),
                "--thread",
                "2",
                "--length_required",
                "20",
            ],
            check=True,
            stdout=log_path.open("w", encoding="utf-8"),
            stderr=subprocess.STDOUT,
        )
        report = json.loads(json_path.read_text(encoding="utf-8"))
        before = report["summary"]["before_filtering"]
        after = report["summary"]["after_filtering"]
        records.append(
            {
                "sample": sample,
                "read1_bytes": read1.stat().st_size,
                "read2_bytes": read2.stat().st_size,
                "read1_sha256": sha256(read1),
                "read2_sha256": sha256(read2),
                "pairs_before": before["total_reads"] // 2,
                "pairs_after": after["total_reads"] // 2,
                "bases_before": before["total_bases"],
                "bases_after": after["total_bases"],
                "q20_after": after["q20_rate"],
                "q30_after": after["q30_rate"],
            }
        )
    lines = [
        "sample\tread1_bytes\tread2_bytes\tpairs_before\tpairs_after\tbases_before\tbases_after\tq20_after\tq30_after"
    ]
    lines.extend(
        "{sample}\t{read1_bytes}\t{read2_bytes}\t{pairs_before}\t{pairs_after}\t{bases_before}\t{bases_after}\t{q20_after:.6f}\t{q30_after:.6f}".format(**row)
        for row in records
    )
    (qc / "summary.tsv").write_text("\n".join(lines) + "\n", encoding="utf-8")
    markdown = [
        "# Pasilla public RNA-seq QC demo",
        "",
        "Input: Zenodo 6457007 subsampled paired-end FASTQ files.",
        "Tool: fastp from the pre-existing remote Conda environment.",
        "",
        "| Sample | Pairs before | Pairs after | Q20 after | Q30 after |",
        "|---|---:|---:|---:|---:|",
    ]
    markdown.extend(
        f"| {row['sample']} | {row['pairs_before']:,} | {row['pairs_after']:,} | {row['q20_after']:.3%} | {row['q30_after']:.3%} |"
        for row in records
    )
    markdown.extend(["", "The remote runner retained trimmed FASTQ files and per-sample fastp HTML/JSON reports."])
    (qc / "summary.md").write_text("\n".join(markdown) + "\n", encoding="utf-8")
    (qc / "manifest.json").write_text(json.dumps(records, indent=2) + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
