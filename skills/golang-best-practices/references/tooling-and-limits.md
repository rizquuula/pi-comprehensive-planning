# Go Tooling, Size & Complexity Limits

Linter configuration and the size/complexity budgets it enforces.

---

## Tooling

**Do**
- `go vet` in CI — catches real bugs (printf mismatches, unreachable code, lock copies)
- `staticcheck` for deeper static analysis; `golangci-lint` to consolidate both and more
- `gofmt`/`goimports` (or `gofumpt` for the stricter superset) on save, and as a CI check
- Commit `.golangci.yml` — a linter config that lives only in someone's editor enforces nothing (see the Size & Complexity Limits section below for the complexity settings)
- `go mod tidy` before commit; pin indirect dependencies with `go.sum`
- `govulncheck ./...` in CI — it reports only vulnerabilities on paths you actually call
- One `make lint` / `make test` entry point so CI and humans run identical commands

```yaml
# .golangci.yml — the baseline; the Size & Complexity Limits section below adds the size/complexity linters
version: "2"
linters:
  enable: [errcheck, govet, staticcheck, ineffassign, unused, bodyclose, errorlint, contextcheck]
```

**Don't**
- Skip `go vet` because "it never finds anything" — it will, eventually
- Enable every linter golangci-lint ships — a wall of noise gets globally disabled within a week
- Leave `go.sum` uncommitted — it is part of the reproducible build
- `//nolint` without a reason comment: `//nolint:errcheck // best-effort close on read path`
- Depend on a linter to catch what the type system could — a distinct type beats a lint rule

---

## Size & Complexity Limits

Budgets, not gates — cross one and look for the seam, don't split mechanically at the boundary.

| Unit | Target | Pause | Refactor |
|---|---|---|---|
| Line length | ≤ 100 chars (soft — `gofmt` never wraps lines, so nothing enforces this for you) | 120 | 140 — extract a local, or the names are doing too much work |
| Function / method | ≤ 40 lines | 60 | 80 — extract, or it's doing two jobs |
| File (`.go`) | 200–400 lines | 500 | 700 — split by type (`project-layout.md`) |
| Struct | ≤ 8 fields | 12 | 15 — a sub-struct is hiding in there |
| Interface | 1–3 methods (SKILL.md §1 Idioms: define at the consumer, keep it small) | 4 | 5 — segregate it per consumer instead |
| Parameters | ≤ 4, not counting `ctx` | 5 | 6 — config struct or functional options |
| Nesting depth | ≤ 3 | 4 | 5 — guard-clause it back down |
| Cyclomatic complexity | ≤ 10 | 15 | 20 — split branches into named helpers |
| Cognitive complexity | ≤ 20 | 30 | 40 — nesting is weighted; flatten first |
| Package | ≤ 10 `.go` files | 15 | 20 — promote a cohesive subset to a subpackage |

**Do**
- Enforce it in `.golangci.yml` so the numbers aren't folklore:

```yaml
version: "2"
linters:
  enable:
    - funlen      # function length
    - gocyclo     # cyclomatic complexity, per function
    - cyclop      # same, plus a package average
    - gocognit    # cognitive complexity — weights nesting
    - nestif      # deeply nested if chains
    - lll         # line length (gofmt won't do this)
    - dupl        # copy-pasted blocks
    - maintidx    # maintainability index, catches the slow rot
    - revive      # arg counts, result counts, naming
  settings:
    funlen:
      lines: 60
      statements: 40
      ignore-comments: true
    gocyclo:
      min-complexity: 15
    cyclop:
      max-complexity: 15
      package-average: 8.0
    gocognit:
      min-complexity: 30
    nestif:
      min-complexity: 4
    lll:
      line-length: 120
      tab-width: 4
    dupl:
      threshold: 150
    maintidx:
      under: 20
    revive:
      rules:
        - name: argument-limit
          arguments: [5]
        - name: function-result-limit
          arguments: [3]
  exclusions:
    rules:
      - path: _test\.go
        linters: [funlen, dupl, lll, gocognit]   # table literals are data, not complexity
```

- Count the *table*, not the function, in table-driven tests — a 300-line test file that is 250 lines of cases is healthy
- Exclude generated files (`//go:generate`, protobuf, `sqlc`, mocks) from every size linter; you don't refactor what you don't write
- Let a `switch` over a closed set (a state enum, a token kind) run long if every arm is one line — that is a table wearing `switch` syntax, and `gocyclo` misjudges it; silence it locally with a reasoned `//nolint:gocyclo`
- Treat `main()` as budgeted like anything else — wiring past ~60 lines moves into `newApp()` constructors

**Don't**
- `//nolint:funlen` sprinkled to dodge the budget — either extract, or write the reason in the directive
- Split a function at an arbitrary line count into `doThingPart2()` — the halves must each have a name
- Count `if err != nil { return }` blocks against nesting depth; they *are* the guard clauses, and they keep depth at 1
- Let a struct grow past 15 fields because "it maps the DB row" — that's the adapter's row type, not the domain type
- Add an interface with 8 methods to "abstract the repository" — that's the concrete type with extra steps (SKILL.md §1 Idioms)

### Getting back under budget

Complexity is branches × nesting. Work down this list in order — the first three fix most violations.

**1. Guard clauses — invert and return early.** Go's `if err != nil { return }` convention is already this; apply it to non-error conditions too.

