---
name: golang-best-practices
description: Apply when writing, reviewing, or planning Go code (.go files). Covers idiomatic Go (composition, consumer-defined interfaces, zero values), errors (%w wrapping, sentinel and typed, errors.Is/As), concurrency (goroutines, channels, context.Context, races, leaks), footguns (nil interface != nil, slice aliasing), generics, tooling (go vet, staticcheck, golangci-lint), release engineering (garble, ldflags versioning, self-update), size and complexity budgets (funlen, gocyclo, gocognit, nestif, lll), file granularity (one type per file, doc.go), project layout (cmd/, internal/, pkg/, dependency direction), testing (table-driven tests, subtests, fuzzing, benchmarks, httptest, testcontainers, -race). Use when the user mentions Go, Golang, goroutines, error wrapping, go modules, garble, self-update, function length, complexity limits, type per file, table-driven tests, or Go project structure.
---

# Go Best Practices

Idiomatic, correct, maintainable Go — name the tradeoff explicitly when you skip one.

For service architecture, package layout, and ports/adapters, see `hexagonal-architecture-go`.

---

## 1. Idioms

**Do**
- Compose via struct embedding and small interfaces — no inheritance hierarchies
- Define interfaces at the consumer, not the producer (`io.Reader` is in `io`, not in the package that provides bytes)
- Accept interfaces, return concrete types — callers get flexibility, internals stay clear
- Keep interfaces small: 1–3 methods is the ideal; `io.Reader`, `io.Writer`, `fmt.Stringer` are the model
- Design types with useful zero values (`var mu sync.Mutex`, `var buf bytes.Buffer` — ready to use)
- Prefer slices/maps over clever data structures until profiling says otherwise
- Run `gofmt` (or `goimports`) on every save; diff noise is not negotiable
- Use named returns only when they materially clarify a complex signature; never just to save a `var`

**Don't**
- Embed a concrete struct just to "inherit" behavior — prefer delegation via a field
- Define an interface in the same package that implements it (except for test doubles)
- Return `interface{}` or `any` when you know the concrete type
- Create a single-method interface and name it after the struct (`UserServiceInterface`)

```go
// Do: consumer defines what it needs
type Notifier interface {
    Notify(ctx context.Context, msg string) error
}

// Don't: producer owns the interface
type UserRepository interface { /* 15 methods */ }
```

---

## 2. Errors

**Do**
- Treat errors as values; check them immediately after the call
- Wrap with context at each layer boundary: `fmt.Errorf("create order: %w", err)`
- Use `errors.Is` to check sentinel errors, `errors.As` to inspect typed errors
- Declare sentinel errors as package-level `var`: `var ErrNotFound = errors.New("not found")`
- Use typed errors when callers need to branch on structured data

```go
type ValidationError struct {
    Field   string
    Message string
}
func (e *ValidationError) Error() string {
    return fmt.Sprintf("validation: %s %s", e.Field, e.Message)
}

// caller
var ve *ValidationError
if errors.As(err, &ve) { /* ... */ }
```

- Combine multiple errors at a boundary with `errors.Join` (Go 1.20+)

**Don't**
- Discard errors with `_` — handle, wrap, or explicitly document why it's safe to ignore
- `panic` for ordinary runtime failures; reserve it for programmer errors (invariant violations)
- Add context at every intermediate layer — one clear wrap per boundary is enough
- Write stuttering messages: `fmt.Errorf("error: %w", err)` or `"failed to fail"`
- Return `error` and also set a sentinel flag/bool alongside it

---

## 3. Concurrency

**Do**
- Give every goroutine a clear owner and a clear stop path — if you can't name both, don't launch it
- Pass `context.Context` as the first argument of any function that may block, do I/O, or cancel
- Use `context.WithTimeout` / `context.WithDeadline` for external calls; always `defer cancel()`
- Use channels for ownership transfer and signaling; use `sync.Mutex`/`sync.RWMutex` for shared state
- Coordinate goroutine completion with `sync.WaitGroup` or `golang.org/x/sync/errgroup`
- Use `errgroup.Group` when you need the first non-nil error from a fan-out

