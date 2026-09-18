# Kotlin Tooling, Size & Complexity Limits

Reference for `kotlin-best-practices`. Formatting, static analysis, build gates, and the size and complexity budgets that CI enforces.

---

## Tooling

**Do**
- Run `ktlint` for formatting (non-negotiable), `detekt` for static analysis (tune rules to your codebase)
- Use Gradle Kotlin DSL (`build.gradle.kts`) + version catalogs (`libs.versions.toml`) for type-safe, refactorable build scripts
- Put shared build logic in convention plugins under `build-logic/` — apply one plugin per module instead of copy-pasting config
- Turn warnings into failures on new modules: `allWarningsAsErrors`, plus `explicitApi()` on libraries
- Wire lint and analysis into `check` so CI fails on drift, not on review

```kotlin
// build.gradle.kts — one convention, applied per module
kotlin {
    compilerOptions {
        jvmTarget = JvmTarget.JVM_21
        allWarningsAsErrors = true
        freeCompilerArgs.add("-Xjsr305=strict") // treat Java @Nullable as real nullability
    }
}

detekt {
    buildUponDefaultConfig = true
    config.setFrom(rootProject.file("config/detekt/detekt.yml"))
}

tasks.named("check") { dependsOn("detekt", "ktlintCheck") }
```

Configure the thresholds below to make the size budgets enforceable rather than folklore.

**Don't**
- Hand-format instead of running `ktlint --format` — formatting arguments are wasted review time
- Fork detekt config per module — one root `detekt.yml`, module overrides only with a written reason
- Suppress a rule file-wide (`@file:Suppress("LongMethod")`) when one function is the offender
- Skip linting in CI — style drift compounds fast on a Kotlin codebase

---

## Size & Complexity Limits

Budgets, not gates — cross one and look for the seam, don't split mechanically at the boundary.

| Unit | Target | Pause | Refactor |
|---|---|---|---|
| Line length | ≤ 120 chars | 140 (ktlint default) | hard cap — extract a local `val` |
| Function | ≤ 30 lines | 40 | 60 — it's doing two jobs |
| Class | ≤ 150 lines | 200 | 300 — split responsibilities |
| File (`.kt`) | 100–300 lines | 400 | 500 — split by type (see `project-layout.md`) |
| Parameters (function) | ≤ 4 | 5 | 6 — pass a data class |
| Parameters (constructor) | ≤ 5 | 7 | 8 — the class has too many collaborators |
| Nesting depth | ≤ 3 | 4 | guard-clause it back down |
| Cyclomatic complexity | ≤ 8 | 10 | 12 — extract named helpers |
| Cognitive complexity | ≤ 12 | 15 | 20 — flatten before extracting |
| Public members per class | ≤ 8 | 12 | 15 — two interfaces wearing one class |
| `when` branches | ≤ 8 | 12 | model the domain as a sealed hierarchy |
| Files per Gradle module | ≤ 60 | 100 | 150 — or when its build is on the critical path |

ktlint's default `max_line_length` is 140, inherited from the Android style. Prefer 120: Kotlin's expression bodies, trailing lambdas and named arguments read badly when wrapped late, and 120 still fits a side-by-side diff on a laptop. Only 140 if you already ship a codebase formatted that way — one reformat commit is cheaper than two conventions.

**Do**
- Put the numbers in `config/detekt/detekt.yml` so CI, not review, enforces them:

```yaml
complexity:
  CognitiveComplexMethod:
    active: true
    threshold: 15
  ComplexCondition:
    active: true
    threshold: 3
  CyclomaticComplexMethod:
    active: true
    threshold: 10
    ignoreSingleWhenExpression: false   # a 20-branch `when` should be visible
    ignoreSimpleWhenEntries: false
  LargeClass:
    active: true
    threshold: 300
  LongMethod:
    active: true
    threshold: 40
  LongParameterList:
    active: true
    functionThreshold: 5
    constructorThreshold: 7
    ignoreDefaultParameters: true       # defaults are not caller burden
  NestedBlockDepth:
    active: true
    threshold: 4
  TooManyFunctions:
    active: true
    thresholdInClasses: 12
    thresholdInFiles: 15
    thresholdInObjects: 12
    thresholdInInterfaces: 8
    ignorePrivate: true

style:
  MaxLineLength:
    active: true
    maxLineLength: 120
    excludeCommentStatements: false
  ReturnCount:
    active: true
    max: 4
    excludeGuardClauses: true           # guard clauses are the fix, not the smell
```

- Mirror the line length in `.editorconfig` so ktlint and the IDE agree:

```editorconfig
[*.{kt,kts}]
ktlint_code_style = ktlint_official
max_line_length = 120
indent_size = 4
ij_kotlin_allow_trailing_comma = true
ij_kotlin_allow_trailing_comma_on_call_site = true
ktlint_standard_no-wildcard-imports = enabled
ktlint_standard_filename = enabled
# backtick test names are the Kotlin idiom — don't let function-naming reject them
ktlint_function_naming_ignore_when_annotated_with = Test, ParameterizedTest, Composable
```

