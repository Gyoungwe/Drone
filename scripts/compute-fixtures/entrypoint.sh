#!/bin/sh
set -eu

mkdir -p /run/sshd /run/munge /var/log/slurm /var/spool/slurmctld /var/spool/slurmd
chown -R munge:munge /run/munge
if [ ! -f /etc/munge/munge.key ]; then
  dd if=/dev/urandom of=/etc/munge/munge.key bs=1 count=1024 2>/dev/null
  chown munge:munge /etc/munge/munge.key
  chmod 0400 /etc/munge/munge.key
fi
if ! id drone >/dev/null 2>&1; then
  useradd --create-home --shell /bin/sh drone
fi
echo "drone:drone-fixture" | chpasswd
chown -R drone:drone /workspace
ssh-keygen -A >/dev/null 2>&1

su -s /bin/sh -c "munged --foreground --force" munge &
slurmctld -Dvv >/var/log/slurm/slurmctld.log 2>&1 &
slurmd -Dvv >/var/log/slurm/slurmd.log 2>&1 &
/usr/sbin/sshd -D -e
