#!/usr/bin/env sh
set -eu

BACKUP_DIR="${BACKUP_DIR:-./backups}"
STAMP="$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BACKUP_DIR"

docker exec octave-postgres pg_dump -U "${POSTGRES_USER:-octave}" "${POSTGRES_DB:-octave_crm}" > "$BACKUP_DIR/octave-crm-$STAMP.sql"
echo "Backup written to $BACKUP_DIR/octave-crm-$STAMP.sql"
