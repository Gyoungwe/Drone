# SSH + Slurm fixture

This directory contains an opt-in single-node Slurm controller/worker and
OpenSSH daemon. The base image is pinned by digest. `start-compute-fixture.sh`
checks that the Docker daemon is reachable before starting it; production
deployments never depend on this fixture.

`test-compute-docker.sh` exercises the real `squeue`/`sbatch` commands and the
runner process inside the container. The offline runner test in
`scripts/test-compute-runner.sh` covers direct process lifecycle behavior when
Docker is unavailable.
