# C++ Tooling, Size & Complexity Limits

Reference for `cpp-best-practices`. The build, format, lint, and sanitizer gates, plus the budgets that say when code has outgrown its unit.

---

## Tooling

**Do**
- Build with **CMake** (modern, target-based: `target_link_libraries`, `target_include_directories`, `target_compile_features(... cxx_std_20)`) — no global `include_directories`
- Manage deps with **vcpkg** or **Conan**; pin versions and commit the lockfile/manifest
- Enforce `clang-format` (commit a `.clang-format`) and `clang-tidy` (`bugprone-*`, `modernize-*`, `cppcoreguidelines-*`, `performance-*`) in CI
- Run **sanitizers** in CI: AddressSanitizer (`-fsanitize=address`), UBSan (`-fsanitize=undefined`), ThreadSanitizer for threaded code — they catch UB tests alone miss (wired as a test tier — see `testing.md`)
- Treat warnings as errors: `-Wall -Wextra -Wpedantic -Werror` (MSVC: `/W4 /WX`)
- Export `compile_commands.json` (`-DCMAKE_EXPORT_COMPILE_COMMANDS=ON`) — clang-tidy, clangd, and IWYU all read it
- `cppcheck` and (where licensed) clang static analyzer for an extra pass

**Don't**
- Hand-written Makefiles or raw `g++` invocations for anything multi-file — use CMake
- Ignore clang-tidy findings with blanket `// NOLINT` — fix or justify each inline
- Ship without at least ASan+UBSan having run the test suite once — memory bugs hide until production
- Vendor dependencies by copy-pasting headers when a package manager can pin them
- Mix C++ standard versions across translation units, or rely on compiler extensions (`-std=gnu++20` quirks) for portable code

```cmake
# CMakeLists.txt — modern target-based
add_library(core src/widget.cpp)
target_compile_features(core PUBLIC cxx_std_20)
target_compile_options(core PRIVATE -Wall -Wextra -Wpedantic -Werror)
target_include_directories(core PUBLIC include PRIVATE src)
```

Extend `.clang-tidy` with the size checks below to make the budgets enforceable.

---

## Size & Complexity Limits

Budgets, not gates — cross one and look for the seam, don't split mechanically at the boundary.

| Unit | Target | Pause | Refactor |
|---|---|---|---|
| Line length (`ColumnLimit`) | ≤ 100 chars | 120 | hard cap — let clang-format wrap |
| Function / method | ≤ 40 lines | 60 | 80 — extract, or it's doing two jobs |
| Class (whole definition) | ≤ 200 lines | 300 | 400 — split responsibilities |
| Public methods per class | ≤ 10 | 15 | 20 — the class is two interfaces |
| Header (`.hpp`) | ≤ 150 lines | 250 | 400 — pimpl, or split the class out |
| Source (`.cpp`) | 150–400 lines | 500 | 700 — one TU per class (see `project-layout.md`) |
| Parameters | ≤ 4 | 5 | 7 — pass a struct |
| Nesting depth | ≤ 3 | 4 | guard-clause it back down |
| Cyclomatic / cognitive complexity | ≤ 8 | 10 | 15 — split branches into named helpers |
| Template parameters | ≤ 2 | 3 | 4 — group into a traits struct |
| Inheritance depth | ≤ 2 | 3 | prefer composition over a fourth layer |
| Compile time per TU | ≤ 1 s | 3 s | 5 s — the include graph is the cost, not the code |

That last row is C++-specific and the one most teams never measure. A header pulled into 200 TUs multiplies its own parse cost 200×; `-ftime-trace` (Clang) plus ClangBuildAnalyzer names the offender in one build.

**Do**
- Enforce it in `.clang-tidy` so the numbers aren't folklore:

