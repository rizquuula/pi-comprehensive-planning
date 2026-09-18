# Logging in Rust

**Library:** `tracing` for the API and `tracing-subscriber` for output. It records
structured events with typed fields, and spans give you request scope without
thread-locals of your own. Bridge the older `log` crate with `tracing-log` so
dependency output joins your stream.

---

## Setup

**Do**
- Initialise the subscriber once, at the top of `main`
- Default to `info`; let `RUST_LOG` override it
- Emit the JSON layer in production and the pretty layer in development
- Add `.with_current_span(true)` so span fields land on every event

Dependencies: `tracing`, and `tracing-subscriber` with the `env-filter` and
`json` features.

```rust
use tracing_subscriber::{fmt, prelude::*, EnvFilter};

fn init_logging() {
    let filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new("info"));

    let json_layer = fmt::layer()
        .json()
        .flatten_event(true)
        .with_current_span(true)
        .with_span_list(false);

    tracing_subscriber::registry()
        .with(filter)
        .with(json_layer)
        .init();
}
```

`RUST_LOG=info,my_app::payments=debug` raises one module without flooding the rest.

**Don't**
- Use `println!` or `eprintln!` for diagnostics
- Call `init()` twice; the second call panics or is silently ignored

---

## Correlation ID

A span is the request scope. Enter it at the inbound boundary and every event
inside inherits its fields, across `await` points too.

```rust
use tracing::{info, info_span, Instrument};
use uuid::Uuid;

async fn handle(req: Request) -> Response {
    let correlation_id = req
        .headers()
        .get("x-correlation-id")
        .and_then(|v| v.to_str().ok())
        .map(str::to_owned)
        .unwrap_or_else(|| Uuid::new_v4().to_string());

    let span = info_span!("http_request", %correlation_id, method = %req.method());

    async move {
        info!("request received");
        let response = place_order(req).await;
        info!(status = response.status().as_u16(), "request completed");
        response
    }
    .instrument(span)
    .await
}
```

For synchronous code use `let _guard = span.enter();`. Never hold that guard
across an `.await` — the span then leaks into whatever task the executor runs next.

`#[tracing::instrument]` creates a span per call. Use it at boundaries only, and
add `skip_all` so arguments do not become fields by accident:

```rust
#[tracing::instrument(skip_all, fields(order_id = %order.id))]
async fn place_order(order: Order) -> Result<(), PlaceError> { /* ... */ }
```

---

## Bad / Good

```rust
// Bad — formatted message, nothing queryable, error flattened to a string
info!("placed order for user {} amount {}", user_id, amount_cents);
error!("failed: {}", err);

// Good — typed fields, error recorded with its source chain
info!(order_id = %order.id, user_id = %user_id, amount_cents, "order placed");
error!(order_id = %order.id, error = ?err, "order placement failed");
```

Field sigils: `%value` uses `Display`, `?value` uses `Debug`, a bare name binds
the variable directly. Use `error = ?err` so the `source()` chain is kept.

---

## Level notes

- `tracing` levels: `TRACE`, `DEBUG`, `INFO`, `WARN`, `ERROR`. There is no `FATAL`.
  `TRACE` sits below `DEBUG` and is the noisiest; production filters it out.
- `EnvFilter` syntax matches `log`: `RUST_LOG=warn` shows `WARN` and `ERROR` only.
- Set the `release_max_level_info` feature to compile `debug!` and `trace!` out
  of release builds entirely.
- In libraries, emit events but never install a subscriber; that is the binary's job.

**Don't**
- Put a whole struct into a field with `?` on a hot path; `Debug` formatting is not free
- Log an error at every `?` propagation site; log once where it is handled
