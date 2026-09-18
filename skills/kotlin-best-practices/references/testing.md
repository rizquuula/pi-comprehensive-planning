# Kotlin Testing

Reference for `kotlin-best-practices`. Test mechanics for Kotlin — JUnit 5, Kotest, MockK, coroutine tests, and coverage.

---

## Testing

Mechanics only — for the red-green-refactor process and how wide to sweep per change, use `test-driven-development`.

**Do**
- **JUnit 5 as the default; Kotest when the suite is large enough to earn it.** JUnit 5 is what every tool, IDE and CI integration assumes, and `@ParameterizedTest` covers most table-driven needs. Kotest buys expressive specs, first-class `withData`, built-in property testing and better coroutine ergonomics — at the cost of a second mental model and thinner IDE support. Pick one per repo; mixing means two runners and two sets of matchers
- Name tests after the behavior, using **backtick names** — the Kotlin idiom, and the failure line reads as a bug report: ``fun `declines the charge when the card is expired`()``
- Arrange–Act–Assert, one behavior per test; several assertions on *one* outcome is fine
- Assert on observable behavior — return values, thrown errors, persisted rows — never on internal call order
- Rich matchers over bare `assertEquals`: AssertJ (`assertThat(x).isEqualByComparingTo(...)`) or Kotest matchers (`x shouldBe y`, `list shouldContainExactly ...`). `assertEquals(expected, actual)` on a `BigDecimal` fails on scale; on a list it prints an unreadable diff
- Match the message when asserting failures — a bare type assertion passes on the wrong exception:
  `assertThrows<InsufficientFunds> { ... }.message shouldContain "acct-42"`, or Kotest's `shouldThrow<T> { }`
- **Prefer hand-written fakes to mocks for anything stateful** — an in-memory class implementing the repository interface beats six `every { } returns` lines and survives refactors. Reach for MockK at boundaries you own, sparingly
- MockK for the rest: `mockk<PaymentGateway>()`, `every { }` / `coEvery { }` for suspend, `verify` / `coVerify`. Treat `relaxed = true` as a last resort — it silently returns defaults for calls you never intended, so a method added to the interface is stubbed to `null`/`0` with no test failure
- `runTest { }` from `kotlinx-coroutines-test` for every suspend test — it uses virtual time, so a `delay(30.seconds)` completes instantly and a hung coroutine fails the test instead of the build timing out
- `advanceUntilIdle()` / `advanceTimeBy()` to drive scheduled work; inject a `TestDispatcher` (`StandardTestDispatcher(testScheduler)`) through the constructor
- Treat `Dispatchers.setMain` as an Android-only affordance. Outside Android it is a smell: it means the class hardcoded a dispatcher instead of taking one. Inject `CoroutineDispatcher` (or a `CoroutineScope`) as a constructor parameter with a production default
- Test `Flow` with **Turbine**: `flow.test { awaitItem(); awaitComplete() }`. It fails on unconsumed emissions, which a plain `toList()` silently swallows
- Test the cancellation and timeout paths explicitly — cancel the job and assert cleanup ran, or wrap in `withTimeout` and assert `TimeoutCancellationException`
- Inject `Clock`, `Random` and ID generators rather than mocking statics — `Clock.fixed(instant, ZoneOffset.UTC)` and `Random(seed)` are deterministic without bytecode tricks. `mockkStatic(Instant::class)` is global mutable state in a test suite
- **Testcontainers** for integration tests against the real engine — H2 standing in for Postgres tests a different database
- `@TempDir` (JUnit 5) for filesystem tests; never write to a fixed path under `/tmp`
- Coverage via **Kover** (Kotlin-native, understands inline functions and coroutine state machines better than JaCoCo) as a **gap-finder**, not a gate — a global percentage threshold breeds assertion-free tests
- Property testing with Kotest's `checkAll` where an invariant is easy to state and examples are not: round-trips, parsers, money arithmetic