```yaml
# .clang-tidy
Checks: >
  bugprone-*,
  modernize-*,
  performance-*,
  cppcoreguidelines-*,
  readability-function-size,
  readability-function-cognitive-complexity,
  misc-no-recursion
WarningsAsErrors: 'readability-function-size,readability-function-cognitive-complexity'
CheckOptions:
  - key:   readability-function-size.LineThreshold
    value: '60'
  - key:   readability-function-size.StatementThreshold
    value: '40'
  - key:   readability-function-size.BranchThreshold
    value: '10'
  - key:   readability-function-size.ParameterThreshold
    value: '5'
  - key:   readability-function-size.NestingThreshold
    value: '4'
  - key:   readability-function-cognitive-complexity.Threshold
    value: '15'
  - key:   readability-function-cognitive-complexity.IgnoreMacros
    value: 'true'
```

`google-readability-function-size` is an alias of `readability-function-size` — enable one, not both, or every violation is reported twice. `misc-no-recursion` is in the list because a recursive call cycle defeats every static size estimate.

```yaml
# .clang-format
BasedOnStyle: Google
ColumnLimit: 100
```

- Measure the header cost, don't guess: `clang++ -ftime-trace` per TU, and keep the top offenders on a watch list
- Count *logical* lines — a 400-line `.cpp` that is 250 lines of a generated lookup table is fine
- Budget the class definition, not the file: a 180-line header holding one 170-line class is over budget on the class, not the header

**Don't**
- `// NOLINT(readability-function-size)` sprinkled to dodge the check — fix it or justify it inline with a reason
- Long functions kept whole because "the steps are sequential" — sequential steps name well
- Split a coherent class into `WidgetPart1` / `WidgetPart2` to get under the line budget — a class too big for one file is two classes
- Count a `switch` over a 40-value `enum` against cognitive complexity if every arm is a one-line mapping — that's a table (see move 3), not branching logic
- Add a template parameter "for flexibility" with one instantiation — it costs compile time and error-message clarity for nothing

### Getting back under budget

Complexity is branches × nesting; compile time is includes × fan-out. Work down this list in order — the first three fix most violations.

**1. Guard clauses — invert and return early.** Kills nesting depth outright.

```cpp
// depth 4
Receipt* charge(Order* order) {
    if (order != nullptr) {
        if (!order->items().empty()) {
            if (order->customer().is_active()) {
                return gateway_.charge(order->total());
            }
        }
    }
    return nullptr;
}

// depth 1
std::optional<Receipt> charge(const Order& order) {
    if (order.items().empty())          return std::nullopt;
    if (!order.customer().is_active())  return std::nullopt;
    return gateway_.charge(order.total());
}
```

**2. Extract free helpers into an anonymous namespace in the `.cpp`.** Unlike a private member function, this adds nothing to the header, gets internal linkage, and is invisible to every consumer — so it costs zero rebuild fan-out.

```cpp
// widget.cpp
namespace {

[[nodiscard]] bool IsExpired(const Token& t, std::chrono::system_clock::time_point now) {
    return t.expires_at() <= now;
}

}  // namespace
```

**3. Dispatch table over `if`/`else if` chains.** An 8-branch chain becomes complexity 1 and grows without touching the function.

```cpp
// complexity 8
double Fee(std::string_view kind, double amount) {
    if (kind == "wire")     return amount * 0.03;
    else if (kind == "ach") return amount * 0.01;
    // ... six more
}

// complexity 1, and new kinds are data
namespace {
const std::unordered_map<std::string_view, double> kRates{
    {"wire", 0.03}, {"ach", 0.01},
};
}  // namespace

std::expected<double, FeeError> Fee(std::string_view kind, double amount) {
    const auto it = kRates.find(kind);
    if (it == kRates.end()) return std::unexpected(FeeError::kUnknownKind);
    return amount * it->second;
}
```

When the branches carry *different payloads* rather than different constants, that's `std::variant` + `std::visit`: the compiler then checks exhaustiveness for you and the `default:` arm disappears.

```cpp
template <class... Ts> struct overloaded : Ts... { using Ts::operator()...; };
template <class... Ts> overloaded(Ts...) -> overloaded<Ts...>;

using Event = std::variant<Deposit, Withdrawal, Transfer>;

Money Apply(const Event& e, Money balance) {
    return std::visit(overloaded{
        [&](const Deposit& d)    { return balance + d.amount; },
        [&](const Withdrawal& w) { return balance - w.amount; },
        [&](const Transfer& t)   { return balance - t.amount - t.fee; },
    }, e);
}
```

