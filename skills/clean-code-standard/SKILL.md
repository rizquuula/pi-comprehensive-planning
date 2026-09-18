---
name: clean-code-standard
description: Apply when writing or reviewing non-trivial code. Covers naming (verbs/nouns/questions, magic values, comments), guard clauses and avoiding else, error-prone constructs (null/primitive obsession/implicit conversions), logging discipline (boundaries, structured fields, levels), refactoring rules (green tests, rule of three, Boy Scout), and file/function size seams.
---

# Clean Code Standard

Defaults for readable, durable code — name the tradeoff explicitly when you skip one.

---

## 1. Naming

**Do**
- Functions are verbs, types are nouns, booleans are questions (`isSettled`, `hasExpired`)
- Rename a badly named thing; never explain it with a comment
- Magic values → named constants in the owning domain (`MAX_RETRY_ATTEMPTS`, not `3`)
- Comments explain *why*, not what (`// must run after tax, before discount`)

**Don't**
- Names that need a comment to make sense (`data2`, `handler3`, `tmp`)
- Dead code or commented-out blocks — use git
- A function whose name contains "and" (`processAndSave`) — split it

---

## 2. Control Flow — `else` as a smell

**Do**
- Prefer early returns / guard clauses: handle the exceptional case, return, let the happy path fall through
- Use exhaustive `switch` over `if/else if/else` for closed sets
- Make impossible states unrepresentable (sum types, discriminated unions)
- Justify every `else`: "what is true here that wasn't true above?"

**Don't**
- Silent `else`: either dead code (delete it) or a swallowed case (log/throw)
- Growing `else if` chains — extract a dispatch table or use polymorphism
- Nullable flags standing in for states (`isLoading` + `isError` + `isSuccess` — use a union)

---

## 3. Error-Prone Constructs

**Do**
- Keep null/undefined at boundaries only; use `Option`/`Maybe`/explicit absence inside the domain
- Distinct types for time, money, identifiers, units — no raw `number`/`string` in non-trivial code
- Immutability by default; mutate only inside the aggregate that owns the invariant
- `===` not `==`; named/object params when argument order is ambiguous

```ts
// prefer
createOrder({ customerId, amountCents, currency })
// over
createOrder(customerId, amountCents, currency)
```

**Don't**
- Primitive obsession — `CustomerId`, `Money`, `EmailAddress` should be types
- Implicit conversions, truthy checks on numbers (`if (count)` when `0` is valid)
- Silent `catch` — handle it, translate to a domain error, or let it propagate
- Order-dependent positional args where confusion is possible

---

## 4. Logging

**Do**
- Log at boundaries: use-case entry, adapter exit, domain events
- Structured key-value fields (`order_id`, `amount_cents`) so logs are queryable
- Thread request/trace IDs so one journey is one query
- Log the *why*: `"rejected: card_declined"`, not `"rejected"`
- Use levels deliberately: `debug` verbose dev-only | `info` domain-significant | `warn` recovered anomaly | `error` invariant broken, needs a human

**Don't**
- PII in logs — redact at the logger boundary, not scattered at every call site
- Log noise: `"entered handlePayment"`, `"starting loop"`

---

## 5. Refactoring

**Do**
- Refactor under green — tests prove behavior is preserved
- Rule of three: duplicate once tolerate, twice extract
- Boy Scout rule: leave the file a little better than you found it
- Refactor on the on-ramp: clean the area before changing it, in a separate `tec:` commit

**Don't**
- Refactor without tests — that's rewriting, not refactoring
- Ignore smells: long functions, long param lists, feature envy, shotgun surgery, primitive obsession, growing `else` chains, `Manager`/`Helper` names

---

## 6. File & Function Size

**Do**
- Target 50–200 lines per file; pause at 300; look for a seam approaching 500
- Each file answers one question: "what does this file own?"
- Split on domain seams first; technical splits (utils, helpers) are a fallback

**Don't**
- Split mechanically at line 501 — the rule is "split when the file does multiple things"
- Over-split genuinely single-responsibility files; generated code, parsers/lexers/state machines, and SQL migrations are fair exceptions
