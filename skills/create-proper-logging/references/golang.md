# Logging in Go

**Library:** `log/slog` (stdlib since Go 1.21). It is structured by design, needs
no dependency, and every handler (text, JSON, third-party) implements one interface.
Use `slog` for new code; wrap legacy `log` output with `slog.NewLogLogger` when
you migrate.

---

## Setup

**Do**
- Build one `*slog.Logger` in `main.go` and inject it; set it as default for library code
- Emit JSON in production and text locally, chosen by config
- Default to `INFO`; raise to `DEBUG` through an env var
- Use a `slog.LevelVar` so the level can change at runtime without a restart

```go
package main

import (
	"log/slog"
	"os"
)

func newLogger() *slog.Logger {
	var level slog.LevelVar // defaults to LevelInfo
	if os.Getenv("LOG_LEVEL") == "debug" {
		level.Set(slog.LevelDebug)
	}

	handler := slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: &level})
	logger := slog.New(handler).With(
		slog.String("service", "order-api"),
		slog.String("version", buildVersion),
	)
	slog.SetDefault(logger)
	return logger
}
```

**Don't**
- Call `log.Printf` or `fmt.Println` anywhere in application code
- Create a logger per request; derive a child logger instead

---

## Correlation ID

Go's request scope is `context.Context`. Put the logger (already carrying the ID)
into the context at the inbound boundary, then read it back with a helper.

```go
type ctxKey struct{}

func WithLogger(ctx context.Context, l *slog.Logger) context.Context {
	return context.WithValue(ctx, ctxKey{}, l)
}

func From(ctx context.Context) *slog.Logger {
	if l, ok := ctx.Value(ctxKey{}).(*slog.Logger); ok {
		return l
	}
	return slog.Default()
}

// Middleware binds the ID once, at the true inbound boundary.
func Correlate(base *slog.Logger, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id := r.Header.Get("X-Correlation-ID")
		if id == "" {
			id = uuid.NewString()
		}
		l := base.With(slog.String("correlation_id", id))
		l.InfoContext(r.Context(), "request received",
			slog.String("method", r.Method),
			slog.String("path", r.URL.Path),
		)
		next.ServeHTTP(w, r.WithContext(WithLogger(r.Context(), l)))
	})
}
```

An alternative is a custom `slog.Handler` whose `Handle` reads the ID from the
context and appends it. Use it when you cannot thread a child logger everywhere.

---

## Bad / Good

```go
// Bad — concatenated message, no correlation, wrong level for a handled error
log.Printf("placed order for user %s amount %d", userID, amountCents)
log.Printf("ERROR: %v", err)

// Good — structured fields, context-aware, cause attached
From(ctx).Info("order placed",
	slog.String("order_id", orderID),
	slog.String("user_id", userID),
	slog.Int("amount_cents", amountCents),
)
From(ctx).Error("order placement failed",
	slog.String("order_id", orderID),
	slog.Any("error", err), // slog renders the wrapped chain
)
```

---

## Level notes

- `slog` levels are integers: `Debug=-4`, `Info=0`, `Warn=4`, `Error=8`.
- There is no `Fatal` or `Panic`. Log at `Error`, then `os.Exit(1)` in `main` only.
- Always use the `...Context` variants (`InfoContext`, `ErrorContext`) so
  context-aware handlers can enrich the record.

**Don't**
- Use `slog.Any` for a value with a costly `String()` on a hot path — it is
  evaluated even when the level is disabled unless you guard with `logger.Enabled`
- Put a `*slog.Logger` field on domain structs; keep the domain free of the import
