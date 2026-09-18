---
name: create-proper-logging
description: Apply when writing or reviewing application logging in any language. Use when the user mentions logging, logs, structured logging, log levels, log level, correlation ID, request ID, log format, JSON logs, debug logs, error logging, log redaction, PII in logs, slog, structlog, pino, winston, SLF4J, logback, tracing crate, spdlog, or print debugging. Covers the language-agnostic rules — INFO as the default narrative level, structured key-value fields, logging at boundaries, request-scoped correlation IDs, error-logging discipline, and secret redaction. Per-language setup lives in references/ for Go, Python, TypeScript, Kotlin, Rust, C++, and Dart/Flutter. Skip for throwaway scripts with no production surface.
---

# Create Proper Logging

Logs exist so you can diagnose a bug in production without a debugger.

---

## 1. Purpose

**Do**
- Write each log line so a future reader can reconstruct what the app did and why
- Assume the reader has no source access, no debugger, and only the log stream
- Treat a bug report as the test: the INFO logs alone must explain what happened
- Log the decision, not only the outcome (`payment skipped, reason=already_settled`)

**Don't**
- Log for the author of the code; log for the on-call engineer at 03:00
- Ship a code path whose failure produces no log line
- Rely on reproducing the bug locally — production is the only place some bugs exist

```
# Bad — the reader learns nothing
ERROR something went wrong

# Good — the reader can act
ERROR order placement failed order_id=A-1839 user_id=u_77 step=charge cause="gateway timeout after 3 retries"
```

---

## 2. INFO Is the Default Level

INFO carries the app's narrative. A request's path through the system must be
reconstructable from INFO logs alone.

**Do**
- Log business-significant events at INFO: `order.placed`, `payment.failed`, `user.registered`
- Log key flow transitions at INFO: request received, use-case result, outbound call outcome
- Keep one INFO line per meaningful step, so the steps read as a story in order
- Pick the level by what the reader must do, not by how the author feels

| Level | Meaning | Reader action |
|---|---|---|
| `ERROR` | The operation failed and cannot proceed | Act now; the line is actionable |
| `WARN` | Degraded but recovered (retry, fallback, cache miss storm) | Watch for patterns |
| `INFO` | The default narrative; what the app did | Read to trace a request |
| `DEBUG` | Verbose internals: payload dumps, loop details | Off in production; gate by config |

**Don't**
- Hide the narrative at DEBUG and leave production with only errors
- Promote noise to INFO ("entering function X", "loop iteration 41")
- Enable DEBUG in production by default — turn it on per deployment through config
- Invent extra levels (`TRACE2`, `NOTICE`) that no aggregator query understands

```
# Bad — INFO says nothing happened between receive and failure
INFO request received path=/orders
ERROR order failed

# Good — INFO reconstructs the whole path
INFO request received path=/orders correlation_id=c9f1
INFO inventory reserved order_id=A-1839 items=3 correlation_id=c9f1
INFO payment charge sent gateway=stripe amount_cents=4200 correlation_id=c9f1
ERROR payment charge failed gateway=stripe cause="timeout" correlation_id=c9f1
```

---

## 3. Structured Logging

**Do**
- Emit key-value or JSON records, never concatenated strings — logs must be queryable
- Use one field name for one concept across the whole codebase (`user_id` everywhere)
- Pick one casing convention (`snake_case` is the safe default) and keep it
- Put the unit in the name when a number is ambiguous (`amount_cents`, `duration_ms`)
- Emit one event per line; each line answers one question
- Keep the message a stable, low-cardinality string; put the variables in fields

**Don't**
- Mix `userId`, `uid`, and `user` for the same value — queries then miss records
- Format values into the message text (`"user " + id + " failed"`)
- Spread one event across several lines (start line, detail line, end line)
- Dump whole request or response bodies into a field at INFO

```
# Bad — string concatenation; nothing is queryable
log("placed order for user " + userID + ", amount " + amount)

# Good — stable message, typed fields
log.info("order placed", user_id=userID, order_id=orderID, amount_cents=amount)
```

---

## 4. Log at Boundaries

**Do**
- Log the inbound request when it arrives, and its result when it leaves
- Log every outbound call outcome: database, HTTP client, queue publish, cache
- Log the use-case or handler result once, with the decision that produced it
- Replace loop logging with one summary line at the boundary (`items_processed=812 failed=3`)
- Keep the domain core free of logger imports; log in adapters and middleware

