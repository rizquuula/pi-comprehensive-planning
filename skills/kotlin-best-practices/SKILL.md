---
name: kotlin-best-practices
description: Apply when writing, reviewing, or planning Kotlin code (.kt/.kts files) on Android or backend (Ktor/Spring). Covers null-safety, !! and lateinit, immutability, data/sealed classes, exhaustive when, extensions, scope functions, coroutines, Flow, cancellation, sealed Result, require/check, ktlint, detekt, Gradle Kotlin DSL, size and complexity budgets (LongMethod, LongParameterList, LargeClass, TooManyFunctions, CyclomaticComplexMethod, CognitiveComplexMethod, NestedBlockDepth, MaxLineLength, ktlint max_line_length, .editorconfig), one class per file, file naming, sealed hierarchy in one file, layout, Gradle modules, version catalog, api vs implementation, and testing (JUnit 5, Kotest, MockK, runTest, Turbine, Testcontainers, Kover). Use when the user mentions Kotlin, coroutines, Flow, detekt thresholds, function length, Gradle, Android, Ktor, Spring, or Kotlin project structure.
---

# Kotlin Best Practices

Opinionated defaults for safe, idiomatic Kotlin — name the tradeoff when you skip one.

---

## 1. Null-Safety & Types

**Do**
- Prefer `val` over `var`; if you need `var`, justify it
- Use `?.`, `?:`, `let`, `requireNotNull`, `checkNotNull` to unwrap safely
- Annotate Java interop boundaries (`@NonNull`/`@Nullable`) or wrap in a Kotlin facade immediately
- Use `by lazy` for expensive init; use `lateinit` only for DI-injected fields you own the lifecycle of
- Make a field nullable only when absence is a real domain state

