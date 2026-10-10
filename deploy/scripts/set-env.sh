#!/bin/sh
# Them hoac sua mot bien trong deploy/.env roi ap dung ngay. Chay trong thu muc deploy/:
#   sh scripts/set-env.sh TEN_BIEN 'gia-tri'              sua va khoi dong lai dich vu lien quan
#   sh scripts/set-env.sh TEN_BIEN 'gia-tri' --no-apply   chi sua file (de dat nhieu bien roi
#                                                         chay docker compose up -d mot lan)
# Bien REACT_APP_* duoc dong vao giao dien luc build, nen tu build lai web.
# Khong in gia tri ra man hinh (co the la khoa bi mat).
set -eu
cd "$(dirname "$0")/.."
umask 077

name=${1:-}
value=${2-}
apply=${3:-}
if [ -z "$name" ] || [ $# -lt 2 ]; then
    echo "Dung: sh scripts/set-env.sh TEN_BIEN 'gia-tri' [--no-apply]" >&2
    exit 1
fi
if [ -n "$apply" ] && [ "$apply" != "--no-apply" ]; then
    echo "Tham so khong hop le: $apply" >&2
    exit 1
fi
if ! printf '%s' "$name" | grep -qE '^[A-Z_][A-Z0-9_]*$'; then
    echo "Ten bien chi gom chu IN HOA, so va dau _: $name" >&2
    exit 1
fi

# CSDL va RabbitMQ chi doc cac gia tri nay khi tao volume lan dau; doi o day se lam dich vu mat ket noi.
case "$name" in
    MYSQL_ROOT_PASSWORD|MYSQL_PASSWORD|MYSQL_USER|MYSQL_DATABASE|POSTGRES_PASSWORD|POSTGRES_USER|RABBITMQ_PASSWORD|RABBITMQ_USER)
        echo "Khong doi $name bang lenh nay: CSDL/RabbitMQ van giu gia tri cu nen dich vu se mat ket noi." >&2
        echo "Can doi mat khau ngay trong CSDL truoc; hoi lai neu thuc su can." >&2
        exit 1 ;;
esac

case "$value" in
    *"'"*) echo "Gia tri khong duoc chua dau nhay don ('): sua truc tiep trong deploy/.env." >&2; exit 1 ;;
esac
if [ "$(printf '%s' "$value" | wc -l)" -gt 0 ]; then
    echo "Gia tri khong duoc xuong dong." >&2
    exit 1
fi

# Gia tri co dau cach, #, $... dat trong nhay don de Compose khong noi suy.
if printf '%s' "$value" | grep -qE '^[A-Za-z0-9_./:@+,=-]*$'; then line="$name=$value"; else line="$name='$value'"; fi

[ -f .env ] || { echo "Chua co deploy/.env" >&2; exit 1; }
cp .env .env.bak
NAME="$name" LINE="$line" awk '
    BEGIN { name = ENVIRON["NAME"] "="; line = ENVIRON["LINE"] }
    index($0, name) == 1 { if (!done) print line; done = 1; next }
    { print }
    END { if (!done) print line }
' .env.bak > .env.tmp
chmod 600 .env.tmp
mv .env.tmp .env
echo "Da dat $name (${#value} ky tu). Ban cu luu o deploy/.env.bak."

[ "$apply" = "--no-apply" ] && { echo "Chua ap dung: chay docker compose up -d khi xong."; exit 0; }
case "$name" in
    REACT_APP_*) echo "Build lai giao dien ..."; docker compose up -d --build web ;;
    *) docker compose up -d ;;
esac
echo "Da ap dung."
