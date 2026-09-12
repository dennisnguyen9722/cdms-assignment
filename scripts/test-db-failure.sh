#!/usr/bin/env bash
# Chứng minh: Postgres sập thì CDMS báo lỗi nhưng không chết,
# và tự làm việc lại khi DB sống lại.
set -e
echo "=== Tắt Postgres 45 giây ==="
docker compose stop postgres
sleep 45

echo "=== CDMS còn sống không? ==="
docker compose ps cdms

echo "=== Bật lại Postgres ==="
docker compose start postgres
sleep 30

docker compose exec -T postgres psql -U cdms -d cdms -tA \
  -c "SELECT status, count(*) FROM raw_events GROUP BY status;"
