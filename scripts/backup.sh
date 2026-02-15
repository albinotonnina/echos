#!/bin/bash
set -euo pipefail

# EchOS backup script
# Backs up knowledge files, SQLite DB, and LanceDB

BACKUP_DIR="${1:-./backups}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_PATH="$BACKUP_DIR/echos_backup_$TIMESTAMP"

echo "Creating backup at $BACKUP_PATH..."

mkdir -p "$BACKUP_PATH"

# Backup knowledge files
if [ -d "data/knowledge" ]; then
  cp -r data/knowledge "$BACKUP_PATH/knowledge"
  echo "  Knowledge files backed up"
fi

# Backup SQLite DB
if [ -f "data/db/echos.db" ]; then
  sqlite3 data/db/echos.db ".backup '$BACKUP_PATH/echos.db'"
  echo "  SQLite database backed up"
fi

# Backup LanceDB
if [ -d "data/db/vectors" ]; then
  cp -r data/db/vectors "$BACKUP_PATH/vectors"
  echo "  LanceDB vectors backed up"
fi

# Create tarball
tar -czf "$BACKUP_DIR/echos_backup_$TIMESTAMP.tar.gz" -C "$BACKUP_DIR" "echos_backup_$TIMESTAMP"
rm -rf "$BACKUP_PATH"

echo "Backup complete: $BACKUP_DIR/echos_backup_$TIMESTAMP.tar.gz"
