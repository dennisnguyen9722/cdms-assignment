# Change Data Management Service (CDMS)

A prototype service that captures **only the changes** to Vietful inventory
product data, storing each change exactly once across multiple ingestion
mechanisms and across component failures.

Built for the kSynerX technical assignment.

- Design decisions and trade-offs: [`docs/DESIGN.md`](docs/DESIGN.md)
- AI tool usage: [`docs/AI_USAGE.md`](docs/AI_USAGE.md)

---

## Quick start

Requires Docker and Docker Compose. Nothing else.

```bash
git clone <repo-url>
cd cdms-assignment
docker compose up -d --build
docker compose logs -f cdms
```

Within 30 seconds the log shows the first poll and the worker processing it:

```
[Collector] Đã nhận lô #1 với 500 sản phẩm
[Worker] Event #1: 500 mới, 0 thay đổi, 0 không đổi
```

Thirty seconds later, with nothing changed upstream:

```
[Collector] Lô 500 sản phẩm không đổi so với lần trước, bỏ qua
```

No new rows are written. That is the core requirement of the assignment.

Services: Postgres on `localhost:5433`, Vietful emulator on `localhost:3001`,
CDMS on `localhost:3000`.

> Postgres is mapped to 5433 to avoid colliding with a local Postgres install.
> Inside the Docker network the services address each other as `postgres:5432`
> and `vietful:3001`.

---

## Try it

### Change detection

```bash
# modify 3 existing products, add 2 new ones
curl -X POST "http://localhost:3001/_mutate?count=3"
curl -X POST "http://localhost:3001/_add?count=2"
```

Next poll reports exactly `2 mới, 3 thay đổi, 497 không đổi`.

### Webhook ingestion

```bash
curl -X POST http://localhost:3000/webhook/products \
  -H 'Content-Type: application/json' \
  -H 'x-delivery-id: demo-001' \
  -d '[{"id":"SP99001","sku":"WH001","name":"Webhook product",
        "category":"Test","price":50000,"stock":100,"unit":"cái"}]'
```

Returns `202 {"status":"accepted"}`. Send the identical request again:

```
{"status":"duplicate_ignored"}
```

### Inspect the results

```bash
docker compose exec postgres psql -U cdms -d cdms -c \
  "SELECT change_type, count(*) FROM product_changes GROUP BY change_type;
   SELECT source, count(*) FROM product_changes GROUP BY source;
   SELECT status, count(*) FROM raw_events GROUP BY status;"
```

---

## How it works

```
  scheduled poll ──┐
  webhook       ───┼──▶  raw_events  ──▶  worker  ──┬──▶  products_current
  excel upload  ───┘     (inbox)        (one tx)    └──▶  product_changes
```

Every ingestion path writes the raw payload to an inbox table and returns
immediately. A worker drains the inbox in a single transaction per event,
compares each product against a stored SHA-256 content hash, and appends a row
to `product_changes` only when the hash differs.

**Exactly-once** is achieved as *at-least-once delivery plus idempotent writes*,
enforced at two layers:

| Layer | Constraint | Catches |
|---|---|---|
| Ingestion | `raw_events.idempotency_key UNIQUE` | duplicate batches |
| Persistence | `product_changes UNIQUE (product_id, content_hash)` | duplicate records |

Writing the changes, updating current state and marking the event done all
happen inside one transaction, so a crash mid-processing rolls back and the
event is safely reprocessed on restart.

Full reasoning in [`docs/DESIGN.md`](docs/DESIGN.md).

---

## Observed behaviour worth noting

After a session of polling, mutating and restarting the emulator:

```
 change_type | count        source  | count
-------------+-------      ---------+-------
 CREATED     |   503        poll    |   508
 UPDATED     |     6        webhook |     1
```

Two things in these numbers are deliberate, not bugs:

**`products_current` holds 503 rows while the emulator serves 500.** The service
only records what it sees; products removed upstream are invisible to polling.
Deletion detection is a known limitation, discussed in DESIGN.md §7.

**The worker reported 9 changes but only 6 `UPDATED` rows exist.** Products that
were mutated and later reverted to their original values produced a content hash
identical to an already-stored row, so the unique constraint rejected the write.
The worker saw a difference against current state; the database correctly refused
to store content it had seen before. This is the second deduplication layer
working on data that arose naturally rather than in a contrived test.

---

## Project layout

```
apps/vietful-emulator/   Express + faker; emulates the Vietful Products API
apps/cdms/               NestJS: collector (cron), webhook controller, worker
db/init.sql              Schema and constraints
docs/                    Design document and AI usage notes
scripts/                 Failure-injection and load scripts
```

The emulator exposes three control endpoints that are not part of the real
Vietful API, used for demonstration:

| Endpoint | Purpose |
|---|---|
| `POST /_mutate?count=N` | randomly modify N products |
| `POST /_add?count=N` | append N new products |
| `POST /_chaos?rate=0.3` | return HTTP 500 for a fraction of requests |

---

## Status

Implemented: scheduled polling, webhook ingestion, change detection via content
hash, two-layer deduplication, single-transaction processing, containerised
deployment.

Not implemented: Excel upload, deletion detection, retry backoff and
dead-letter handling.

The full breakdown, including how each unfinished item would be approached, is
in [`docs/DESIGN.md`](docs/DESIGN.md) §7.

---

## Local development

To run CDMS outside Docker against the containerised Postgres and emulator:

```bash
docker compose up -d postgres vietful
cd apps/cdms
cp .env.example .env
npm install
npm run start:dev
```