```go
g, ctx := errgroup.WithContext(ctx)
g.Go(func() error { return fetchA(ctx) })
g.Go(func() error { return fetchB(ctx) })
if err := g.Wait(); err != nil { /* ... */ }
```

- Run `go test -race` in CI; treat every data race as a blocker

**Don't**
- Launch goroutines in library code without exposing a shutdown mechanism
- Share memory by communicating (pass pointers over channels when receiver mutates) — communicate by sharing nothing
- Forget that `sync.Mutex` must not be copied after first use
- Use `time.Sleep` as a synchronization primitive
- Close a channel from the receiver side; close from the sender that owns it

---

## 4. Footguns

**Do**
- In Go 1.22+ loop variable capture semantics changed (each iteration gets its own variable). Still be explicit with goroutines for clarity: `v := v` or pass as argument.
- Compare `time.Time` with `.Equal()`, not `==` (location matters)
- When copying a struct that contains a `sync.Mutex`, embed a pointer to the mutex or don't copy it
- Know that `append` may or may not share the backing array — use `slices.Clone` when you need an independent copy

```go
// slice aliasing trap
a := []int{1, 2, 3}
b := a[:2]
b = append(b, 99) // may overwrite a[2]

// safe copy
b := slices.Clone(a[:2])
```

- Use `defer` inside a function, not inside a loop iteration, unless the function is short and scoped

**Don't**
- Assign a typed nil to an `interface{}` / `error` variable and expect `== nil` to hold

```go
var p *MyError = nil
var err error = p
fmt.Println(err == nil) // false — interface holds type info
```

- Rely on map iteration order — it is intentionally randomized
- Use `len(m) == 0` to distinguish an uninitialized map from an empty one; both are `== nil` only for the zero value

---

## 5. Generics

**Do**
- Use generics to eliminate real duplication that `interface{}`/reflection previously forced
- Constrain with `comparable` when you need `==`/map keys; use `~T` for underlying-type constraints
- Keep constraint interfaces in a `constraints` package or inline when one-off

```go
func Map[S ~[]E, E, T any](s S, f func(E) T) []T {
    result := make([]T, len(s))
    for i, v := range s { result[i] = f(v) }
    return result
}
```

**Don't**
- Genericize a function that only ever has one concrete caller — premature abstraction
- Use type parameters when a simple `interface` method call is cleaner
- Reach for generics to avoid a `switch`; a type switch is often more readable

---

## 6. APIs & Structure

**Do**
- Every exported identifier gets a doc comment that starts with its name: `// NewOrder creates...`
- Keep packages cohesive around a single concept; resist `util`, `common`, `helpers` dump packages
- Minimize the exported surface — unexported by default, export only what consumers need
- One package per directory; circular imports are a compile error, not a lint warning

**Don't**
- Export a type just because it's big; if it's only used internally, keep it unexported
- Stuff unrelated types into one package to avoid creating a new one

For service layering, port/adapter interfaces, and `cmd/`/`internal/` layout, see `hexagonal-architecture-go`.

---

## References

Bundled deep-dives — load the file when the task reaches it.

- **`references/tooling-and-limits.md`** — `go vet`, `staticcheck`, the `.golangci.yml` baseline, `govulncheck`, the size and complexity budget table, and "Getting back under budget". Read when setting up or fixing the project's lint gates, or when a function or file is over budget.
- **`references/project-layout.md`** — one type per file, `doc.go`, `ports.go`, `errors.go`, the `cmd/`/`internal/`/`pkg/` repository shape, and `depguard` rules for dependency direction. Read when starting a project, adding a package, or deciding where a type belongs.
- **`references/testing.md`** — table-driven tests, subtests, `t.Parallel()`, `t.Helper()`, golden files, fuzzing, benchmarks, hand-written fakes, `httptest`, and `testcontainers-go`. Read when writing or reviewing tests.
- **`references/release-engineering.md`** — `garble` obfuscated builds, `-ldflags` version embedding, update checks with checksum verification, and the launcher plus main-binary pattern. Read when shipping a binary to end users or adding self-update.
