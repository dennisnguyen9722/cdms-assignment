#!/usr/bin/env bash
# Chứng minh: Vietful trả lỗi 500 không làm hỏng dữ liệu đã có,
# và hệ thống tự phục hồi khi Vietful khỏe lại.
set -e
PSQL="docker compose exec -T postgres psql -U cdms -d cdms -tA"

count() { $PSQL -c "SELECT count(*) FROM product_changes;"; }

echo "=== Trước khi gây lỗi ==="
BEFORE=$(count); echo "product_changes: $BEFORE"

echo "=== Bật lỗi 100% trong 90 giây ==="
curl -s -X POST "http://localhost:3001/_chaos?rate=1.0" > /dev/null
sleep 90

DURING=$(count); echo "product_changes trong lúc lỗi: $DURING"
[ "$BEFORE" = "$DURING" ] && echo "OK: không mất, không ghi rác" || echo "FAIL"

echo "=== Tắt lỗi, thay đổi 5 sản phẩm, chờ phục hồi ==="
curl -s -X POST "http://localhost:3001/_chaos?rate=0" > /dev/null
curl -s -X POST "http://localhost:3001/_mutate?count=5" > /dev/null
sleep 40

AFTER=$(count); echo "product_changes sau phục hồi: $AFTER"
echo "Chênh lệch: $((AFTER - BEFORE)) (kỳ vọng khoảng 5)"
