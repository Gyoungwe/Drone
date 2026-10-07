---
name: bio-environment
description: "Set up and reuse analysis environments for Drone: know the platform (OS/arch/shell/WSL/GPU), reuse registered conda/mamba envs, create missing ones with bioconda, record them for later sessions, and run on a registered SSH host when asked."
alwaysWith: analysis
---

# Analysis environment workflow

Use this before running any command-line analysis (alignment, tree building, variant calling, RNA-seq, docking…). A missing tool is a setup step, never a reason to end the task.

## 1. Know where you are
- The system prompt carries a one-line `Host platform` summary. Call `bio_environment` for details: OS/arch, default shell, WSL, GPU (nvidia-smi), conda/mamba/micromamba, containers, CPUs/RAM/disk, installed tools and the environments already registered for this host.
- Windows: run local commands with PowerShell syntax. Most bioconda tools (MAFFT, IQ-TREE, samtools…) have no native Windows build; prefer WSL (`wsl -e bash -lc "…"`) or a Linux host. macOS arm64: some bioconda packages need `--platform osx-64` or a container.

## 2. Reuse before creating
1. `bio_env_registry({action:"find", tools:[…]})` for the tools the task needs (use `host` for a remote machine).
2. If an env is listed, `bio_env_registry({action:"verify", name})` and use it when its tools still answer.
3. If verification reports missing tools, install them into that env (`mamba install -n <env> -c conda-forge -c bioconda …`) or create a new one.

## 3. Create (inside the approved task plan)
- Include the environment setup in `task_plan` (scope, write directories); installation runs through the shell tool and its normal approvals. Load `coding` for the shell.
- Name envs by purpose, e.g. `phylogeny`, `rnaseq`, `variants`:
  - phylogeny: `mamba create -n phylogeny -y -c conda-forge -c bioconda mafft trimal iqtree fasttree biopython ete4`
  - variants: `mamba create -n variants -y -c conda-forge -c bioconda samtools bcftools bwa-mem2 gatk4`
  - rnaseq: `mamba create -n rnaseq -y -c conda-forge -c bioconda salmon star subread pydeseq2 scanpy`
- No conda/mamba: propose installing Miniforge (user-level, no admin) or using a bioconda container; ask the user first.
- GPU work: check the GPU line before choosing CUDA builds.

## 4. Record and run
- `bio_env_registry({action:"record", name, manager, tools:[…], packages:[…], purpose})` — it verifies the tools and stores versions, platform and time in `environments.json` so later sessions reuse it.
- Run tools via `<manager> run -n <env> <tool> …` and write the versions into the run record / Methods.

## 5. Remote hosts
- `ssh_hosts` lists the machines the user registered; use their alias. Only SSH keys / `~/.ssh/config` are used — never ask for or store passwords. Every connection needs the user's approval.
- Probe with `bio_environment({host})`, reuse with `bio_env_registry({action:"find", host, tools})`, create the env there with `ssh`, then `record` with the same `host`.
- Move data with `scp`/`rsync -e ssh` using the host alias (local shell, normal approvals); keep large data on the host and bring back only results.
- Honour `/run-on local|<host>|auto` placement.
