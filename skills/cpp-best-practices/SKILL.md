---
name: cpp-best-practices
description: Apply when writing, reviewing, or planning C++ code (.cpp/.cc/.hpp/.h files). Covers modern C++17/20/23, ranges, span/string_view, RAII, smart pointers, rule of 0/3/5, move semantics, const-correctness, exceptions, optional/expected, UB, dangling refs, templates, concepts, concurrency, performance, CMake, clang-tidy, vcpkg/conan; size and complexity budgets (clang-format ColumnLimit, readability-function-size, cognitive complexity, nesting, param count, pimpl); file granularity (one class per header/source pair, include-what-you-use, forward declarations); project layout (include/ and src/ split, CMake target visibility); testing (GoogleTest, Catch2, parametrized tests, sanitizers, libFuzzer, Google Benchmark, ctest). Use when the user mentions C++, CMake, RAII, move semantics, templates, UB, clang-tidy, sanitizers, function length, header layout, or C++ project structure.
---

# C++ Best Practices

Defaults for correct, safe, modern C++ (target **C++20**, reach for C++23 where available) — name the tradeoff when you skip one. Follow the [C++ Core Guidelines](https://isocpp.github.io/CppCoreGuidelines/); when unsure, the safe and RAII-shaped choice wins.

For naming, guard clauses, and function/file seams see `clean-code-standard`; for class/interface design and dependency direction see `solid-principle`; for external-input/auth/crypto surfaces see `secure-coding`; for test-first workflow see `test-driven-development`. `review-router` loads this skill automatically for C++ diffs and plans.

---

## 1. Modern Idioms

**Do**
- Target a modern standard (`-std=c++20`); use C++23 (`std::expected`, `std::print`, `std::mdspan`) where the toolchain allows
- `auto` when the type is obvious from the RHS or verbose (iterators, lambdas); spell the type out when it aids the reader
- Range-`for` over index loops: `for (const auto& x : items)` — `const auto&` by default, `auto&` to mutate, `auto` only to copy intentionally
- Reach for `<algorithm>` / `<ranges>` before hand-rolling loops: `std::ranges::sort`, `find_if`, `accumulate`, `transform`, `any_of`
- Structured bindings for pairs/tuples/structs: `auto [it, inserted] = map.try_emplace(k, v);`
- Uniform/brace init `{}` to construct — it forbids narrowing; but be aware `vector<int>{3,0}` ≠ `vector<int>(3,0)` (init-list wins)
- `std::string_view` for read-only string params, `std::span<T>` for read-only/contiguous array params — no copy, no `(ptr, len)` pairs
- `enum class` over plain `enum`; `constexpr`/`consteval` over macros for constants; `using` over `typedef`

**Don't**
- C-isms in new code: C arrays (use `std::array`/`std::vector`), `char*` strings, `NULL` (use `nullptr`), `#define` constants, C casts `(T)x`
- `using namespace std;` at namespace scope in a header — it leaks into every includer
- Output params via pointer when a return value (or struct/`tuple`) is clearer
- `std::endl` in loops — it flushes every call; use `'\n'`

```cpp
// prefer
std::vector<int> evens;
std::ranges::copy_if(nums, std::back_inserter(evens),
                     [](int n) { return n % 2 == 0; });

// over a manual index loop with .size()/[] and a C cast
```

---

## 2. RAII & Resource Management

RAII is the core of safe C++: every resource (memory, file, lock, socket, handle) is owned by an object that releases it in its destructor. Get this right and most leaks and double-frees vanish.

**Do**
- Tie every resource to an object's lifetime; let the destructor release it — no manual cleanup paths
- `std::unique_ptr<T>` for exclusive ownership (the default); `std::shared_ptr<T>` only when ownership is genuinely shared
- `std::make_unique<T>(...)` / `std::make_shared<T>(...)` — never naked `new`
- Pass ownership in signatures: `unique_ptr` by value to transfer, `T&`/`T*` to borrow without owning
- `std::weak_ptr` to break `shared_ptr` reference cycles (e.g. parent⇄child back-pointers)
- Custom deleters for C handles: `std::unique_ptr<FILE, decltype(&fclose)>`, or a small RAII wrapper
- `std::lock_guard` / `std::scoped_lock` / `std::unique_lock` for mutexes — never manual `lock()`/`unlock()`

**Don't**
- Naked `new`/`delete`, `malloc`/`free`, or `new[]`/`delete[]` in application code
- `shared_ptr` as the default — it costs an atomic refcount and obscures ownership; reach for it only when shared
- Return a raw owning pointer — the caller can't tell if they must `delete` it
- Store a `shared_ptr` to `this`-managed object without `enable_shared_from_this`
- Pass `shared_ptr` by value when the callee only reads — pass `const T&` and keep the refcount churn out

```cpp
auto conn = std::make_unique<Connection>(cfg);   // owns
use(*conn);                                       // borrows
return conn;                                      // moves ownership out

// C handle wrapped in RAII
std::unique_ptr<FILE, decltype(&std::fclose)> fp{std::fopen(path, "rb"), &std::fclose};
```

---

## 3. The Rule of 0 / 3 / 5

**Do**
- **Rule of 0** is the goal: design classes from RAII members (`vector`, `string`, `unique_ptr`) so the compiler-generated special members are correct — write none
- If you must write a destructor, copy ctor, copy assign, move ctor, or move assign, you almost certainly need **all five** (Rule of 5) — define or `= default`/`= delete` each
- `= default` the ones with correct default behavior; `= delete` to forbid copying (e.g. a handle owner)
- Mark move operations `noexcept` — containers only move (instead of copy) on reallocation when moves are `noexcept`
- Make base-class destructors `virtual` (or the class non-inheritable) when deleting through a base pointer

**Don't**
- Hand-write copy/move logic that managed members already handle — that's how double-frees and leaks creep in
- Define a destructor "just to log" — it suppresses move generation and silently de-optimizes the class
- Forget `noexcept` on moves — it quietly forces copies on `vector` growth

```cpp
class Buffer {
public:
    Buffer() = default;
    ~Buffer() = default;
    Buffer(const Buffer&) = delete;             // non-copyable
    Buffer& operator=(const Buffer&) = delete;
    Buffer(Buffer&&) noexcept = default;        // movable
    Buffer& operator=(Buffer&&) noexcept = default;
private:
    std::vector<std::byte> data_;               // member does the work → Rule of 0 for the rest
};
```

---

## 4. Value, Move & Const Semantics

**Do**
- Prefer value semantics; return by value and trust copy elision / RVO (don't `std::move` a local on `return` — it can disable RVO)
- `std::move` to transfer ownership of an object you're done with; the moved-from object is valid-but-unspecified — don't read it
- Take sink parameters by value then `std::move` into place; take read-only params by `const&` (or `string_view`/`span`)
- Perfect-forward in templates with `T&&` + `std::forward<T>(arg)` — only in deduced-`&&` (forwarding reference) context
- `const`-correct everything: member functions that don't mutate are `const`; locals are `const` by default; `constexpr` where evaluable at compile time
- Prefer references to pointers when the argument is required and non-owning; use a pointer (or `optional`) only when "none" is valid

**Don't**
- `const T` for by-value return types — it blocks move on the caller side
- `std::move` on a `const` object (silently copies) or on a value you still use afterward
- Pass large objects by value when you only read them — `const&`
- Return a reference or `string_view`/`span` to a local or temporary — instant dangle (see §6)

```cpp
class Widget {
public:
    explicit Widget(std::string name) : name_(std::move(name)) {}   // sink by value + move
    const std::string& name() const noexcept { return name_; }       // const accessor
private:
    std::string name_;
};
```

---

## 5. Error Handling

**Do**
- Use exceptions for failures that can't be handled locally; derive your types from `std::exception` and throw by value, catch by `const&`
- `std::optional<T>` for "value or nothing"; `std::expected<T, E>` (C++23) — or a `Result`-like type — for "value or error" without throwing on hot/expected paths
- Mark functions `noexcept` when they truly can't throw (move ops, swap, destructors, leaf computations) — it enables optimizations and is part of the contract
- Maintain the **strong exception guarantee** where feasible: do work on a copy/temp, then commit with a `noexcept` swap/move (copy-and-swap)
- Validate inputs at the boundary and fail fast; `assert` / `<cassert>` (or contracts) for programmer-error invariants, exceptions for runtime failures

**Don't**
- Use exceptions for ordinary control flow, or throw across an ABI / C boundary
- Let an exception escape a destructor or a `noexcept` function — that calls `std::terminate`
- Ignore error returns from C APIs / `std::error_code` overloads — check every one
- `catch (...)` and swallow silently; if you catch broadly, log and rethrow or translate
- Return raw error codes as `int` magic numbers when `enum class`/`expected` carries the meaning

```cpp
std::expected<Config, ParseError> parse(std::string_view text) noexcept;

if (auto cfg = parse(input)) {
    use(*cfg);
} else {
    log_error(cfg.error());
}
```

---

## 6. Correctness Footguns

C++ has no managed runtime — undefined behavior is silent and can "work" until it doesn't. Treat these as blockers.

**Do**
- Compile with `-Wall -Wextra -Wpedantic -Werror` and run **sanitizers** (ASan, UBSan, TSan) in CI — they catch UB the compiler can't (see `references/tooling-and-limits.md` and `references/testing.md`)
- Watch object lifetimes: never return/store a reference, pointer, `string_view`, or `span` outliving its referent; beware dangling from temporaries in range-`for` (`for (auto x : foo().items())` if `foo()` is a temporary owning the container)
- Treat iterator/reference invalidation as real: `push_back` may reallocate a `vector` (invalidates all); erasing mid-loop needs the `it = c.erase(it)` idiom
- Use signed integers for arithmetic/indices unless you need modular/bit semantics; never mix signed and unsigned in comparisons (`for (int i; i < v.size(); ++i)` mixes — cast or use `std::ssize`/`size_t` deliberately)
- Use `{}` init to reject narrowing; initialize every variable (no `int x;` then read)
- Know that member initialization runs in **declaration order**, not initializer-list order

**Don't**
- Rely on UB: signed overflow, out-of-bounds access, use-after-free/move, null deref, reading uninitialized memory, strict-aliasing violations, data races — all UB, all silent
- Compare floats with `==`; use an epsilon/relative comparison
- `reinterpret_cast` to pun types (aliasing UB) — use `std::bit_cast` (C++20) or `memcpy`
- Capture by reference in a lambda that outlives the captured locals (stored callbacks, detached threads) — capture by value/move instead
- Assume evaluation order of function arguments — it's unspecified

```cpp
// iterator-safe erase
for (auto it = v.begin(); it != v.end(); ) {
    if (should_remove(*it)) it = v.erase(it);
    else ++it;
}
// or, clearer:  std::erase_if(v, should_remove);   // C++20

// signedness: prefer
for (std::size_t i = 0; i < v.size(); ++i) { /* ... */ }   // or std::ssize(v) with int
```

---

## 7. Templates, Generics & Concepts

**Do**
- Constrain templates with **concepts** (C++20): `template <std::integral T>` or `requires`-clauses — readable signatures and far better error messages than SFINAE
- Prefer standard concepts (`std::integral`, `std::ranges::range`, `std::invocable`) and compose your own from them
- Use `if constexpr` for compile-time branching instead of tag dispatch / SFINAE overload sets
- Reach for templates to remove real duplication; keep heavy template logic in headers, instantiate explicitly when compile time hurts
- Use `<type_traits>` (`std::is_same_v`, `std::decay_t`, `std::remove_cvref_t`) and variadic templates with fold expressions for generic code

**Don't**
- Hand-roll `std::enable_if`/SFINAE when a concept or `if constexpr` expresses the constraint directly
- Over-generalize a function with one concrete caller — premature abstraction costs compile time and readability
- Leave templates unconstrained so misuse explodes deep in instantiation — constrain at the interface
- Forget that templates are duck-typed: an unconstrained `T` accepts anything until it fails to compile far from the call site

```cpp
template <std::ranges::range R>
    requires std::integral<std::ranges::range_value_t<R>>
auto sum(const R& r) {
    return std::accumulate(std::ranges::begin(r), std::ranges::end(r),
                           std::ranges::range_value_t<R>{});
}
```

---

## 8. Concurrency

**Do**
- `std::jthread` (C++20) over `std::thread` — it joins on destruction and supports `std::stop_token` cooperative cancellation
- Protect shared mutable state with `std::mutex` + `std::scoped_lock`; lock multiple mutexes at once with `scoped_lock` to avoid deadlock
- `std::atomic<T>` for simple shared counters/flags; default to `memory_order_seq_cst` and only relax with a proven, commented reason
- `std::condition_variable` with a predicate-checking `wait` (guards against spurious wakeups)
- `std::async` / `std::future` / `std::packaged_task` for one-shot results; a thread pool for many tasks
- `std::call_once` / function-local `static` for thread-safe lazy init (the latter is guaranteed thread-safe since C++11)

**Don't**
- Share mutable data across threads without synchronization — a data race is UB, not just a stale read
- Hold a lock across a blocking call or a callback you don't control (deadlock/priority inversion)
- Hand-roll lock-free code without deep memory-model knowledge and a TSan run — almost always wrong
- Detach threads that reference locals; capture-by-reference into a thread is a lifetime trap
- `volatile` for thread synchronization — it is **not** an atomic and provides no ordering

```cpp
std::mutex m;
std::vector<Task> queue;

void push(Task t) {
    std::scoped_lock lock(m);
    queue.push_back(std::move(t));
}

// jthread auto-joins; stop_token for cooperative shutdown
std::jthread worker([&](std::stop_token st) {
    while (!st.stop_requested()) process_next();
});
```

---

## 9. Performance & Memory

**Do**
- Measure first — profile (`perf`, VTune, Instruments) before optimizing; reason about cache and allocations, not micro-tricks
- `reserve()` containers when the size is known; prefer contiguous `vector`/`array` for cache locality
- Move instead of copy at ownership boundaries; pass `const&`/`string_view`/`span` to avoid copies on read
- `emplace_back`/`try_emplace` to construct in place; avoid temporaries
- Mark hot pure functions `constexpr`/`[[nodiscard]]`; let the optimizer inline rather than forcing it
- Prefer the stack and value types; reach for the heap only when lifetime or size demands it

**Don't**
- Optimize without a profile — intuition about C++ performance is usually wrong
- `std::list`/node-based containers by reflex — `vector` wins on cache locality for most workloads
- `shared_ptr` in hot paths for its atomic refcount; `std::endl`/synchronized I/O in loops
- Return huge containers by `const` value or via output params "to avoid a copy" — RVO already handles it
- Reach for `unsafe`-style raw pointers/casts for speed before measuring

```cpp
std::vector<Result> results;
results.reserve(inputs.size());                 // one allocation
for (const auto& in : inputs)
    results.emplace_back(transform(in));        // construct in place
```

---

## References

Bundled deep-dives — load the file when the task reaches it.

- **`references/tooling-and-limits.md`** — CMake, vcpkg/Conan, clang-format, clang-tidy, sanitizers, warning flags, the size and complexity budget table, and "Getting back under budget". Read when setting up or auditing a project's build and lint gates, or when a function, class, or header is over budget.
- **`references/project-layout.md`** — one class per header/source pair, file and namespace naming, include-what-you-use, forward declarations, the `include/` and `src/` split, and CMake target visibility. Read when starting a project, adding a feature directory, or deciding where a file goes.
- **`references/testing.md`** — GoogleTest versus Catch2, fixtures, parametrized suites, fakes over mocks, move and self-assignment tests, sanitizer tiers, libFuzzer, Google Benchmark, and ctest. Read when writing or reviewing tests.
