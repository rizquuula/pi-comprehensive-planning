# C++ Testing

Reference for `cpp-best-practices`. Test mechanics for C++ — GoogleTest, Catch2, sanitizer tiers, fuzzing, and benchmarks.

---

## Testing

Mechanics only — for the red-green-refactor process and how wide to sweep per change, use `test-driven-development`.

**Do**
- Pick **one** framework per repo. **GoogleTest** when you want fixtures, parametrized suites, death tests, and GoogleMock in one package, and don't mind the heavier macro surface and build. **Catch2** when you want header-light setup, expression-decomposing `REQUIRE(a == b)` (no `EXPECT_EQ` vocabulary to learn), and `SECTION`s that re-run setup per branch — at the cost of no built-in mocking and slower compiles on large suites
- Name the test after the behavior: `TEST_F(InvoiceServiceTest, DeclinesChargeWhenCardExpired)` — the failure line should read as a bug report
- `TEST_F` fixtures for shared setup; keep the fixture small — a fixture nobody can read is the mystery guest
- `TEST_P` + `INSTANTIATE_TEST_SUITE_P` for table cases; in Catch2, `GENERATE` for the same thing and `SECTION` where each case needs fresh setup
- `EXPECT_*` by default — it records the failure and keeps going, so one run reports every broken assertion. `ASSERT_*` only when continuing would crash or make later assertions meaningless (null check before dereference, `ASSERT_TRUE(result.has_value())` before `*result`). `ASSERT_*` in a helper function returns from the *helper*, not the test — return `void` and check `HasFatalFailure()` in the caller
- `EXPECT_THROW` for the type plus a message check when the message carries meaning — a bare `EXPECT_THROW(f(), std::runtime_error)` passes on the wrong `runtime_error`
- `EXPECT_DEATH` / `EXPECT_DEBUG_DEATH` for assertion and contract-violation paths; they fork, so keep them few and out of threaded fixtures
- Hand-written fakes implementing the interface for anything stateful — an in-memory `InvoiceRepository` beats six `EXPECT_CALL` lines. Reach for **GoogleMock** only when the *interaction itself* is the contract (was the retry issued? was commit called exactly once?)
- Inject clocks, RNG, and ID generators through constructor parameters — never call `std::chrono::system_clock::now()` or a global engine inside the logic
- **Test move, copy, and self-assignment explicitly** — C++ owes tests no other language does. A moved-from object must be destructible and assignable; `x = x` must not corrupt; a copy must be independent. These are exactly the paths a hand-written Rule-of-5 gets wrong
- Run the suite under **ASan+UBSan** as a first-class CI tier, and under **TSan** for any threaded code — same tests, different build, and they find what assertions cannot. Sanitizer builds are separate CMake presets, not flags bolted onto the release build
- `valgrind --error-exitcode=1` where sanitizers aren't available (old toolchains, some cross-compile targets) — much slower, no rebuild needed
- **libFuzzer** for parsers, deserializers, and anything reading untrusted bytes; commit the corpus and run the seeds as regular tests
- **Google Benchmark** in `benchmarks/`, never in the test target — benchmarks are not pass/fail and must not gate CI on machine noise
- Wire everything through `ctest` (`gtest_discover_tests`), and label tiers so `ctest -L unit` stays fast
- `find_package(GTest)` when vcpkg/Conan provides it; `FetchContent` when you need a pinned version reproducibly with no system dependency
- `std::filesystem::temp_directory_path()` plus a unique subdirectory for file tests, removed in the fixture's destructor — never a hardcoded `/tmp/test.txt`
- Coverage via `gcovr` or `llvm-cov` as a gap-finder — read it to find the untested error branch; failing the build on a global percentage just breeds assertion-free tests

```cpp
// Parametrized table: the expectation lives in the table, never in a branch.
struct FeeCase {
    std::string_view kind;
    double           amount;
    double           expected;
};

class FeeTest : public testing::TestWithParam<FeeCase> {};

TEST_P(FeeTest, AppliesRatePerKind) {
    const auto& [kind, amount, expected] = GetParam();
    const auto fee = Fee(kind, amount);

    ASSERT_TRUE(fee.has_value()) << "kind=" << kind;   // fatal: *fee follows
    EXPECT_DOUBLE_EQ(*fee, expected);
}

INSTANTIATE_TEST_SUITE_P(
    KnownKinds, FeeTest,
    testing::Values(FeeCase{"wire", 100.0, 3.0},
                    FeeCase{"ach", 100.0, 1.0},
                    FeeCase{"wire", 0.0, 0.0}),
    [](const testing::TestParamInfo<FeeCase>& info) {
        return std::string(info.param.kind) + "_" + std::to_string(info.index);
    });

TEST(FeeTest, RejectsUnknownKind) {
    EXPECT_EQ(Fee("crypto", 100.0).error(), FeeError::kUnknownKind);
}
```

```cpp
// The C++-specific obligation: value semantics are behavior, so test them.
TEST(BufferTest, MoveLeavesSourceValidAndEmpty) {
    Buffer src(1024);
    Buffer dst = std::move(src);

    EXPECT_EQ(dst.size(), 1024u);
    EXPECT_EQ(src.size(), 0u);      // valid-but-unspecified: we specify it, then test it
    src = Buffer(8);                // moved-from must still be assignable
    EXPECT_EQ(src.size(), 8u);
}

TEST(BufferTest, SelfAssignmentIsHarmless) {
    Buffer b(16);
    b = b;                          // NOLINT(clang-diagnostic-self-assign-overloaded)
    EXPECT_EQ(b.size(), 16u);
}
```

```cmake
# tests/CMakeLists.txt
include(FetchContent)
FetchContent_Declare(googletest
    GIT_REPOSITORY https://github.com/google/googletest.git
    GIT_TAG        v1.15.2)          # pinned, never a branch name
FetchContent_MakeAvailable(googletest)

add_executable(billing_test unit/billing/invoice_service_test.cpp)
target_link_libraries(billing_test PRIVATE myapp_billing GTest::gtest_main)

include(GoogleTest)
gtest_discover_tests(billing_test PROPERTIES LABELS unit)
```

```bash
cmake --preset asan && ctest --preset asan --output-on-failure   # same tests, UB-checked build
```

**Don't**
- Mix GoogleTest and Catch2 in one repo — two runners, two CMake integrations, two idioms for no benefit
- `ASSERT_*` where `EXPECT_*` would do — it hides every later failure in that test, so each run reports one problem at a time
- `std::this_thread::sleep_for` to wait for anything — inject the clock, or poll a condition with a timeout
- Network, real credentials, or a developer's own database in the unit tier — that tier must run offline in milliseconds
- Test a template only at one instantiation when the interesting behavior is per-type — instantiate the test over the types that matter
- `EXPECT_CALL` on every collaborator until the test mirrors the implementation line by line — that pins the wiring, not the behavior
- Compute the expected value with the same formula the code uses — the test then agrees with the bug
- Skip the sanitizer tier because "the tests pass" — a green suite over undefined behavior is exactly the failure mode sanitizers exist for
- Treat coverage percentage as a target, or benchmark timings as an assertion — the first breeds empty tests, the second breeds flaky CI
- Leave a flaky test disabled (`DISABLED_`) without diagnosing it — in C++ flakiness is usually a real data race, and TSan will name it
