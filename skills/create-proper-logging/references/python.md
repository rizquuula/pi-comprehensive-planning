# Logging in Python

**Library:** stdlib `logging` for the transport, plus `structlog` for structured
JSON records. `logging` owns handlers, levels, and third-party library output.
`structlog` gives an ergonomic key-value API and a processor pipeline for
redaction and context injection. Configure `structlog` to render through
`logging` so library logs and your logs land in one stream.

---

## Setup

**Do**
- Configure once at process start (`main`, app factory, or `settings` module)
- Default to `INFO`; read `LOG_LEVEL` from the environment for `DEBUG`
- Get a module logger with `structlog.get_logger(__name__)`
- Render JSON in production, a console renderer locally

```python
import logging
import os
import structlog

def configure_logging() -> None:
    level = getattr(logging, os.getenv("LOG_LEVEL", "INFO").upper(), logging.INFO)
    logging.basicConfig(format="%(message)s", stream=sys.stdout, level=level)

    structlog.configure(
        processors=[
            structlog.contextvars.merge_contextvars,   # correlation id lands here
            structlog.processors.add_log_level,
            structlog.processors.TimeStamper(fmt="iso", utc=True),
            redact_secrets,                            # see below
            structlog.processors.format_exc_info,
            structlog.processors.JSONRenderer(),
        ],
        wrapper_class=structlog.make_filtering_bound_logger(level),
        logger_factory=structlog.stdlib.LoggerFactory(),
        cache_logger_on_first_use=True,
    )

DENY = {"password", "token", "authorization", "secret", "card_number", "email"}

def redact_secrets(_logger, _name, event_dict):
    for key in event_dict:
        if key.lower() in DENY:
            event_dict[key] = "[redacted]"
    return event_dict
```

**Don't**
- Call `print()` in application code
- Use the root logger directly (`logging.info(...)`) — it hides the source module
- Configure logging at import time in a library; only applications configure

---

## Correlation ID

`contextvars` is the request scope. It works for threads and for `asyncio` tasks.
`structlog.contextvars` binds values that every later log call inherits.

```python
import uuid
import structlog

async def correlation_middleware(request, call_next):
    structlog.contextvars.clear_contextvars()
    cid = request.headers.get("x-correlation-id") or str(uuid.uuid4())
    structlog.contextvars.bind_contextvars(correlation_id=cid)

    log = structlog.get_logger(__name__)
    log.info("request received", method=request.method, path=request.url.path)
    response = await call_next(request)
    log.info("request completed", status_code=response.status_code)
    response.headers["x-correlation-id"] = cid
    return response
```

Call `clear_contextvars()` at the start of each request. Without it, a recycled
worker leaks the previous request's ID.

---

## Bad / Good

```python
# Bad — f-string message, PII, error logged without the traceback
logging.info(f"order for {user.email} amount {amount}")
logging.error(f"failed: {exc}")

# Good — structured fields, surrogate identity, traceback captured
log = structlog.get_logger(__name__)
log.info("order placed", order_id=order.id, user_id=user.id, amount_cents=amount)
log.exception("order placement failed", order_id=order.id)  # ERROR + traceback
```

Inside an `except` block use `log.exception(...)` (or `logger.error(..., exc_info=True)`).
It records the traceback; `log.error(str(exc))` throws it away.

---

## Level notes

- Levels: `DEBUG=10`, `INFO=20`, `WARNING=30`, `ERROR=40`, `CRITICAL=50`.
  The name is `WARNING`, not `WARN` (the alias exists but is deprecated).
- `make_filtering_bound_logger(level)` drops records before the processors run —
  it is much cheaper than filtering at the handler.
- Silence chatty dependencies explicitly:
  `logging.getLogger("urllib3").setLevel(logging.WARNING)`.
- With `uvicorn` or `gunicorn`, pass `log_config=None` and configure yourself,
  otherwise the server rewrites your handlers.

**Don't**
- Build the message string yourself when using stdlib `logging` — use
  `logger.info("order placed %s", order_id)` so formatting is lazy
- Add a `logging.FileHandler` in a containerised service; write to stdout
- Log inside `__del__` or during interpreter shutdown; handlers may already be closed