**Don't**
- Use `!!` — it's a runtime crash in disguise; every `!!` is a bug waiting to happen
- Trust unadorned Java types (platform types `T!`) inside Kotlin logic — null-check at the border
- Use `lateinit` on nullable types or primitives (compiler won't allow it, but watch for `UninitializedPropertyAccessException`)

```kotlin
// Bad
val name = user!!.profile!!.name

// Good
val name = user?.profile?.name ?: "Anonymous"
val user = requireNotNull(repo.findById(id)) { "User $id not found" }
```

---

## 2. Idioms

**Do**
- Use `data class` for value holders — gets `equals`, `hashCode`, `copy`, `toString` for free
- Use `sealed class` / `sealed interface` + `when` to make impossible states unrepresentable
- Write `when` expressions exhaustively — compiler enforces it on sealed types; use `.exhaustive` or expression form
- Prefer extension functions over utility/helper classes
- Use scope functions deliberately: `apply` to configure a builder, `let` to null-check + transform, `also` for side effects, `with` on a receiver you repeat, `run` to scope a block with a result
- Named + default args over telescoping constructors

**Don't**
- Nest scope functions more than one level deep — readability collapses
- Create `StringUtils`, `DateHelper`, `UserManager` dumping grounds — put logic on the type or in extension functions
- Forget that `when` on non-sealed types is a statement (no exhaustion); seal your state types

```kotlin
sealed interface UiState {
    data object Loading : UiState
    data class Success(val items: List<Item>) : UiState
    data class Error(val cause: Throwable) : UiState
}

fun render(state: UiState) = when (state) {
    is UiState.Loading  -> showSpinner()
    is UiState.Success  -> showList(state.items)
    is UiState.Error    -> showError(state.cause)
}

// Named + default args
fun createUser(name: String, role: Role = Role.VIEWER, active: Boolean = true): User
```

---

## 3. Immutability & Collections

**Do**
- Expose `List`/`Map`/`Set` (read-only views) from public APIs; keep `MutableList` internal
- Use functional pipelines: `map`, `filter`, `fold`, `associateBy`, `groupBy`, `flatMap`
- Switch to `Sequence` for large or lazy pipelines to avoid intermediate allocations
- Use `data class` + `copy()` to derive modified instances instead of mutating

**Don't**
- Expose `MutableList` from a public API — callers will mutate it
- Chain more than ~3–4 eager collection ops on large lists without reaching for `asSequence()`
- Mutate shared state from coroutines without synchronization

```kotlin
// Lazy pipeline — no intermediate lists
val total = orders
    .asSequence()
    .filter { it.status == Status.PAID }
    .map { it.amount }
    .fold(BigDecimal.ZERO, BigDecimal::add)

// Immutable update
val updated = user.copy(email = newEmail)
```

---

## 4. Coroutines & Concurrency

**Do**
- Use structured concurrency: launch children inside `coroutineScope` or `supervisorScope`, never orphaned
- Keep `suspend` functions non-blocking — use `withContext(Dispatchers.IO)` to cross into blocking work
- Use `Dispatchers.IO` for I/O, `Dispatchers.Default` for CPU, `Dispatchers.Main` for UI
- Prefer `Flow` for streams; `StateFlow`/`SharedFlow` for hot state sharing
- Cooperate with cancellation — check `isActive`, call `yield()`, or use suspending functions that respond to cancellation
- On Android, tie scope to lifecycle: `viewModelScope`, `lifecycleScope`

**Don't**
- Launch in `GlobalScope` — it leaks, ignores cancellation, and has no owner
- Catch `CancellationException` and swallow it — always rethrow it
- Block inside a coroutine with `Thread.sleep`, blocking I/O on `Dispatchers.Default`
- Use `runBlocking` in production coroutine code (test harness only)

```kotlin
// Structured: both children cancel if one fails
suspend fun loadDashboard(): Dashboard = coroutineScope {
    val user  = async { userRepo.fetch() }
    val stats = async(Dispatchers.IO) { statsRepo.fetch() }
    Dashboard(user.await(), stats.await())
}

// supervisorScope: one child failing doesn't cancel siblings
suspend fun loadOptional() = supervisorScope {
    val core = async { coreData() }
    val extra = async { runCatching { extraData() }.getOrNull() }
    Pair(core.await(), extra.await())
}

// Flow: cold stream, cooperative cancellation built-in
fun priceUpdates(): Flow<Price> = flow {
    while (true) {
        emit(api.fetchPrice())
        delay(5_000)
    }
}
```

---

## 5. Error Handling

**Do**
- Model expected failure as a sealed type (`Result<T, E>`, `Either`, or your own sealed interface) — don't use exceptions for control flow
- Use `runCatching` for wrapping risky calls, but **always** rethrow `CancellationException`
- Use `require(condition) { "msg" }` for argument preconditions, `check(condition) { "msg" }` for state preconditions, `error("msg")` for unreachable branches
- Let unexpected exceptions propagate to a boundary handler (CoroutineExceptionHandler, global handler)

**Don't**
- Swallow exceptions with an empty `catch`
- Return `null` to signal failure when the caller can't distinguish "not found" from "error"
- Catch `Exception` broadly inside a coroutine and forget to rethrow `CancellationException`

```kotlin
// Rethrow CancellationException
suspend fun safeLoad(): Data? = runCatching { repo.load() }
    .onFailure { if (it is CancellationException) throw it }
    .getOrNull()

// Preconditions
fun transfer(amount: BigDecimal, balance: BigDecimal) {
    require(amount > BigDecimal.ZERO) { "Amount must be positive" }
    check(balance >= amount) { "Insufficient funds" }
}
```

---

## 6. Footguns

**Do**
- Remember `==` calls `equals()` (structural); `===` is referential identity — use `==` for value comparison
- Override `equals`/`hashCode` together; if a `data class` field is an array, wrap it in a `List` or override manually
- Initialize properties in declaration order — the compiler doesn't reorder, and `init` blocks run top-to-bottom
- Check for integer overflow when arithmetic can exceed `Int.MAX_VALUE`; use `Long` or `safeAdd`

**Don't**
- Overload `companion object` as a bag of statics — split into top-level functions or dedicated objects
- Access a `companion object` property in the primary constructor body — init order will bite you
- Rely on SAM conversions with overloaded Java methods — be explicit with the functional interface type

```kotlin
// Array field in data class — equals broken
data class Tag(val codes: IntArray)  // BAD: equals compares reference

data class Tag(val codes: List<Int>) // GOOD

// == vs ===
val a = "hello"
val b = String(charArrayOf('h','e','l','l','o'))
println(a == b)   // true  (structural)
println(a === b)  // false (different objects on JVM)
```

---

## 7. API & Structure

**Do**
- Default to `private`, then `internal` — widen only when needed
- Enable explicit API mode for libraries (`explicitApi()` in Gradle) so public surface is intentional
- Prefer top-level functions over single-method objects/classes
- Use `internal` for module-private implementation details
- For multiplatform: `expect`/`actual` at the boundary; keep common code in `commonMain` and platform code minimal

**Don't**
- Make everything `public` by default — you'll regret it when you need to refactor
- Create `*Manager`, `*Helper`, `*Util` classes — they're organizational laziness; put logic where it belongs
- Expose implementation types in public APIs when an interface suffices

```kotlin
// explicitApi() forces you to declare visibility and return types
public fun User.displayName(): String = "$firstName $lastName"

// top-level > single-method class
fun formatCurrency(amount: BigDecimal, locale: Locale): String = ...
```

---

## References

Bundled deep-dives — load the file when the task reaches it.

- **`references/tooling-and-limits.md`** — ktlint, detekt, Gradle Kotlin DSL, convention plugins, the size and complexity budget table, `detekt.yml` and `.editorconfig` thresholds, and "Getting back under budget". Read when setting up or fixing the project's gates, or when a function, class, or file is over budget.
- **`references/project-layout.md`** — one public type per file, PascalCase file naming, sealed hierarchies in one file, package-by-feature, Gradle module trees, version catalogs, and `api` vs `implementation`. Read when starting a project, adding a module, or deciding where a file goes.
- **`references/testing.md`** — JUnit 5 and Kotest, backtick test names, MockK and hand-written fakes, `runTest` virtual time, Turbine, Testcontainers, Kover, and the Android test split. Read when writing or reviewing tests.
