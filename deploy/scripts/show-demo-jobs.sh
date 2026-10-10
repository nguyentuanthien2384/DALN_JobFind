#!/bin/sh
# Hien lai cac tin "[Demo]" tren VPS (tuong duong `npm run demo:show-jobs` o may dev).
# Du lieu xuat len VPS ngay 05-07/10 co 138 tin demo dang an (PS4), nen trang Viec lam
# chi con tin tu nguon ben ngoai. Script chi doi statusCode PS4 -> PS1 cho tin do bo du
# lieu demo tao ra (bang jobfind_demo_records, ten bat dau "[Demo]"), roi lap chi muc
# tim kiem lai. Tin khac khong bi dong toi. An lai: sh scripts/show-demo-jobs.sh --hide
# Chay trong thu muc deploy/:  sh scripts/show-demo-jobs.sh [--dry-run|--hide]
set -eu
cd "$(dirname "$0")/.."

mode=${1:-show}
case "$mode" in
    show|--dry-run) from=PS4; to=PS1 ;;
    --hide) from=PS1; to=PS4 ;;
    *) echo "Cach dung: sh scripts/show-demo-jobs.sh [--dry-run|--hide]" >&2; exit 2 ;;
esac

sql() {
    docker compose exec -T mysql sh -c 'MYSQL_PWD="$MARIADB_ROOT_PASSWORD" exec mariadb -uroot -N -B "$MARIADB_DATABASE"'
}
demo_posts="FROM posts p
    JOIN jobfind_demo_records r ON r.recordId = p.id AND r.tableName = 'posts' AND r.seedKey LIKE 'jobfind-demo-v1:%'
    JOIN detailposts d ON d.id = p.detailPostId
    WHERE p.statusCode = '$from' AND d.name LIKE '[Demo]%'"

count=$(echo "SELECT COUNT(*) $demo_posts;" | sql)
echo "Tin demo co trang thai $from se doi sang $to: $count"
[ "$mode" = "--dry-run" ] && exit 0
[ "$count" -gt 0 ] || { echo "Khong co gi de doi."; exit 0; }

echo "UPDATE posts p
    JOIN jobfind_demo_records r ON r.recordId = p.id AND r.tableName = 'posts' AND r.seedKey LIKE 'jobfind-demo-v1:%'
    JOIN detailposts d ON d.id = p.detailPostId
    SET p.statusCode = '$to', p.updatedAt = NOW()
    WHERE p.statusCode = '$from' AND d.name LIKE '[Demo]%';" | sql
echo "Da doi $count tin demo sang $to."

# Trang Viec lam che do legacy doc thang MySQL; chatbot va Core search doc Elasticsearch.
indexed=$(docker compose exec -T search-service node -e "fetch('http://127.0.0.1:4003/internal/reindex',{method:'POST',headers:{'x-internal-secret':process.env.INTERNAL_SECRET,'content-type':'application/json'},body:'{}'}).then(async r=>{const b=await r.json();if(!r.ok||b.errCode!==0)process.exit(1);console.log(b.indexed)}).catch(()=>process.exit(1))") \
    && echo "Da lap chi muc tim kiem lai: $indexed tin." \
    || echo "Chua lap chi muc lai duoc (search-service chua chay?); chay lai script sau khi stack len." >&2
