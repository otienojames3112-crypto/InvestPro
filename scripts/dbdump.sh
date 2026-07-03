#!/usr/bin/env bash
# Dump the project's TiDB (MySQL-compatible) database to a plain SQL file.
# Reads DATABASE_URL from the environment, requires TLS (TiDB Cloud enforces it).
set -euo pipefail

OUT="${1:-/home/ubuntu/kes5m-tracker-db-dump.sql}"

# Parse DATABASE_URL into parts via node (handles URL-encoding safely).
read -r DB_HOST DB_PORT DB_USER DB_PASS DB_NAME < <(node -e '
const x = new URL(process.env.DATABASE_URL);
process.stdout.write([
  x.hostname,
  x.port || "3306",
  decodeURIComponent(x.username),
  decodeURIComponent(x.password),
  decodeURIComponent(x.pathname.slice(1)),
].join(" "));
')

echo "Dumping ${DB_NAME} from ${DB_HOST}:${DB_PORT} -> ${OUT}" >&2

mysqldump \
  --host="${DB_HOST}" \
  --port="${DB_PORT}" \
  --user="${DB_USER}" \
  --password="${DB_PASS}" \
  --ssl-mode=REQUIRED \
  --single-transaction \
  --set-gtid-purged=OFF \
  --no-tablespaces \
  --column-statistics=0 \
  --skip-lock-tables \
  --default-character-set=utf8mb4 \
  "${DB_NAME}" > "${OUT}"

echo "Done. $(wc -l < "${OUT}") lines, $(du -h "${OUT}" | cut -f1)." >&2
