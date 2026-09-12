# CDMS — Design Document

Change Data Management Service prototype for the kSynerX assignment.

---

## 1. Problem

Vietful holds product/inventory data that changes over time. Polling the full
catalogue on a schedule and storing every snapshot would write millions of rows
per day while only a handful of products actually change. The service must
persist **only what changed**, exactly once, across three ingestion mechanisms
and across failures of any component.

---

## 2. Architecture

```
                   ┌──────────────────────────────┐
  scheduled poll ──┤                              │
  webhook       ───┤   raw_events (inbox queue)   │──┐
  excel upload  ───┤                              │  │
                   └──────────────────────────────┘  │
                                                     ▼
                                         ┌──────────────────────┐
                                         │  worker (one tx per  │
                                         │  event)              │
                                         └──────────┬───────────┘
                                                    │
                             ┌──────────────────────┴─────────────────┐
                             ▼                                        ▼
                   products_current                         product_changes
                   (latest state + hash)                    (append-only log)
```

Three components run as containers on a single machine: `postgres`,
`vietful-emulator`, `cdms`. The CDMS process hosts the collector (cron), the
webhook controller and the worker.

### 2.1 Why an inbox table instead of processing inline

Every ingestion path does one thing only: write the raw payload to `raw_events`
and return. Processing happens in a separate loop. This buys four things at once:

- **Spike tolerance** — the webhook answers `202 Accepted` immediately and never
  blocks on database contention, so the caller never times out.
- **Crash safety** — once the payload is in the inbox it survives a process
  restart; nothing is held only in memory.
- **Uniformity** — poll, webhook and Excel converge on one code path. Adding the
  webhook required zero changes to the worker.
- **Backpressure** — the queue absorbs bursts; the worker drains at its own rate.

---

## 3. Change detection

A product is considered changed when its **content hash** differs from the hash
stored in `products_current`.

```
canonical = JSON with keys sorted alphabetically, volatile fields removed
hash      = sha256(canonical)
```

Comparing one hash replaces comparing every field individually, so no field can
be silently missed when Vietful adds one.

Two details that matter:

- **Key ordering.** `{"a":1,"b":2}` and `{"b":2,"a":1}` are the same data but
  hash differently. Keys are sorted before hashing.
- **Volatile fields.** `updated_at` (and similar sync timestamps) are stripped
  before hashing. Vietful refreshes them on read, so including them would mark
  every product as changed on every poll and fill the change log with noise.

`change_type` is `CREATED` when the product id is unseen, `UPDATED` otherwise.

---

## 4. Exactly-once

Exactly-once *delivery* over a network is not achievable. What the system
guarantees is exactly-once **effect**:

> at-least-once delivery + idempotent writes = exactly-once effect

Nothing tries to deliver a message precisely once. Instead, replaying the same
input any number of times converges to the same database state.

### 4.1 Two layers of deduplication

| Layer | Mechanism | Purpose |
|---|---|---|
| Ingestion | `raw_events.idempotency_key UNIQUE` + `ON CONFLICT DO NOTHING` | rejects a duplicate *batch* at the door, saving work |
| Persistence | `product_changes UNIQUE (product_id, content_hash)` + `ON CONFLICT DO NOTHING` | rejects a duplicate *record*, guaranteeing correctness |

The outer layer is an optimisation; the inner layer is the correctness
guarantee. Even with a bug in application code, the database refuses to store a
duplicate change.

A worked example from testing: the same product posted twice to the webhook —
once with an `x-delivery-id` header and once without — produces two distinct
`raw_events` rows (different keys), but only one row in `product_changes`,
because the second one is caught by the content-hash constraint. This is exactly
why one layer is not enough.

### 4.2 Idempotency key per source

| Source | Key | Rationale |
|---|---|---|
| poll | `poll:sha256(batch payload)` | a timestamp key would always differ and be useless; hashing the batch means an unchanged catalogue produces no new work at all |
| webhook | `webhook:<x-delivery-id>`, falling back to `webhook:sha256(payload)` | real webhook senders retry with the same delivery id when they miss the response |
| excel | `excel:sha256(file bytes)` — *not implemented* | re-uploading the same file is the common operator mistake |

### 4.3 Transaction boundary

This is where exactly-once actually happens. Per event, inside **one**
transaction:

1. `SELECT ... FROM raw_events WHERE status='pending' FOR UPDATE SKIP LOCKED LIMIT 1`
2. for each product: insert into `product_changes`, upsert `products_current`
3. `UPDATE raw_events SET status='done'`

