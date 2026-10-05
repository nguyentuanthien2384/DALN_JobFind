#!/bin/sh
# Sao luu MariaDB, PostgreSQL va MongoDB tren VPS vao deploy/backups/<thoi-diem>/,
# cung dinh dang voi ban xuat tu may dev. Khoi phuc:
#   sh scripts/import-data.sh backups/<thoi-diem> --force
# Chi giu KEEP_DAYS ngay gan nhat (mac dinh 14). Lich tu dong: xem deploy/README.md.
# Chay trong thu muc deploy/:  sh scripts/backup.sh
set -eu
cd "$(dirname "$0")/.."

keep_days=${KEEP_DAYS:-14}
stamp=$(date -u +%Y-%m-%dT%H-%M-%SZ)
dir="backups/$stamp"
umask 077
mkdir -p "$dir"
done_ok=
cleanup() { [ -n "$done_ok" ] || rm -rf "$dir"; }
trap cleanup EXIT

docker compose exec -T mysql sh -c 'MYSQL_PWD="$MARIADB_ROOT_PASSWORD" exec mariadb-dump -uroot --single-transaction --quick --hex-blob --default-character-set=utf8mb4 --max-allowed-packet=512M "$MARIADB_DATABASE"' > "$dir/mysql.sql"
tail -n 1 "$dir/mysql.sql" | grep -q 'Dump completed' || { echo "Ban sao MySQL khong tron ven." >&2; exit 1; }
docker compose exec -T postgres sh -c 'exec pg_dump -U "$POSTGRES_USER" -d application_db -Fc' > "$dir/postgres.dump"
docker compose exec -T mongo mongodump --archive --gzip --quiet > "$dir/mongo.archive.gz"

{
    printf '{\n  "createdAt": "%s",\n  "source": "vps-backup",\n  "files": {\n' "$stamp"
    first=1
    for file in mysql.sql postgres.dump mongo.archive.gz; do
        [ -n "$first" ] || printf ',\n'
        first=
        printf '    "%s": { "sha256": "%s", "bytes": %s }' "$file" \
            "$(sha256sum "$dir/$file" | cut -d' ' -f1)" "$(wc -c < "$dir/$file" | tr -d ' ')"
    done
    printf '\n  }\n}\n'
} > "$dir/manifest.json"
done_ok=1

find backups -mindepth 1 -maxdepth 1 -type d -mtime +"$keep_days" -exec rm -rf {} +
echo "Da sao luu: deploy/$dir ($(du -sh "$dir" | cut -f1))"
