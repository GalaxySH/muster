#!/usr/bin/env bash
# Nightly logical backup of ALL databases on the host's central MariaDB
# (Muster's `muster` DB rides along with every other app's data — PLAN §15).
#
# Install (as root — do NOT run from the repo clone in cron; the clone is
# writable by the deploy user, and root executing a deploy-user-writable file
# is a privilege-escalation path):
#   sudo install -o root -g root -m 755 ops/backup/backup-mariadb.sh /usr/local/sbin/backup-mariadb
#   sudo crontab -e          # add:  17 3 * * * /usr/local/sbin/backup-mariadb
#
# Auth: runs as root via MariaDB's unix_socket plugin (Ubuntu default for
# root@localhost) — no password stored anywhere.
#
# --single-transaction takes a consistent InnoDB snapshot without locking, so
# the other apps on this instance are not blocked while the dump runs.
#
# Restore (single DB):  zcat <file> | sudo mariadb muster
# Verify a backup:      zcat <file> | head   (should start with -- MariaDB dump)
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/var/backups/mariadb}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"

umask 077 # dumps contain every app's data — root-readable only
mkdir -p "$BACKUP_DIR"

stamp="$(date +%F_%H%M%S)"
out="$BACKUP_DIR/all-databases_${stamp}.sql.gz"

# Write to a .part first so a crashed run never leaves a plausible-looking
# truncated dump; gzip -t catches silent corruption before we keep it.
mariadb-dump --all-databases --single-transaction --routines --events --triggers |
  gzip >"${out}.part"
gzip -t "${out}.part"
mv "${out}.part" "$out"

# Rotate: drop dumps older than the retention window, and any stale .part.
find "$BACKUP_DIR" -name 'all-databases_*.sql.gz' -mtime +"$RETENTION_DAYS" -delete
find "$BACKUP_DIR" -name '*.part' -mtime +1 -delete

echo "backup-mariadb: wrote $out ($(du -h "$out" | cut -f1))"