Either all three commit or none do. A crash between steps 2 and 3 leaves the
event `pending`, so it is reprocessed on restart — and the unique constraints
make reprocessing a no-op for rows already written. There is no state in which
the event is marked done but the data is missing.

`FOR UPDATE SKIP LOCKED` turns the table into a safe work queue: a second worker
skips rows another worker holds rather than blocking on them, so the design
scales to multiple workers without changes.

---

## 5. Failure handling

| Failure | Behaviour |
|---|---|
| CDMS process killed mid-processing | transaction rolls back, event stays `pending`, reprocessed on restart, no duplicates |
| Postgres down | pool errors are caught, the process survives, worker and collector retry each tick until the database returns |
| Vietful returns 5xx | poll fails and logs; the next scheduled run recovers; no partial batch is enqueued because the batch is assembled before insert |
| Overlapping cron runs | the collector holds a `running` flag and skips a tick if the previous one is still in flight |
| Duplicate webhook delivery | rejected by the idempotency key, returns `duplicate_ignored` |

### Measured results

All three scenarios are reproducible from `scripts/`; captured output is in `docs/`.

**CDMS killed mid-transaction** (`test-crash-recovery.sh`)
8000 products submitted via webhook, the process stopped 2 seconds into
processing. At the moment of the kill: 1 event still `pending`, **0 rows**
written for that batch despite partial work — the transaction rolled back
cleanly. After restart: **8000 rows, 0 duplicates**.

**Postgres stopped for 45 seconds** (`test-db-failure.sh`)
CDMS stayed up (`Up About a minute` while Postgres was down). The worker logged
a connection error every 2 seconds and resumed normal processing once the
database returned, with no manual intervention.

Note: in a Docker network a stopped container also disappears from DNS, so the
failure surfaces as `getaddrinfo ENOTFOUND postgres` rather than a refused
connection.

**Vietful returning 500 for 90 seconds** (`test-vietful-failure.sh`)
`product_changes` held steady at 500 rows throughout the outage — nothing lost,
nothing garbage-written. After recovery, 5 mutated products produced exactly 5
new change rows.

---

## 6. Schema

- `raw_events` — inbox. `status`, `attempts`, `last_error` for retry visibility.
  A partial index on `(status, id) WHERE status='pending'` keeps worker lookups
  fast even as the table grows large.
- `products_current` — one row per product; the hash baseline for comparison.
- `product_changes` — append-only change log; the actual deliverable of the
  service.
- `ingestion_cursor` — per-source watermark (created, not yet used; the
  content-hash batch key made a time cursor unnecessary for polling).

---

## 7. Scope: done vs not done

### Implemented
- Vietful emulator with faker-generated products, pagination, and control
  endpoints for mutating data and injecting failures
- Scheduled polling with overlap protection and batch-level deduplication
- Webhook ingestion with delivery-id idempotency, responding `202`
- Worker with content-hash change detection and single-transaction processing
- Two-layer deduplication as described above
- Postgres schema with the constraints that enforce correctness

### Not implemented
- **Excel upload.** The ingestion path is the same shape as the webhook: parse
  rows, write one `raw_events` row keyed on the file hash. The worker would not
  change. Dropped for time.
- **Deletion detection.** Polling only reveals what exists; a product removed
  upstream is invisible. Catching deletes requires comparing the full id set per
  poll, which conflicts with the incremental design. Noted as a known limitation.
- **Ordering guarantees for out-of-order webhooks.** If an older webhook arrives
  after a newer one, the older payload wins. A monotonic version field from
  Vietful would fix this.
- **Retry/dead-letter policy.** `attempts` and `last_error` exist but no backoff
  or DLQ is wired up.
- TODO: spike/concurrency test results

---

## 8. Lessons learned

TODO — write after Monday's failure testing. Candidates:
- why a timestamp is the wrong idempotency key and a content hash is the right one
- why volatile fields must be excluded before hashing
- what `SKIP LOCKED` buys over naive `SELECT ... LIMIT 1`
- the difference between exactly-once delivery and exactly-once effect

---

## 9. Notes

- `@faker-js/faker` is used instead of the Python `faker` named in the brief, to
  keep one language across the stack. Same library, same purpose.
- The emulator is plain Express rather than NestJS: it is test scaffolding, not
  part of the deliverable, and Express keeps it to ~80 lines.
- Raw SQL via `pg` is used deliberately instead of an ORM. The correctness of
  this service lives in `ON CONFLICT DO NOTHING` and `FOR UPDATE SKIP LOCKED`,
  and those are clearer written directly.