- Split a file the moment a second public type lands in it (see `project-layout.md`) — the file budget then takes care of itself
- Count *logical* lines: a 400-line file that is one exhaustive sealed hierarchy or a generated proto mapping is fine
- Treat `TooManyFunctions` on an interface as a design signal — split the port before the implementation grows to match

**Don't**
- `@Suppress("LongMethod")` on the function you just wrote — suppress only legacy code you are not touching
- Detune a threshold because one file fails it — fix the file, or add a `baseline.xml` so new code stays clean
- Split a coherent class into `OrderService` + `OrderServiceHelper` to duck `LargeClass` — a class too big is two *concepts*, not two files
- Count a `when` over a sealed type against the branch budget the same way as an `if/else if` chain — exhaustiveness makes it maintainable

### Getting back under budget

Work down this list in order — the first four fix most violations.

**1. Guard clauses — invert and return early.** `?: return` collapses null-nesting to one line.

```kotlin
// depth 4
fun charge(order: Order?): Receipt? {
    if (order != null) {
        if (order.items.isNotEmpty()) {
            if (order.customer.isActive) {
                return gateway.charge(order.total)
            }
        }
    }
    return null
}

// depth 1
fun charge(order: Order?): Receipt? {
    val validOrder = order ?: return null
    if (validOrder.items.isEmpty()) return null
    if (!validOrder.customer.isActive) return null
    return gateway.charge(validOrder.total)
}
```

**2. `require` / `check` instead of nested validation.** Preconditions stop being branches you have to read past, and the failure message lands at the boundary.

```kotlin
// over
fun transfer(from: Account, to: Account, amount: BigDecimal): Transfer {
    if (amount > BigDecimal.ZERO) {
        if (from.balance >= amount) {
            if (from.id != to.id) {
                return execute(from, to, amount)
            } else throw IllegalArgumentException("same account")
        } else throw IllegalStateException("insufficient funds")
    } else throw IllegalArgumentException("non-positive amount")
}

// prefer — cyclomatic 1 in the happy path
fun transfer(from: Account, to: Account, amount: BigDecimal): Transfer {
    require(amount > BigDecimal.ZERO) { "amount must be positive, was $amount" }
    require(from.id != to.id) { "cannot transfer to the same account ${from.id}" }
    check(from.balance >= amount) { "insufficient funds on ${from.id}" }
    return execute(from, to, amount)
}
```

**3. `when` over a sealed hierarchy replaces `if/else if` chains.** The payoff is not brevity — it is exhaustiveness: add a subtype and every `when` expression stops compiling until you handle it. A string-keyed `if` chain fails at runtime instead.

```kotlin
// over — silent fallthrough, and `kind` is a type wearing a String
fun fee(kind: String, amount: BigDecimal): BigDecimal =
    if (kind == "wire") amount * BigDecimal("0.03")
    else if (kind == "ach") amount * BigDecimal("0.01")
    else if (kind == "card") amount * BigDecimal("0.025")
    else BigDecimal.ZERO

// prefer
sealed interface FeeKind {
    data object Wire : FeeKind
    data object Ach : FeeKind
    data class Card(val network: Network) : FeeKind
}

fun fee(kind: FeeKind, amount: BigDecimal): BigDecimal = when (kind) {
    FeeKind.Wire -> amount * BigDecimal("0.03")
    FeeKind.Ach  -> amount * BigDecimal("0.01")
    is FeeKind.Card -> amount * kind.network.rate
}
```

When the branches are pure data and share a shape, drop the `when` entirely: an `enum class FeeKind(val rate: BigDecimal)` turns complexity 3 into complexity 1 and makes new kinds a one-line addition.

**4. Extension functions pull behavior off a fat class.** `TooManyFunctions` on `Order` usually means half those methods are read-only derivations that no other code needs to see as members.

```kotlin
// prefer — Order keeps its invariants; formatting lives elsewhere
// OrderExtensions.kt
fun Order.isOverdue(now: Instant): Boolean = dueAt < now && paidAt == null
fun Order.displayTotal(locale: Locale): String = NumberFormat.getCurrencyInstance(locale).format(total)
```

Extensions do not get access to `private` state — if the function needs internals, it is a member and the class genuinely has too many responsibilities. That constraint is the useful part.

**5. Data class / parameter object past ~5 arguments.** Parameters that always travel together are one missing concept, and the data class is where `init` validation lands — deleting the same guards from every caller.