```go
// over — depth 4
func Charge(o *Order) (*Receipt, error) {
    if o != nil {
        if len(o.Items) > 0 {
            if o.Customer.Active {
                return gateway.Charge(o.Total())
            }
            return nil, ErrInactiveCustomer
        }
        return nil, ErrEmptyOrder
    }
    return nil, ErrNilOrder
}

// prefer — depth 1, and each rejection reads on its own line
func Charge(o *Order) (*Receipt, error) {
    if o == nil {
        return nil, ErrNilOrder
    }
    if len(o.Items) == 0 {
        return nil, ErrEmptyOrder
    }
    if !o.Customer.Active {
        return nil, ErrInactiveCustomer
    }
    return gateway.Charge(o.Total())
}
```

**2. Extract a named helper per step.** A comment explaining a block is the block's future function name — the comment becomes the name, and the name replaces the comment. Keep the helper unexported and in the same file until a second caller appears.

**3. Map dispatch over `switch`/`if-else` chains.** An 8-arm chain becomes complexity 2 and grows without touching the function.

```go
// over — cyclomatic 9, every new kind edits this function
func Fee(kind string, amount Money) (Money, error) {
    switch kind {
    case "wire":
        return amount.Scale(0.03), nil
    case "ach":
        return amount.Scale(0.01), nil
    // ...six more
    }
    return Money{}, fmt.Errorf("%w: %s", ErrUnknownFeeKind, kind)
}

// prefer — cyclomatic 2, new kinds are data
var feeRates = map[string]float64{"wire": 0.03, "ach": 0.01}

func Fee(kind string, amount Money) (Money, error) {
    rate, ok := feeRates[kind]
    if !ok {
        return Money{}, fmt.Errorf("%w: %s", ErrUnknownFeeKind, kind)
    }
    return amount.Scale(rate), nil
}
```

Same move with `map[string]func(...)` when the arms are behavior rather than a constant.

**4. Config struct or functional options past 4 params.** Parameters that always travel together are one missing type.

```go
// over — six positional params; every call site is unreadable
func NewServer(addr, cert, key string, read, write time.Duration, maxConns int) *Server

// prefer — required arg positional, the rest named and defaulted
type Option func(*Server)

func WithTimeouts(read, write time.Duration) Option {
    return func(s *Server) { s.readTimeout, s.writeTimeout = read, write }
}

func NewServer(addr string, opts ...Option) *Server {
    s := &Server{addr: addr, readTimeout: 5 * time.Second, writeTimeout: 10 * time.Second}
    for _, opt := range opts {
        opt(s)
    }
    return s
}
```

A plain `Config` struct is simpler and should be the first reach; options earn their extra machinery only when there are defaults to protect or the type is in a public API that must stay additive.

**5. Table-driven decomposition for sequential validation.** Fifteen `if !ok { return err }` blocks become one loop over data, and the rules are individually testable.

```go
var orderRules = []struct {
    name string
    ok   func(*Order) bool
    err  error
}{
    {"has items", func(o *Order) bool { return len(o.Items) > 0 }, ErrEmptyOrder},
    {"positive total", func(o *Order) bool { return o.Total().IsPositive() }, ErrNonPositiveTotal},
}

func Validate(o *Order) error {
    var errs []error
    for _, r := range orderRules {
        if !r.ok(o) {
            errs = append(errs, r.err)
        }
    }
    return errors.Join(errs...)
}
```

**6. Interface-based polymorphism when the same type switch appears in more than two functions.** Repeating `switch p := payment.(type)` in `Fee`, `Label`, and `Settle` means the behavior belongs on the types.

```go
// over — the same switch, three times, and a fourth variant edits all three
func Fee(p Payment, m Money) Money {
    switch v := p.(type) {
    case *Card:
        return m.Scale(v.rate)
    case *Wire:
        return wireFlatFee
    }
    return Money{}
}

// prefer — one method set; adding *SEPA touches no existing function
type Payment interface {
    Fee(Money) Money
    Label() string
}
```

A single type switch at a boundary (decoding a union, adapting a vendor type) stays a type switch — SKILL.md §5 Generics already says so.

**7. Middleware / decorator for cross-cutting concerns.** Retry, timing, logging, tracing, and transaction boundaries are not the function's logic; wrapping takes their branches with them.

```go
type Handler func(ctx context.Context, cmd Command) error

func WithRetry(attempts int, next Handler) Handler {
    return func(ctx context.Context, cmd Command) error {
        var err error
        for range attempts {
            if err = next(ctx, cmd); err == nil {
                return nil
            }
            if ctx.Err() != nil {
                return ctx.Err()
            }
        }
        return err
    }
}
```

**8. `errgroup` to flatten concurrency plumbing.** A `WaitGroup` + result channel + mutex-guarded first-error is ~25 lines of branches; `errgroup` is four, and it cancels siblings on the first failure.

```go
func loadDashboard(ctx context.Context, id UserID) (Dashboard, error) {
    var d Dashboard
    g, ctx := errgroup.WithContext(ctx)
    // each goroutine writes a distinct field — no shared word, no race
    g.Go(func() (err error) { d.Profile, err = fetchProfile(ctx, id); return })
    g.Go(func() (err error) { d.Orders, err = fetchOrders(ctx, id); return })
    if err := g.Wait(); err != nil {
        return Dashboard{}, err
    }
    return d, nil
}
```

**Don't** trade complexity for indirection: five one-line helpers called once each, in order, is the same function with extra jumps. Extract when the piece has a name, a boundary, and ideally its own test — not to satisfy the linter.