**4. Parameter struct with designated initializers past ~5 params.** Seven positional params is a call site nobody can read and a swapped-argument bug waiting to happen; the struct is also where validation lands.

```cpp
// over
Connection Connect(std::string host, int port, int timeout_ms, int retries,
                   bool tls, bool keepalive, std::string ca_path);

// prefer
struct ConnectOptions {
    std::string host;
    int         port          = 443;
    std::chrono::milliseconds timeout{5000};
    int         retries       = 3;
    bool        tls           = true;
    bool        keepalive     = true;
    std::string ca_path;
};
Connection Connect(const ConnectOptions& opts);

auto conn = Connect({.host = "db.internal", .retries = 5});   // C++20 designated init
```

**5. Strong typedefs instead of primitive soup.** `Charge(int, int, int)` compiles happily with the arguments in any order; `Charge(UserId, AccountId, Cents)` does not. It also deletes the validation branches from every caller.

```cpp
template <typename Tag, typename T>
class StrongId {
public:
    explicit constexpr StrongId(T v) noexcept : value_(v) {}
    [[nodiscard]] constexpr T get() const noexcept { return value_; }
    friend bool operator==(StrongId, StrongId) = default;
private:
    T value_;
};
using UserId    = StrongId<struct UserIdTag, std::int64_t>;
using AccountId = StrongId<struct AccountIdTag, std::int64_t>;
```

**6. Pimpl to shrink a header and cut rebuild fan-out.** The header stops naming private members, so it stops including their headers — every consumer's rebuild set shrinks with it. Costs one heap allocation and one indirection; not for hot value types.

```cpp
// gateway.hpp — no <openssl/...>, no <unordered_map>, no private member types
class Gateway {
public:
    explicit Gateway(GatewayConfig cfg);
    ~Gateway();                                   // must be out-of-line: Impl is incomplete here
    Gateway(Gateway&&) noexcept;
    Gateway& operator=(Gateway&&) noexcept;

    [[nodiscard]] std::expected<Receipt, ChargeError> Charge(Cents amount);

private:
    class Impl;
    std::unique_ptr<Impl> impl_;
};
```

**7. Split a god class along its data cohesion.** Group the members by which fields each method actually touches; two clusters that never overlap are two classes that were sharing a `this`. That is the seam — not "the file got long".

**8. Virtual dispatch or CRTP instead of a runtime type switch.** When the same `if (kind == ...)` chain appears in more than two functions, the kind is a type wearing a tag. One class per variant and the dispatch disappears; use CRTP (`template <class Derived> class Base`) instead of `virtual` only when the call is hot and the type is known statically.

**9. RAII wrappers absorb cleanup branches.** Every `goto cleanup`, duplicated `close()`, or `if (failed) { unlock(); return; }` is a destructor that was never written. One wrapper deletes the branch from every path at once — this is RAII (SKILL.md §2) applied as a complexity tool.

**10. `std::ranges` pipelines replacing nested loops.** A filter-transform-collect loop with `continue` and an inner accumulator collapses into one expression with no branches to count.

```cpp
// over: nested loop, depth 3, two continues
// prefer
auto active_names = accounts
    | std::views::filter([](const Account& a) { return a.is_active(); })
    | std::views::transform(&Account::name)
    | std::views::take(50);
```

**11. Move template definitions to a `-inl.hpp`.** Template bodies must be visible, but they don't have to be in the reader's way: keep declarations and the class shape in `matrix.hpp`, put the definitions in `matrix-inl.hpp`, and `#include "matrix-inl.hpp"` on the last line of `matrix.hpp`. The interface stays under budget; the instantiation still works.

**Don't** trade complexity for indirection: five one-line helpers called once each, in order, is the same function with extra jumps. Extract when the piece has a name, a boundary, and ideally its own test — not to satisfy the linter.
