---
name: api-contract-design
description: Apply when designing, reviewing, or evolving API contracts at the inbound adapter / interface layer of a Go/hexagonal backend. Use when the user mentions REST, gRPC, OpenAPI, proto, endpoint design, URL design, HTTP methods, status codes, request/response contracts, DTO boundary, error responses, error model, pagination, cursor pagination, keyset pagination, filtering, sorting, API versioning, URL versioning, header versioning, backward compatibility, breaking changes, deprecation, sunset header, idempotency, idempotency key, ETag, If-Match, optimistic concurrency, rate limiting, correlation ID, request ID, contract-first, or OpenAPI spec. Skip for pure business-logic changes, domain modeling, or infrastructure plumbing with no HTTP/gRPC surface.
---

# API Contract Design

The contract is the product — design it for the consumer, version it like you mean it, and enforce the boundary at the adapter layer so the domain never leaks out.

---

## 1. Resource & URL Design (REST)

**Do**
- Use nouns, plural collections: `/orders`, `/orders/{id}/items`
- Map actions to HTTP semantics: `GET` read (safe, idempotent), `POST` create/command, `PUT` full replace (idempotent), `PATCH` partial update, `DELETE` remove
- Use sub-resources for owned relationships: `GET /users/{id}/addresses`
- Status codes with intent: `201 Created` + `Location` header on POST, `202 Accepted` for async, `204 No Content` on DELETE/PATCH with no body, `409 Conflict` for state conflicts, `422 Unprocessable Entity` for semantic validation failure

**Don't**
- Verbs in paths: `/createOrder`, `/getUser`, `/processPayment`
- Overload `POST` for everything because it's easy
- Use `200 OK` when the resource was created
- Use `400 Bad Request` for domain/business rule violations — that's `409` or `422`

```http
# Bad
POST /api/createOrder
POST /api/getOrderById
GET  /api/orders/cancel?id=123

# Good
POST   /orders
GET    /orders/{id}
DELETE /orders/{id}
POST   /orders/{id}/cancellations
```

---

## 2. Request/Response Contracts & DTO Boundary

**Do**
- Define explicit request/response structs in the adapter layer — never expose domain entities directly
- Consistent field naming: `snake_case` in JSON throughout (pick one, enforce it)
- Timestamps as RFC3339 UTC strings: `"created_at": "2024-01-15T09:00:00Z"`
- Enums as strings, not integers: `"status": "pending"` not `"status": 1`
- Make optional fields nullable or omit them; document which fields are required
- Keep the DTO as the Anti-Corruption Layer — map domain → DTO at the boundary, not in the domain

**Don't**
- Embed domain structs in HTTP response structs via embedding or type alias
- Return different shapes for the same resource in different endpoints
- Mix `camelCase` and `snake_case` in the same API
- Expose internal IDs, sequence numbers, or storage artefacts (e.g. `row_id`) as primary identifiers

```go
// Bad — domain entity bleeds into response
func (h *OrderHandler) Get(w http.ResponseWriter, r *http.Request) {
    order, _ := h.repo.Find(r.Context(), id)
    json.NewEncoder(w).Encode(order) // domain.Order exposed directly
}

// Good — explicit DTO at the boundary
type OrderResponse struct {
    ID        string `json:"id"`
    Status    string `json:"status"`
    Total     string `json:"total"`
    CreatedAt string `json:"created_at"`
}

func toOrderResponse(o *domain.Order) OrderResponse {
    return OrderResponse{
        ID:        o.ID().String(),
        Status:    o.Status().String(),
        Total:     o.Total().Format(),
        CreatedAt: o.CreatedAt().UTC().Format(time.RFC3339),
    }
}
```

---

## 3. Error Model

**Do**
- One consistent error envelope for every error response (problem+json style)
- Machine-readable `code` field + human-readable `message` + optional `details` array for field-level errors
- Map domain errors → transport errors at the adapter; the adapter owns this translation
- Use `details` for validation failures so clients can target fields

**Don't**
- Return different error shapes from different endpoints
- Leak stack traces, internal error messages, SQL errors, or domain internals in responses
- Use HTTP status as the only error signal — `400` with no body is useless to clients
- Put sensitive data (emails, IDs that expose counts) in error messages

```json
// Bad
{ "error": "pq: duplicate key value violates unique constraint \"users_email_key\"" }

// Good — problem+json style
{
  "code": "validation_error",
  "message": "Request validation failed.",
  "details": [
    { "field": "email", "code": "already_exists", "message": "Email is already registered." }
  ]
}
```

```go
// Adapter boundary: domain error → HTTP error
func mapDomainError(err error) (int, ErrorResponse) {
    var notFound *domain.NotFoundError
    var conflict *domain.ConflictError
    switch {
    case errors.As(err, &notFound):
        return http.StatusNotFound, ErrorResponse{Code: "not_found", Message: err.Error()}
    case errors.As(err, &conflict):
        return http.StatusConflict, ErrorResponse{Code: "conflict", Message: err.Error()}
    default:
        return http.StatusInternalServerError, ErrorResponse{Code: "internal_error", Message: "An unexpected error occurred."}
    }
}
```

---

## 4. Versioning & Evolution

**Do**
- Default to URL versioning (`/v1/`, `/v2/`) — visible in logs, bookmarkable, cache-friendly
- Only additive changes in the same version: new optional fields, new endpoints, new enum values
- Use `Sunset` and `Deprecation` response headers on deprecated endpoints
- Remove a field in a new major version only; never repurpose a field's meaning in place