**Don't**
- Log "entering function X" / "exiting function X" — that is a stack trace, not a log
- Log inside a tight loop: n items must not produce n lines
- Instrument every helper function; instrument units of work
- Let the domain layer depend on a logging library to stay testable and pure

```
# Bad — one line per item floods the stream
for item in items:
    log.info("processing item", item_id=item.id)

# Good — one summary line at the boundary
log.info("batch processed", batch_id=batch.id, total=len(items), failed=failed_count)
```

---

## 5. Context and Correlation

**Do**
- Bind a request-scoped `correlation_id` (or `trace_id` / `request_id`) at the inbound boundary
- Attach that ID to every line emitted during the request lifetime
- Reuse the incoming ID from the upstream header when present; generate one only if absent
- Include the domain IDs a future search needs: `order_id`, `user_id`, `tenant_id`
- Propagate the ID to downstream calls through a header, and into async messages through metadata
- Carry the ID in the language's request-scoped mechanism, not a global variable

**Don't**
- Regenerate the ID mid-flight — the trail then breaks at that exact line
- Store the ID in a package-level or thread-global variable shared across requests
- Pass the ID as an explicit argument to every function; bind it into a child logger instead
- Drop propagation on async paths (queues, jobs); the consumer must inherit the ID

```
# Bad — new ID per layer; nothing joins up
handler: correlation_id=c9f1 "request received"
service: correlation_id=7ab2 "charging payment"

# Good — one ID for the whole lifetime, including the downstream service
handler:  correlation_id=c9f1 "request received"
service:  correlation_id=c9f1 "charging payment"
payments: correlation_id=c9f1 "charge accepted"
```

---

## 6. Error Logging Discipline

**Do**
- Log an error once, at the boundary that handles it, with the full context
- Attach the underlying cause and the stack trace or error chain
- Return or wrap the error at lower layers; add context there instead of logging
- Include the inputs needed to reproduce: IDs, the step name, the retry count
- Log an expected, handled condition at WARN or INFO — not every failure is an ERROR

**Don't**
- Log-and-rethrow at every layer: one failure then produces five near-identical lines
- Swallow an error with an empty catch block and no log line
- Log only `err.message` and drop the cause chain
- Use ERROR for validation failures the caller caused; those are INFO or WARN

```
# Bad — logged three times on the way up
repo:    log.error("db insert failed", err); throw err
service: log.error("could not save order", err); throw err
handler: log.error("request failed", err)

# Good — wrap below, log once at the top
repo:    throw wrap(err, "insert order")
service: throw wrap(err, "place order A-1839")
handler: log.error("order placement failed", order_id=id, correlation_id=cid, error=err)
```

---

## 7. Never Log Secrets or PII

**Do**
- Redact at the logger boundary with a formatter, processor, or serializer hook
- Keep a central deny-list of field names: `password`, `token`, `authorization`, `secret`, `card_number`, `ssn`, `email`
- Log a stable surrogate instead of the value: `user_id` instead of the email address
- Mask when the shape matters: `card_last4=4242`, `token_prefix=sk_live_…`
- Review new log fields for personal data before merge

**Don't**
- Redact by hand at each call site — one missed site leaks forever
- Log whole request headers, cookies, or auth payloads
- Log full request bodies "temporarily" for debugging in production
- Assume DEBUG is safe; DEBUG output still reaches disk and log aggregators

```
# Bad — credentials and PII in the stream
log.info("login attempt email=" + user.email + " password=" + password)

# Good — surrogate identity, no secret
log.info("user authenticated", user_id=user.id, method="password")
```

---

## 8. Per-Language Setup

| Language | Reference | Recommended library |
|---|---|---|
| Go | [references/golang.md](references/golang.md) | `log/slog` (stdlib) |
| Python | [references/python.md](references/python.md) | stdlib `logging` + `structlog` for JSON |
| TypeScript | [references/typescript.md](references/typescript.md) | `pino` (Node backends) |
| Kotlin | [references/kotlin.md](references/kotlin.md) | SLF4J + Logback + `kotlin-logging` |
| Rust | [references/rust.md](references/rust.md) | `tracing` + `tracing-subscriber` |
| C++ | [references/cpp.md](references/cpp.md) | `spdlog` |
| Dart/Flutter | [references/dart-flutter.md](references/dart-flutter.md) | `logger` or the `logging` package |

Each reference gives the minimal JSON setup, INFO as the default level, DEBUG
through config, the idiomatic way to attach a correlation ID, and a Bad/Good pair.
