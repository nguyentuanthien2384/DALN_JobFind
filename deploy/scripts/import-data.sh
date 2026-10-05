#!/bin/sh
# Nap du lieu vao MariaDB, PostgreSQL va MongoDB tren VPS. Nguon la ban xuat tu
# may dev (npm run vps:export-data) hoac ban sao luu cua scripts/backup.sh.
# Chay trong thu muc deploy/:
#   sh scripts/import-data.sh data-export/<thoi-diem>        lan dau, CSDL dang trong
#   sh scripts/import-data.sh backups/<thoi-diem> --force    XOA du lieu hien co roi nap lai
# Elasticsearch duoc search-service dung lai tu MySQL khi khoi dong.
set -eu
cd "$(dirname "$0")/.."

dir=${1:-}
force=${2:-}
if [ -z "$dir" ] || [ ! -d "$dir" ]; then
    echo "Dung: sh scripts/import-data.sh <thu-muc-du-lieu> [--force]" >&2
    exit 1
fi
if [ -n "$force" ] && [ "$force" != "--force" ]; then
    echo "Tham so khong hop le: $force" >&2
    exit 1
fi

# 1. Du file va dung checksum ghi trong manifest.json (bat loi chep thieu/hong).
[ -f "$dir/manifest.json" ] || { echo "Thieu $dir/manifest.json" >&2; exit 1; }
manifest=$(tr -d ' \t\r\n' < "$dir/manifest.json")
for file in mysql.sql postgres.dump mongo.archive.gz; do
    [ -f "$dir/$file" ] || { echo "Thieu $dir/$file" >&2; exit 1; }
    expected=$(printf '%s' "$manifest" | sed -n "s/.*\"$file\":{\"sha256\":\"\([0-9a-f]*\)\".*/\1/p")
    actual=$(sha256sum "$dir/$file" | cut -d' ' -f1)
    if [ -z "$expected" ] || [ "$expected" != "$actual" ]; then
        echo "$file khong khop checksum trong manifest.json (file hong hoac chep chua xong)." >&2
        exit 1
    fi
done
echo "Checksum hop le."

# 2. Bat cac kho du lieu (khong dung toi ung dung dang chay).
docker compose up -d --wait mysql postgres mongo

# 3. Tu choi ghi de du lieu dang co neu khong co --force; khi do he thong van chay nguyen.
mysql_tables=$(docker compose exec -T mysql sh -c 'MYSQL_PWD="$MARIADB_ROOT_PASSWORD" exec mariadb -uroot -N -B "$MARIADB_DATABASE"' <<'SQL'
SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE();
SQL
)
pg_tables=$(docker compose exec -T postgres sh -c 'exec psql -U "$POSTGRES_USER" -d application_db -tA' <<'SQL'
SELECT COUNT(*) FROM pg_tables WHERE schemaname NOT IN ('pg_catalog', 'information_schema');
SQL
)
mongo_dbs=$(docker compose exec -T mongo mongosh --quiet --eval \
    'db.adminCommand({ listDatabases: 1 }).databases.filter(d => !["admin", "config", "local"].includes(d.name)).length')
echo "Hien co: MySQL $mysql_tables bang, PostgreSQL $pg_tables bang, MongoDB $mongo_dbs CSDL."
if [ "$force" != "--force" ] && { [ "$mysql_tables" != 0 ] || [ "$pg_tables" != 0 ] || [ "$mongo_dbs" != 0 ]; }; then
    echo "CSDL tren VPS da co du lieu. Them --force de XOA va nap lai (nen chay scripts/backup.sh truoc)." >&2
    exit 1
fi

# 4. Dung moi ung dung de khong ai ghi trong luc nap; giu cac kho du lieu.
apps=$(docker compose --profile ai config --services | grep -vxE 'mysql|postgres|mongo|elasticsearch|redis|rabbitmq')
docker compose --profile ai stop $apps

if [ "$force" = "--force" ]; then
    echo "Xoa du lieu hien co ..."
    docker compose exec -T mysql sh -c 'MYSQL_PWD="$MARIADB_ROOT_PASSWORD" exec mariadb -uroot -e "
        DROP DATABASE IF EXISTS \`$MARIADB_DATABASE\`;
        CREATE DATABASE \`$MARIADB_DATABASE\` CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
        GRANT ALL ON \`$MARIADB_DATABASE\`.* TO \`$MARIADB_USER\`@\`%\`;"'
    docker compose exec -T postgres sh -c 'exec psql -U "$POSTGRES_USER" -d postgres -v ON_ERROR_STOP=1' <<'SQL'
DROP DATABASE IF EXISTS application_db WITH (FORCE);
CREATE DATABASE application_db;
SQL
    docker compose exec -T mongo mongosh --quiet --eval \
        'for (const name of ["identity_db", "admin_db", "ai_worker_db"]) db.getSiblingDB(name).dropDatabase()' > /dev/null
fi

# 5. Nap. Moi buoc dung ngay khi gap loi (set -e, --exit-on-error, --stopOnError).
echo "Nap MySQL ..."
docker compose exec -T mysql sh -c 'MYSQL_PWD="$MARIADB_ROOT_PASSWORD" exec mariadb -uroot --binary-mode=1 --max-allowed-packet=512M "$MARIADB_DATABASE"' < "$dir/mysql.sql"
echo "Nap PostgreSQL ..."
docker compose exec -T postgres sh -c 'exec pg_restore --no-owner --no-privileges --exit-on-error --single-transaction -U "$POSTGRES_USER" -d application_db' < "$dir/postgres.dump"
echo "Nap MongoDB ..."
docker compose exec -T mongo mongorestore --archive --gzip --drop --stopOnError --quiet \
    --nsExclude='admin.*' --nsExclude='config.*' --nsExclude='local.*' < "$dir/mongo.archive.gz"

echo "Nap xong. Khoi dong toan bo he thong ..."
docker compose up -d
echo "Xong. Theo doi: docker compose ps (cho cot STATUS deu 'healthy')."