**Don't**
- Change the type, meaning, or required-ness of an existing field in a non-major version
- Remove fields from responses without a deprecation period
- Use header versioning (`Accept: application/vnd.myapi.v2+json`) unless you have a strong reason — it's invisible in logs and harder to test
- Add breaking changes silently hoping clients don't notice

```http
# Deprecation headers on response
Deprecation: true
Sunset: Sat, 01 Jan 2026 00:00:00 GMT
Link: <https://api.example.com/v2/orders>; rel="successor-version"
```

**Breaking vs additive:**
| Change | Safe? |
|---|---|
| Add optional response field | Yes |
| Add optional request field | Yes |
| Add new endpoint | Yes |
| Remove response field | No |
| Rename field | No |
| Change field type | No |
| Change enum values meaning | No |
| Make optional field required | No |

---

## 5. Pagination, Filtering & Sorting

**Do**
- Cursor/keyset pagination by default for any collection that will grow; offset only for small, stable sets
- Consistent param names: `limit`, `cursor` (or `after`/`before`), `sort`, `filter` (or field-specific)
- Return `next_cursor` (null when exhausted) and `has_more` bool — skip total count unless explicitly needed (it's expensive)
- Default page size (e.g. 20) and document max page size (e.g. 100); clamp silently, don't error

**Don't**
- Use `page`+`offset` for high-volume collections — it's unstable and gets slower at depth
- Return inconsistent field names: `nextPage`, `next_page_token`, `cursor` mixed across endpoints
- Leak DB sort column names in sort params (`sort=created_at DESC` → expose `sort=newest`)

```json
// Response envelope — cursor pagination
{
  "data": [...],
  "pagination": {
    "next_cursor": "eyJpZCI6MTIzfQ==",
    "has_more": true,
    "limit": 20
  }
}
```

```http
# Request
GET /orders?limit=20&cursor=eyJpZCI6MTIzfQ==&sort=newest&status=pending
```

---

## 6. Idempotency, Concurrency & Reliability

**Do**
- Require `Idempotency-Key` header on state-mutating POST endpoints (payments, orders, commands)
- Store idempotency keys with TTL; return the cached response on replay
- Use ETags for resource versioning; require `If-Match` on destructive updates to prevent lost updates
- Include `X-Request-ID` / `X-Correlation-ID` on every response; generate one if the client didn't send it
- Document rate-limit headers: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`; return `429` with `Retry-After`

**Don't**
- Accept non-idempotent POSTs without an idempotency mechanism for critical commands
- Allow blind overwrites on concurrent edits — optimistic locking at the boundary prevents data loss
- Swallow or hide the correlation ID — thread it through context and all downstream calls

```http
# Idempotent POST
POST /payments
Idempotency-Key: 550e8400-e29b-41d4-a716-446655440000
Content-Type: application/json

# Optimistic concurrency — update only if version matches
PUT /orders/123
If-Match: "abc123etag"
```

```go
// ETag check at adapter boundary
func (h *OrderHandler) Update(w http.ResponseWriter, r *http.Request) {
    ifMatch := r.Header.Get("If-Match")
    order, err := h.queries.FindOrder(r.Context(), id)
    if err != nil { /* ... */ }
    if ifMatch != "" && ifMatch != order.ETag() {
        http.Error(w, "precondition failed", http.StatusPreconditionFailed)
        return
    }
    // proceed with update
}
```

---

## 7. gRPC / Proto Notes

**Do**
- Assign field numbers once and never reuse them — ever
- Mark fields `optional` (proto3 explicit optional) when absence is meaningful vs zero-value
- Use `google.rpc.Status` + `google.rpc.ErrorInfo`/`BadRequest` details for structured errors
- Keep RPCs additive: new fields, new RPCs are safe; removing or renaming breaks clients
- Use gRPC when: internal service-to-service, streaming required, strong typing critical, latency matters

**Don't**
- Reuse a removed field number (`reserved` it instead)
- Return bare `Status.INVALID_ARGUMENT` with no details — attach `BadRequest.FieldViolation`
- Use gRPC for public-facing APIs without a transcoding layer (REST gateway) unless clients control the toolchain

```proto
// Bad — field 3 reused after deletion
message Order {
  string id = 1;
  string status = 2;
  // string old_field = 3; deleted
  string customer_id = 3; // NEVER reuse field 3
}

// Good
message Order {
  string id = 1;
  string status = 2;
  reserved 3;
  reserved "old_field";
  string customer_id = 4;
}
```

---

## 8. Contract-First & Docs

**Do**
- Write the OpenAPI spec (or `.proto`) first — it is the source of truth
- Generate server stubs, client SDKs, and validation from the spec; don't hand-write what can be generated
- Validate incoming requests against the schema at the adapter boundary before the request reaches the application layer
- Include at least one working example per endpoint/message in the spec

**Don't**
- Generate the spec from the implementation (spec-from-code annotation drift is silent and common)
- Maintain a separate wiki/Confluence page as the authoritative contract — it will lag
- Skip examples: an endpoint with no example is a guess for API consumers

```go
// Validate at adapter boundary using generated validators
func (h *OrderHandler) Create(w http.ResponseWriter, r *http.Request) {
    var req CreateOrderRequest
    if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
        writeError(w, http.StatusBadRequest, "invalid_json", "Request body is not valid JSON.")
        return
    }
    if errs := req.Validate(); len(errs) > 0 {
        writeValidationError(w, errs) // 422 with field-level details
        return
    }
    // hand off to application layer
}
```
