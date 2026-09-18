# Kotlin Class Granularity & Project Layout

Reference for `kotlin-best-practices`. Where a Kotlin declaration lives — file granularity, naming, packages, and Gradle module layout.

---

## Class & File Granularity

Kotlin permits any number of top-level declarations per file, so this is a **convention**, not a language rule — the compiler will never complain. Adopt it deliberately and write it down, because "one class per file" enforced by nobody drifts back to `Models.kt` within a quarter.

**Do**
- **One primary public class or interface per file**, named after it in **PascalCase**: `InvoiceService` → `InvoiceService.kt`. This is Kotlin/JVM convention (and what `ktlint_standard_filename` checks) — never snake_case, never `invoice_service.kt`
- Keep a **sealed hierarchy's subclasses in the same file as the parent**. Kotlin ≤1.4 required it, `sealed interface` still requires the same package and module, and — more importantly — the whole closed set is the unit you reason about. Reading `PaymentResult.kt` should show you every possible result
- Group small, tightly-coupled DTOs in one file when they are a single wire contract: `CheckoutRequest`, `CheckoutLine`, `CheckoutResponse` in `CheckoutDtos.kt` is honest; five unrelated domain entities in `Models.kt` is not
- Put a type's extension functions in `<Type>Extensions.kt` next to the type — `OrderExtensions.kt` beside `Order.kt`
- **Top-level functions are legitimate Kotlin.** Unlike languages where everything must be a method, a pure function with no state (`fun formatIban(raw: String): String`) belongs at top level, in a file named for its subject (`IbanFormatting.kt`), not bolted onto a class as a fake static. The test is state: no state and no polymorphism → top-level function; state or substitutability → class
- Keep **package = directory**. Kotlin lets the package declaration diverge from the path; don't use it — every tool, reviewer and newcomer assumes they match, and IDE "move file" silently breaks the divergent case
- Use `internal` as the module boundary: types an adapter needs but consumers must not see are `internal`, which combines with Gradle module boundaries (see Project Layout below) into an actually enforced surface
- Put a `companion object` in its owner's file, at the bottom, and keep it to factories and constants for *that* type. A standalone `object` (a registry, a stateless strategy) gets its own file, named after it
- Promote a package to a Gradle module when it has an independent consumer, an independent test suite that is slow, or a dependency the rest of the codebase must not gain (see Project Layout below)

```
src/main/kotlin/com/app/billing/
├── Invoice.kt                     # data class Invoice — the entity
├── InvoiceDraft.kt                # data class InvoiceDraft with init validation
├── InvoiceExtensions.kt           # fun Invoice.isOverdue(now: Instant): Boolean
├── InvoiceService.kt              # class InvoiceService — one public class
├── InvoiceRepository.kt           # interface InvoiceRepository — the port
├── PaymentResult.kt               # sealed interface + ALL subclasses, one file on purpose
├── BillingError.kt                # sealed class BillingError + subtypes
├── IbanFormatting.kt              # top-level pure functions, no owning type
└── postgres/
    └── PostgresInvoiceRepository.kt   # internal class — the adapter
```

The one narrow exemption beyond sealed hierarchies and DTO groups: a `private` helper class usable only by its owner — an internal cursor, a builder's state machine — may stay in the owner's file. It is an implementation detail, not a second public type.

**Don't**
- `Utils.kt`, `Helpers.kt`, `Models.kt`, `Constants.kt` — grab-bags with no cohesion, guaranteed merge conflicts, and a `git log` that tells you nothing. Constants belong on the type or in the `companion object` that owns them
- Multiple unrelated public classes in one file to "keep related things together" — the *package* carries cohesion, the file carries identity
- A file whose name doesn't match its primary type — grep-by-filename stops finding definitions
- Splitting a sealed hierarchy across files to satisfy one-class-per-file — the rule loses to exhaustiveness here
- `object Utils { fun ... }` as a static holder — that is a top-level function wearing a namespace
- Splitting one class over two files (`OrderService.kt` + `OrderServiceImpl2.kt`) to duck the `LargeClass` threshold — see `tooling-and-limits.md`

---

## Project Layout

**Do**
- Standard Gradle source sets: `src/main/kotlin`, `src/test/kotlin`, resources in `src/main/resources`
- Package by feature, not by layer (`com.app.order`, not `com.app.controllers`)
- Mirror the package path in the directory tree; one top-level public type per file, named after it (see Class & File Granularity above)
- One `gradle/libs.versions.toml` version catalog as the single source of dependency versions across every module
- Root-level `detekt.yml`, `.editorconfig` and `gradle.properties` — one config, all modules
- Multi-module Gradle once build times, ownership, or dependency direction demand it — one module per bounded context / feature, a `build.gradle.kts` per module

**Small library** — the floor; don't build more structure than this until it hurts:

```
mylib/
├── settings.gradle.kts             # rootProject.name; no subprojects yet
├── build.gradle.kts                # kotlin jvm, explicitApi(), detekt, ktlint, kover
├── gradle.properties               # org.gradle.caching=true, kotlin.code.style=official
├── gradle/
│   └── libs.versions.toml          # [versions] [libraries] [plugins] — single source
├── config/detekt/detekt.yml        # thresholds from tooling-and-limits.md
├── .editorconfig                   # max_line_length = 120, ktlint_standard_*
└── src/
    ├── main/kotlin/com/example/mylib/
    │   ├── Parser.kt               # class Parser
    │   ├── ParseResult.kt          # sealed interface + subclasses
    │   └── internal/               # `internal` visibility, no stability guarantee
    │       └── TokenBuffer.kt
    ├── main/resources/
    └── test/kotlin/com/example/mylib/
        └── ParserTest.kt
```

**Multi-module application** — module boundaries carry the dependency direction:

```
myapp/
├── settings.gradle.kts             # include(":domain", ":billing", ":adapter-postgres", ":app")
├── build.gradle.kts                # plugins declared `apply false`; per-module config lives below
├── gradle.properties               # org.gradle.parallel=true, jvmargs, kotlin.incremental
├── gradle/libs.versions.toml
├── build-logic/                    # convention plugins — preferred over buildSrc:
│   └── src/main/kotlin/            #   buildSrc invalidates every module's cache on any change
│       ├── kotlin-conventions.gradle.kts     # jvmTarget, warnings-as-errors, detekt, ktlint
│       └── testing-conventions.gradle.kts    # junit5, kover, mockk
├── config/detekt/detekt.yml
├── .editorconfig
├── docker-compose.yml
├── migrations/                     # flyway/liquibase; never edit an applied migration
├── domain/                         # pure business logic — depends on NOTHING
│   ├── build.gradle.kts            # no framework deps: no ktor, no jdbc, no spring
│   └── src/main/kotlin/com/app/domain/
│       ├── order/                  # package-by-feature INSIDE the module
│       │   ├── Order.kt
│       │   ├── OrderId.kt          # value class — no primitive obsession
│       │   ├── OrderRepository.kt  # the port, defined by the consumer
│       │   └── OrderError.kt       # sealed hierarchy, one file
│       └── billing/
│           └── Invoice.kt
├── billing/                        # a use-case module: depends on :domain only
│   ├── build.gradle.kts
│   └── src/
│       ├── main/kotlin/com/app/billing/InvoiceService.kt
│       └── test/kotlin/com/app/billing/InvoiceServiceTest.kt
├── adapter-postgres/               # outbound adapter: implements :domain ports
│   ├── build.gradle.kts            # jdbc/exposed deps live HERE, not in :domain
│   └── src/
│       ├── main/kotlin/com/app/adapter/postgres/PostgresOrderRepository.kt
│       └── test/kotlin/            # testcontainers integration tests
├── adapter-http/                   # inbound adapter: ktor/spring routes, DTOs, mapping
│   └── src/main/kotlin/com/app/adapter/http/
│       ├── OrderRoutes.kt
│       └── OrderDtos.kt
└── app/                            # the only module that knows every other one
    ├── build.gradle.kts            # application plugin, mainClass
    └── src/main/kotlin/com/app/Main.kt   # config load + DI wiring, nothing else
```

**Dependencies point inward.** `:app` → everything; adapters → `:domain`; `:domain` → nothing. Enforce it structurally, not by review:

```kotlin
// billing/build.gradle.kts
dependencies {
    api(projects.domain)              // Order, OrderRepository appear in this module's signatures
    implementation(libs.kotlinx.coroutines.core)  // NOT on the consumer's compile classpath
}

// domain/build.gradle.kts
dependencies {
    implementation(libs.kotlinx.datetime)  // and nothing else — no framework may enter here
}
```

- `implementation` by default, `api` only when the type genuinely appears in your public signatures. Every `api` leaks a transitive dependency to consumers and makes the graph unenforceable
- The module graph itself is the enforcement: `:domain` cannot import `:adapter-postgres` because it does not depend on it — the code will not compile. That is stronger than any lint rule
- For rules *inside* a module (naming, "no entity imports a DTO", "every repository ends in `Repository`"), use **Konsist** (Kotlin-native, reads the AST) or **ArchUnit** (JVM bytecode, mature) as an ordinary test in `src/test/kotlin`

**Don't**
- Layer-first packages (`controllers/`, `services/`, `models/`) that scatter one feature across the tree
- One giant module — split by feature once build times or coupling hurt
- Multiple unrelated public classes crammed into one `.kt` file (see Class & File Granularity above)
- A `common/`, `core/` or `shared/` module — it becomes the dumping ground every module depends on, and the dependency graph goes back to a ball of mud
- Version numbers inline in `build.gradle.kts` when a version catalog exists — two sources of truth
- `buildSrc` for new projects: any change to it invalidates the build cache for every module; `build-logic` as an included build does not
- A framework dependency in the domain module — one `@Entity` annotation and the domain now depends on JPA forever
- Business logic in route handlers or repositories — routes parse, delegate, serialize; repositories map, nothing else
- Reading environment variables outside the config object loaded in `Main.kt`
