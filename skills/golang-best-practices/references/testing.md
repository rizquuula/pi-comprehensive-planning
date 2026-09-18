# Go Testing

Test mechanics for Go.

---

## Testing

Mechanics only — for the red-green-refactor process and how wide to sweep per change, use `test-driven-development`. For which layer gets which kind of test, see `hexagonal-architecture-go`.

**Do**
- Table-driven tests as the default shape: a slice of cases, one `t.Run(tc.name, ...)` subtest each, so failures name themselves
- Name tests after behavior, not method: `TestCharge_DeclinesWhenCardExpired` — the failure line should read as a bug report
- `t.Parallel()` in both the parent and each subtest for independent cases; on Go 1.22+ each loop iteration has its own variable, so the old `tc := tc` copy is no longer needed (keep it only if the module's `go` directive is below 1.22)
- `t.Helper()` as the first line of every assertion helper — failures then point at the caller's line, not the helper's
- `t.Cleanup(func(){ ... })` over `defer` in helpers; it runs after parallel subtests finish, `defer` does not
- Take `testing.TB` in shared helpers so the same code serves tests, benchmarks, and fuzz targets
- `t.TempDir()` for filesystem work — created per test, removed automatically, unique under parallelism
- Golden files in `testdata/` (the `go` tool ignores that directory) behind a `-update` flag; assert on the file, regenerate deliberately
- `go test -race ./...` in CI — non-negotiable; and `-count=1` to defeat the test cache when a run must be real
- Fuzz any parser, decoder, or input validator: `go test -fuzz=FuzzParse -fuzztime=60s`; commit the crashers the corpus finds under `testdata/fuzz/`
- Benchmarks with `b.ReportAllocs()`; on Go 1.24+ use `b.Loop()` — it keeps setup out of the timed region and stops the compiler eliding the call
- Inject clocks, IDs, and randomness as fields or function values (`now func() time.Time`, `newID func() order.ID`) — deterministic without patching anything global
- Hand-written fakes over generated mocks: an in-memory type implementing the consumer's 1–3-method interface (SKILL.md §1 Idioms) reads like production code, survives refactors, and supports state assertions
- `httptest.NewServer` / `httptest.NewRecorder` for both sides of HTTP; never hand-roll a `http.ResponseWriter`
- `testcontainers-go` for adapter integration tests — SQLite standing in for Postgres tests a different database
- Put API-surface tests in the external `package foo_test` — it can only touch exported identifiers, so it proves the package is usable from outside
- Coverage (`go test -coverprofile`) as a gap-finder you read, not a percentage gate you enforce; a global threshold breeds assertion-free tests

```go
func TestFee(t *testing.T) {
    t.Parallel()

    tests := []struct {
        name    string
        kind    string
        amount  Money
        want    Money
        wantErr error
    }{
        {name: "wire applies 3 percent", kind: "wire", amount: USD(100), want: USD(3)},
        {name: "ach applies 1 percent", kind: "ach", amount: USD(100), want: USD(1)},
        {name: "zero amount stays zero", kind: "wire", amount: USD(0), want: USD(0)},
        {name: "unknown kind rejected", kind: "crypto", amount: USD(100), wantErr: ErrUnknownFeeKind},
    }

    for _, tt := range tests {
        t.Run(tt.name, func(t *testing.T) {
            t.Parallel()

            got, err := Fee(tt.kind, tt.amount)
            if !errors.Is(err, tt.wantErr) {
                t.Fatalf("Fee(%q) error = %v, want %v", tt.kind, err, tt.wantErr)
            }
            if tt.wantErr != nil {
                return
            }
            if !got.Equal(tt.want) {
                t.Errorf("Fee(%q, %v) = %v, want %v", tt.kind, tt.amount, got, tt.want)
            }
        })
    }
}
```

A fake is a real type, not a script of expectations — it is usually shorter than the mock setup it replaces:

```go
type fakeInvoices struct {
    saved []*Invoice
    err   error
}

func (f *fakeInvoices) Save(_ context.Context, inv *Invoice) error {
    if f.err != nil {
        return f.err
    }
    f.saved = append(f.saved, inv)
    return nil
}
```

`testify` is acceptable in moderation: `require` aborts the test, `assert` continues and lets the next line panic on a nil result — so use `require` for anything the rest of the test depends on. The tradeoff is that its failure messages describe values, not behavior, and a suite written entirely in `assert.Equal` loses the "want/got" phrasing that makes stdlib failures readable. Prefer plain `if got != want { t.Errorf(...) }` for the assertions that carry the meaning of the test.

**Don't**
- `time.Sleep` to wait for a goroutine or a server — synchronize on a channel, poll with a deadline, or inject the clock
- `t.Parallel()` on subtests that share a table entry's mutable state, a package-level variable, or a fixed TCP port
- Network calls, real credentials, or the developer's own database in unit tests — that tier runs offline in milliseconds
- Generated mocks (`gomock`, `mockery`) for a 1–3-method port — the generator plus the expectation DSL costs more than the fake
- Mock what you don't own (`*sql.DB`, `*http.Client`, the vendor SDK) — wrap it behind a port and fake the port, or use a container
- Assert only that a mock was called — that tests your wiring, not your logic
- Logic in tests: an `if` computing the expected value with the same formula as the code makes the test agree with the bug
- Assert on whole JSON blobs or exact log lines — assert the fields that carry meaning, or the test breaks on every cosmetic change
- Tests that depend on order, or that leak state through package-level vars — every test must pass alone under `go test -run TestX -count=1`
- `t.Fatal` from inside a non-test goroutine — it is undefined; send the error back over a channel and fail on the test goroutine
- Chase 100% coverage through getters and `String()` methods; the untested error branch is the real gap
- Skip or delete a flaky test without diagnosing it — under `-race`, flakiness is usually a real bug
