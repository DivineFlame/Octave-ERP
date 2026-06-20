#!/usr/bin/env sh
set -eu

if [ "${1:-}" = "" ]; then
  echo "Usage: scripts/restore-postgres.sh ./backups/octave-crm-YYYYMMDD-HHMMSS.sql"
  exit 1
fi

cat "$1" | docker exec -i octave-postgres psql -U "${POSTGRES_USER:-octave}" "${POSTGRES_DB:-octave_crm}"
echo "Restore completed from $1"
