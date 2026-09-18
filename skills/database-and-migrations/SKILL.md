---
name: database-and-migrations
description: Apply when designing schemas, writing migrations, tuning queries, or reviewing the persistence layer of a Go/DDD/hexagonal backend. Use when the user mentions database design, schema, migrations, indexes, query performance, N+1, pagination, transactions, locking, deadlock, concurrency, optimistic locking, pessimistic locking, zero-downtime migration, expand-contract, ALTER TABLE, EXPLAIN, keyset pagination, soft delete, audit columns, money/decimal storage, UUID vs bigint, surrogate keys, foreign keys, constraints, backfill, or repository mapping. Skip for trivial CRUD scaffolding where there is no real schema decision to make.
---

# Database & Migrations

The database is the last line of defense for data integrity — constraints enforce what domain code merely promises.

---

## 1. Schema Design

**Do**
- Use surrogate keys (UUID v7 or `bigserial`) as PKs; reserve natural keys for UNIQUE constraints
- Prefer `uuid` (v7, time-sortable) for distributed IDs; `bigserial` for high-volume append-only tables where sort order and join cost matter
- Enforce `NOT NULL` aggressively — nullable means "absent is valid"; state that intent
- Express invariants as constraints: `UNIQUE`, `CHECK`, `FK` — they hold even when application code is wrong
- Store money as `NUMERIC(19,4)` or integer cents; never `float` or `double precision`
- All timestamps as `TIMESTAMPTZ`; store and compare in UTC; display only in local time
- Use lookup tables (not DB enums) for values that change at runtime; use `CHECK` constraints for closed sets that never change in production

**Don't**
- Float money (`REAL`, `FLOAT8`) — rounding error is a financial bug
- Nullable columns as a proxy for state; prefer a separate status column with a `CHECK` constraint
- DB-level enums for values business teams add without a deploy (`ALTER TYPE` is painful in Postgres)
- Polymorphic FK columns (`entity_id` + `entity_type`) — destroys referential integrity; use separate FK columns or separate join tables

```sql
-- Bad: floats lose cents, nullable status is ambiguous
CREATE TABLE orders (
    id         UUID PRIMARY KEY,
    total      FLOAT,
    shipped_at TIMESTAMP
);

-- Good: exact decimal, explicit status, timezone-aware
CREATE TABLE orders (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    total_cents NUMERIC(19,4) NOT NULL CHECK (total_cents >= 0),
    status      TEXT        NOT NULL CHECK (status IN ('pending','confirmed','shipped','cancelled')),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    shipped_at  TIMESTAMPTZ
);
```

---

## 2. Indexing

**Do**
- Index every FK column — Postgres does not do this automatically; missing FK indexes cause sequential scans on cascade operations
- Put the highest-cardinality, most-selective column first in a composite index when filtering by equality on multiple columns
- Put the range/sort column last in a composite index used for range scans or `ORDER BY`
- Use partial indexes for sparse queries (`WHERE deleted_at IS NULL`, `WHERE status = 'pending'`)
- Use covering indexes (`INCLUDE`) to satisfy a query from the index alone, avoiding heap fetches

**Don't**
- Index every column speculatively — each index is a write-time cost (insert, update, delete all update the index)
- Create indexes on low-cardinality columns alone (`status` with three values)
- Forget that `LIKE 'prefix%'` is sargable but `LIKE '%suffix'` is not — the latter ignores the B-tree

```sql
-- Composite: equality on status first, range on created_at last
CREATE INDEX idx_orders_status_created
    ON orders (status, created_at DESC)
    WHERE deleted_at IS NULL;

-- Covering: avoids heap fetch for the common list query
CREATE INDEX idx_orders_customer_covering
    ON orders (customer_id, created_at DESC)
    INCLUDE (status, total_cents);
```

---

## 3. Query Performance

**Do**
- Run `EXPLAIN (ANALYZE, BUFFERS)` before declaring a query fast enough; look for `Seq Scan` on large tables and `Nested Loop` with large row estimates
- Use keyset (seek) pagination over `OFFSET` — `OFFSET N` scans and discards N rows; keyset uses an index seek
- Batch repository calls; never loop and query inside a loop (N+1)
- Use `SELECT col1, col2` not `SELECT *` — avoids pulling wide rows and breaks when columns are added
- Write sargable predicates: keep the indexed column bare on the left side of the comparison; don't wrap it in a function

**Don't**
- `OFFSET` for deep pages — page 500 of 20 = 10 000 rows scanned and thrown away
- `WHERE lower(email) = $1` without a matching functional index (`CREATE INDEX ON users (lower(email))`)
- Load a full aggregate in a repository loop to process one field — load only what the use case needs

```go
// N+1 — one query per order
for _, id := range orderIDs {
    o, _ := repo.FindByID(ctx, id)
    process(o)
}

// Batch — one query
orders, _ := repo.FindByIDs(ctx, orderIDs)
for _, o := range orders {
    process(o)
}
```

```sql
-- Offset pagination (bad at depth)
SELECT * FROM orders ORDER BY created_at DESC LIMIT 20 OFFSET 10000;

-- Keyset pagination (always fast)
SELECT * FROM orders
WHERE (created_at, id) < ($last_created_at, $last_id)
ORDER BY created_at DESC, id DESC
LIMIT 20;
```

---

## 4. Migrations

