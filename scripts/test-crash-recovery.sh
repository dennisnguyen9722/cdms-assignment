#!/usr/bin/env bash
# Chứng minh: giết CDMS giữa lúc worker đang ghi không gây mất
# hay nhân đôi dữ liệu, nhờ transaction + unique constraint.
set -e
PSQL="docker compose exec -T postgres psql -U cdms -d cdms -tA"
RUN="CRASH$(date +%s)"

echo "=== Sinh lô 8000 sản phẩm (prefix $RUN) và nạp qua webhook ==="
node -e "
const n = 8000, run = '$RUN';
const arr = Array.from({length: n}, (_, i) => ({
  id: run + '-' + i, sku: 'SKU' + i, name: 'Crash test ' + i,
  category: 'Test', price: 10000 + i, stock: i % 500, unit: 'cái'
}));
process.stdout.write(JSON.stringify(arr));
" > /tmp/crash-batch.json

curl -s -X POST http://localhost:3000/webhook/products \
  -H 'Content-Type: application/json' \
  -H "x-delivery-id: $RUN" \
  --data-binary @/tmp/crash-batch.json
echo

echo "=== Giết CDMS trong lúc worker đang xử lý ==="
sleep 2
# stop -t 0: kill ngay nhưng đánh dấu đã dừng, tránh restart policy tự bật lại
docker compose stop -t 0 cdms

PENDING=$($PSQL -c "SELECT count(*) FROM raw_events WHERE status='pending';")
PARTIAL=$($PSQL -c "SELECT count(*) FROM product_changes WHERE product_id LIKE '$RUN%';")
echo "Event còn pending khi chết: $PENDING (cần > 0 thì test mới có ý nghĩa)"
echo "Bản ghi của lô này đã vào DB: $PARTIAL (kỳ vọng 0 - transaction rollback)"

echo "=== Khởi động lại ==="
docker compose start cdms
sleep 30

echo "=== Kiểm tra toàn vẹn ==="
$PSQL -c "SELECT count(*) FROM raw_events WHERE status='pending';" \
  | xargs -I{} echo "Event còn pending: {} (kỳ vọng 0)"

TOTAL=$($PSQL -c "SELECT count(*) FROM product_changes WHERE product_id LIKE '$RUN%';")
echo "Bản ghi sau phục hồi: $TOTAL (kỳ vọng 8000)"

DUP=$($PSQL -c "SELECT count(*) FROM (
        SELECT product_id, content_hash FROM product_changes
        GROUP BY product_id, content_hash HAVING count(*) > 1) t;")
echo "Bản ghi trùng: $DUP (kỳ vọng 0)"
[ "$DUP" = "0" ] && [ "$TOTAL" = "8000" ] && echo "OK: exactly-once được giữ nguyên" || echo "FAIL"
