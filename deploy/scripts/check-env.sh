#!/bin/sh
# Liet ke bien co trong .env.example nhung chua co trong .env, thuong do tinh nang moi
# them vao. Tra ve 0 khi du, 1 khi thieu. Chay trong thu muc deploy/:
#   sh scripts/check-env.sh
set -eu
cd "$(dirname "$0")/.."

[ -f .env ] || { echo "Chua co deploy/.env (tao bang npm run vps:env tren may dev)." >&2; exit 1; }

missing=$(grep -oE '^[A-Z_][A-Z0-9_]*=' .env.example | cut -d= -f1 | while read -r name; do
    grep -q "^$name=" .env || echo "$name"
done)

if [ -z "$missing" ]; then
    echo "deploy/.env du bien so voi .env.example."
    exit 0
fi

echo "deploy/.env con thieu (mo ta tung bien trong .env.example):"
for name in $missing; do
    printf '  %-32s mau: %s\n' "$name" "$(grep -m1 "^$name=" .env.example | cut -d= -f2-)"
done
echo "Them bang: sh scripts/set-env.sh TEN_BIEN 'gia-tri'"
exit 1
