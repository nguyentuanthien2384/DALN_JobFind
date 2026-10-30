#!/bin/sh
# Cap nhat JobFind tren VPS len code moi nhat tren GitHub, giu nguyen du lieu va ten mien.
# Chay trong thu muc deploy/:
#   sh scripts/update.sh
# Thu tu: sao luu -> git pull -> kiem tra bien moi -> build -> migration CSDL -> khoi dong lai.
# Ban cu van phuc vu trong luc build; website chi gian doan luc khoi dong lai (30-60 giay).
set -eu

# Toan bo nam trong mot ham: shell doc het truoc khi chay, nen git pull doi chinh file nay cung khong sao.
main() {
    cd "$(dirname "$0")/.."

    echo "== 1/6 Sao luu du lieu"
    sh scripts/backup.sh

    echo "== 2/6 Lay code moi tu GitHub"
    git pull --ff-only

    echo "== 3/6 Kiem tra bien moi truong"
    for mode_var in REACT_APP_JOB_CREATE_MODE REACT_APP_JOB_EDIT_MODE REACT_APP_JOB_REPOST_MODE REACT_APP_JOB_WORKSPACE_MODE REACT_APP_JOB_SEARCH_MODE; do
        if grep -q "^${mode_var}=legacy$" .env 2>/dev/null; then
            sed -i "s|^${mode_var}=legacy$|${mode_var}=core|" .env
            echo "   Da nang cap ${mode_var}=core trong deploy/.env"
        fi
    done
    if ! sh scripts/check-env.sh; then
        echo "   Canh bao: tinh nang dung cac bien tren se chua hoat dong cho den khi them bang"
        echo "   sh scripts/set-env.sh TEN_BIEN 'gia-tri'. Van tiep tuc cap nhat."
    fi

    echo "== 4/6 Build image moi"
    docker compose build

    echo "== 5/6 Cap nhat cau truc CSDL (chi chay migration moi)"
    docker compose run --rm backend node /app/scripts/migrate-auth.mjs --from-env
    docker compose run --rm backend node /app/scripts/migrate-backend.mjs --from-env
    docker compose run --rm --no-deps admin-service node scripts/migrate-audit-retention.mjs --apply --allow-expiry
    docker compose run --rm --no-deps admin-service node ../scripts/provision-db-users.mjs --apply

    echo "== 6/6 Khoi dong ban moi"
    docker compose up -d
    docker compose ps --format 'table {{.Service}}\t{{.Status}}'
    echo "Xong. Dich vu nao chua 'healthy' sau 2 phut: docker compose logs --tail 80 <dich-vu>"
}

main "$@"