```kotlin
// over
fun createInvoice(
    customerId: UUID, currency: String, lines: List<Line>, dueAt: Instant,
    poNumber: String?, taxRate: BigDecimal, notes: String?,
): Invoice

// prefer
data class InvoiceDraft(
    val customerId: UUID,
    val currency: Currency,
    val lines: List<Line>,
    val dueAt: Instant,
    val taxRate: BigDecimal,
    val poNumber: String? = null,
    val notes: String? = null,
) {
    init {
        require(lines.isNotEmpty()) { "invoice needs at least one line" }
        require(taxRate >= BigDecimal.ZERO) { "taxRate must be non-negative" }
    }
}

fun createInvoice(draft: InvoiceDraft): Invoice
```

**6. Named + default arguments kill overload explosions.** Four overloads that differ only in which optional parameter they supply are one function; each deleted overload is a whole branch set removed from the file's budget.

```kotlin
// over: 4 overloads, 4 bodies to keep in sync
fun connect(host: String): Client
fun connect(host: String, port: Int): Client
fun connect(host: String, port: Int, timeout: Duration): Client

// prefer
fun connect(host: String, port: Int = 443, timeout: Duration = 30.seconds): Client
```

**7. Polymorphism when the same `is` chain appears twice.** Repeated type checks across functions mean the behavior belongs on the subtype.

```kotlin
// over — this `when` is duplicated in three files
fun icon(n: Notification) = when (n) {
    is Email -> "envelope"
    is Sms   -> "phone"
    is Push  -> "bell"
}

// prefer
sealed interface Notification {
    val icon: String
    fun deliver(to: Recipient)
}
```

Keep the `when` when the behavior belongs to the *caller* (rendering, serialization) and not to the type — moving UI concerns into a domain sealed class is a worse trade.

**8. Collection / sequence operator chains replace manual loops.** A loop with `continue`, an accumulator and a nested `if` is one expression.

```kotlin
// over — cyclomatic 5
fun totalDue(orders: List<Order>): BigDecimal {
    var total = BigDecimal.ZERO
    for (o in orders) {
        if (o.status != Status.PAID) {
            if (o.total > BigDecimal.ZERO) {
                total = total + o.total
            }
        }
    }
    return total
}

// prefer — cyclomatic 1
fun totalDue(orders: List<Order>): BigDecimal = orders
    .asSequence()
    .filter { it.status != Status.PAID && it.total > BigDecimal.ZERO }
    .fold(BigDecimal.ZERO, BigDecimal::add)
```

**9. Scope functions to flatten — with a limit.** `?.let { }` removes a null branch; `apply` removes repeated receiver noise. But chained or nested scope functions *raise* cognitive complexity: every `it` and implicit receiver is one more binding the reader tracks, and detekt's `CognitiveComplexMethod` counts nesting either way. One level, named lambda parameters over `it` when the block is longer than a line.

```kotlin
// prefer
val config = loadFile(path)?.let(::parseConfig) ?: Config.DEFAULT

// over — three implicit receivers, no name for any of them
val config = loadFile(path)?.let { f -> f.readText().let { t -> t.run { parseConfig(this) } } }
```

**10. Delegation (`by`) instead of forwarding boilerplate.** Twelve one-line methods that all call through to a field are twelve entries against `TooManyFunctions` for zero logic.

```kotlin
// over
class LoggingRepository(private val delegate: OrderRepository) : OrderRepository {
    override fun findById(id: UUID) = delegate.findById(id)
    override fun save(order: Order) = delegate.save(order)
    // ...ten more pass-throughs
}

// prefer — only the overridden method has a body
class LoggingRepository(
    private val delegate: OrderRepository,
) : OrderRepository by delegate {
    override fun save(order: Order) {
        logger.info("saving {}", order.id)
        delegate.save(order)
    }
}
```

**11. Higher-order and `inline fun` for cross-cutting concerns.** Retry, timing, transactions and logging are not the function's logic; hoisting them takes their branches and nesting along.

```kotlin
suspend fun <T> retrying(attempts: Int = 3, block: suspend () -> T): T {
    repeat(attempts - 1) {
        try {
            return block()
        } catch (e: IOException) {
            delay(100)
        }
    }
    return block()
}

inline fun <T> timed(name: String, block: () -> T): T {
    val start = System.nanoTime()
    try {
        return block()
    } finally {
        metrics.record(name, System.nanoTime() - start)
    }
}

// call sites stay at complexity 1
suspend fun fetchUser(id: UUID): User = retrying { api.get(id) }
```

`inline` matters here: it keeps non-local `return` working inside the lambda and avoids an object allocation per call. Do not `inline` a function with a large body — it multiplies bytecode at every call site.

**12. Extract a named helper per step.** Last, not first. A comment explaining a block is that block's future function name.

**Don't** trade complexity for indirection: five private one-line functions called once each, in order, is the same function with extra jumps. Extract when the piece has a name, a boundary, and ideally its own test — not to satisfy detekt.
