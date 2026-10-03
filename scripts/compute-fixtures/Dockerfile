FROM debian@sha256:a629e796d77a7b2ff82186ed15d01a493801c020eed5ce6adaa2704356f15a1c

# The fixture is deliberately opt-in and is never used by the production
# runner.  Pin package names and keep the image small enough for CI.
ARG DEBIAN_FRONTEND=noninteractive
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssh-server python3 munge slurm-wlm slurm-client \
 && rm -rf /var/lib/apt/lists/* \
 && mkdir -p /run/sshd /var/spool/slurmctld /var/spool/slurmd /var/log/slurm /workspace \
 && chmod 0755 /workspace

COPY sshd_config /etc/ssh/sshd_config
COPY slurm.conf /etc/slurm/slurm.conf
COPY entrypoint.sh /usr/local/bin/drone-compute-fixture
RUN chmod 0755 /usr/local/bin/drone-compute-fixture

EXPOSE 22
ENTRYPOINT ["/usr/local/bin/drone-compute-fixture"]
