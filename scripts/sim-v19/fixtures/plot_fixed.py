#!/usr/bin/env python3
"""Deterministic plot fixture for the simulated-user run."""
import argparse
import csv
from pathlib import Path

import matplotlib.pyplot as plt


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", default=".")
    args = parser.parse_args()
    root = Path(args.out).resolve()
    rows = list(csv.DictReader((root / "data.csv").open(newline="", encoding="utf-8")))
    values = [float(row["value"]) for row in rows]
    if values != [1.0, 3.0, 5.0, 7.0]:
        raise SystemExit(f"unexpected fixture values: {values}")
    x = list(range(1, len(values) + 1))
    fig, ax = plt.subplots(figsize=(5, 3), dpi=120)
    ax.plot(x, values, marker="o", color="#2563eb")
    ax.set_xlabel("sample")
    ax.set_ylabel("value")
    ax.set_title("Deterministic fixture")
    ax.grid(True, alpha=0.25)
    fig.tight_layout()
    fig.savefig(root / "figure.png", metadata={"Software": "drone-sim-v19"})
    plt.close(fig)
    (root / "result.md").write_text(
        "# Fixed analysis result\n\n"
        "- n = 4\n"
        "- mean = 4\n"
        "- slope = 2\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()