```kotlin
class FeeTest {

    @ParameterizedTest(name = "{0} on {1} = {2}")
    @CsvSource(
        "WIRE, 100.00, 3.00",
        "ACH,  100.00, 1.00",
        "WIRE, 0.00,   0.00",
    )
    fun `applies the configured rate per fee kind`(
        kind: FeeKind,
        amount: BigDecimal,
        expected: BigDecimal,
    ) {
        assertThat(fee(kind, amount)).isEqualByComparingTo(expected)
    }

    @ParameterizedTest
    @MethodSource("invalidAmounts")
    fun `rejects non-positive amounts`(amount: BigDecimal) {
        val error = assertThrows<IllegalArgumentException> { fee(FeeKind.Wire, amount) }
        assertThat(error).hasMessageContaining("must be positive")
    }

    companion object {
        @JvmStatic
        fun invalidAmounts(): List<BigDecimal> =
            listOf(BigDecimal("-0.01"), BigDecimal("-100"))
    }
}
```

The same table in Kotest, where the cases stay typed:

```kotlin
class FeeSpec : FunSpec({
    withData(
        FeeCase(FeeKind.Wire, BigDecimal("100.00"), BigDecimal("3.00")),
        FeeCase(FeeKind.Ach, BigDecimal("100.00"), BigDecimal("1.00")),
    ) { (kind, amount, expected) ->
        fee(kind, amount) shouldBeEqualComparingTo expected
    }

    test("rejects unknown currency") {
        shouldThrow<UnsupportedCurrency> { fee(FeeKind.Wire, BigDecimal.ONE, "XYZ") }
            .message shouldContain "XYZ"
    }
})

data class FeeCase(val kind: FeeKind, val amount: BigDecimal, val expected: BigDecimal)
```

Coroutines, with an injected dispatcher and Turbine:

```kotlin
@Test
fun `emits loading then success`() = runTest {
    val vm = OrderViewModel(FakeOrderRepository(orders), dispatcher = StandardTestDispatcher(testScheduler))

    vm.state.test {
        awaitItem() shouldBe UiState.Loading
        advanceUntilIdle()
        awaitItem() shouldBe UiState.Success(orders)
        cancelAndIgnoreRemainingEvents()
    }
}

@Test
fun `releases the lock when the caller cancels`() = runTest {
    val job = launch { service.processLongRunning() }
    advanceTimeBy(100)
    job.cancelAndJoin()

    lock.isHeld shouldBe false
}
```

**Android note.** Keep JVM-only tests in `src/test/` (fast, no device) and anything needing a real framework in `src/androidTest/` (instrumented, slow, needs an emulator). **Robolectric** runs framework-dependent tests on the JVM in `src/test/` — use it for `Context`, resources and lifecycle glue, but not as proof that something works on a device: it reimplements the framework rather than running it. Reserve instrumented tests for what genuinely needs the real thing — Room migrations, WorkManager, Compose UI on-device, permissions. `Dispatchers.setMain(StandardTestDispatcher())` in an `@Before` is correct here, because `Dispatchers.Main` has no implementation in a JVM test.

**Don't**
- `Thread.sleep` or real `delay` on a production dispatcher to wait for anything — `runTest` gives you virtual time
- `runBlocking` in tests where `runTest` applies — you lose virtual time and cancellation checking
- Mockito for Kotlin — final-by-default classes and `suspend` functions fight it; use MockK
- `mockk(relaxed = true)` as the default, or `mockkStatic` / `mockkObject` on anything you own — that's a design problem being papered over
- `verify { }` as the only assertion in a test — that asserts your wiring, not your behavior
- Network calls, real credentials, or the developer's own database in unit tests — that tier runs offline in milliseconds
- Tests that depend on execution order or leak state through `object` singletons — each must pass alone
- Logic in tests: `if`, loops, or computing the expected value with the same formula the production code uses — the test then agrees with the bug
- Asserting on exact log strings or whole JSON blobs — assert the fields that carry meaning
- Chasing 100% coverage through `toString()` and getters; untested error and cancellation branches are the real gap
- `@Ignore`-ing or deleting a flaky test without diagnosing it — in coroutine code flakiness is usually a real race