**Do**
- Forward-only: never edit a shipped migration; fix forward with a new migration
- Use expand-contract for zero-downtime schema changes: (1) add nullable column, (2) dual-write in app code, (3) backfill old rows, (4) add `NOT NULL` constraint, (5) drop old column in a later deploy
- Separate schema DDL migrations from data backfill migrations — backfills can be long-running and should be retryable
- Create indexes `CONCURRENTLY` in Postgres to avoid locking the table during index build
- Add `NOT NULL DEFAULT` columns in two steps on large tables: add nullable, backfill, then `SET NOT NULL` (Postgres 12+ can use a check constraint to skip a full table scan)
- Version migrations sequentially and commit them with the feature they support

**Don't**
- `ALTER TABLE ... ADD COLUMN col TEXT NOT NULL DEFAULT 'x'` on a large table in one step — in Postgres <11 this rewrites the whole table; in PG11+ the default is stored in catalog but `SET NOT NULL` still does a full scan
- Edit or delete a migration that has run in any non-local environment
- Run a long backfill inside the same transaction as the schema change — it holds the lock for the full duration
- Create an index without `CONCURRENTLY` on a live table

```sql
-- Step 1: expand — add nullable
ALTER TABLE orders ADD COLUMN confirmed_at TIMESTAMPTZ;

-- Step 2: backfill (separate migration or script, outside the schema txn)
UPDATE orders SET confirmed_at = created_at WHERE status = 'confirmed' AND confirmed_at IS NULL;

-- Step 3: enforce — now safe because all rows have the value
ALTER TABLE orders ALTER COLUMN confirmed_at SET NOT NULL;

-- Index without table lock
CREATE INDEX CONCURRENTLY idx_orders_confirmed_at ON orders (confirmed_at);
```

```go
// Repository migration ordering: schema change deploy → backfill job → constraint deploy
// Never bundle all three into one migration file
```

---

## 5. Transactions & Concurrency

**Do**
- Choose the lowest isolation level that prevents the anomalies your use case cannot tolerate:
  - `READ COMMITTED` (Postgres default): prevents dirty reads; allows non-repeatable reads and phantoms
  - `REPEATABLE READ`: prevents non-repeatable reads; Postgres serialization also prevents most phantoms
  - `SERIALIZABLE`: full isolation; use for financial transfers or anything where "total" must be exact
- Optimistic locking (version column): read, increment `version`, `UPDATE ... WHERE id=$1 AND version=$2`; retry on 0 rows updated
- Pessimistic locking: `SELECT ... FOR UPDATE`; use `SKIP LOCKED` for queue/worker patterns
- Keep transactions short — hold locks for the minimum time; do not call external services inside a transaction

**Don't**
- Call HTTP/gRPC endpoints, send emails, or enqueue messages inside a database transaction — the external call may succeed before the DB rolls back
- Hold a transaction open while waiting on user input or a slow computation
- Assume `READ COMMITTED` prevents phantom reads — it does not; use `REPEATABLE READ` or `SERIALIZABLE` when you scan a range and act on the count
- Acquire locks in inconsistent order across transactions — always lock in the same deterministic order (e.g., lower ID first) to prevent deadlocks

```go
// Optimistic locking in a Go repository
func (r *OrderRepo) Update(ctx context.Context, o *order.Order) error {
    res, err := r.db.ExecContext(ctx,
        `UPDATE orders SET status=$1, version=version+1 WHERE id=$2 AND version=$3`,
        o.Status(), o.ID(), o.Version(),
    )
    if err != nil {
        return err
    }
    if n, _ := res.RowsAffected(); n == 0 {
        return order.ErrConcurrentModification
    }
    return nil
}
```

---

## 6. Data Integrity & the Domain Boundary

**Do**
- Duplicate invariants at both the domain layer (value objects, entity methods) and the DB layer (constraints) — the DB constraint catches what bypasses the application (migrations, direct SQL, bugs)
- Keep the DB schema as an implementation detail of the repository; map explicitly between DB rows and domain types in the secondary adapter
- Use audit columns (`created_at`, `updated_at`, `created_by`) on every table that represents a business entity
- Prefer hard delete; use soft delete only when the deleted record has legal, audit, or referential meaning — never soft-delete to avoid cascading deletes you should fix
- When soft-deleting, add `deleted_at TIMESTAMPTZ` and partial indexes that filter `WHERE deleted_at IS NULL`; redefine unique constraints as partial to exclude deleted rows

**Don't**
- Let the DB schema drive the domain model — `ORDER BY created_at` in a repository call should not dictate the sort semantics of the aggregate
- Expose ORM model structs (`gorm.Model`, `ent.Schema`) as domain entities — they carry infrastructure concerns (tags, hooks, lazy-load) into the domain
- Scatter integrity checks across service methods and trust no DB constraint will catch the violation
- Soft-delete as a performance hack or fear of `ON DELETE CASCADE`

```go
// Bad — ORM entity leaks into domain
type Order struct {
    gorm.Model
    Status string
    Total  float64
}

// Good — domain entity is plain Go; repository owns the mapping
// internal/domain/order/order.go
type Order struct {
    id        ID
    status    Status
    totalCents int64
    version   int
}

// internal/adapter/secondary/postgres/order_repo.go
type orderRow struct {
    ID         uuid.UUID `db:"id"`
    Status     string    `db:"status"`
    TotalCents int64     `db:"total_cents"`
    Version    int       `db:"version"`
}

func toDomain(r orderRow) (*order.Order, error) {
    return order.Reconstitute(r.ID, r.Status, r.TotalCents, r.Version)
}
```
