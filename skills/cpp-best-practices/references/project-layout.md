# C++ Class Granularity & Project Layout

Reference for `cpp-best-practices`. What belongs in one header/source pair, and where each file belongs in a CMake project.

---

## Class & File Granularity

C++ already pushes toward one class per translation unit — the header/source pair is the natural unit. Make it the rule.

**Do**
- **One public class per header/source pair.** `class InvoiceService` lives in `invoice_service.hpp` + `invoice_service.cpp` — the file tree is a class index
- Name the file after the class and **pick one casing convention, then be consistent**: `InvoiceService.hpp` (PascalCase, mirrors the type) or `invoice_service.hpp` (snake_case, matches the standard library and most CMake ecosystems). The examples here use snake_case. **The codebase's existing convention always wins over this preference** — a repo with mixed casing is worse than either choice
- Header holds: the class declaration, its public/protected interface, small `inline` accessors worth inlining, `constexpr` constants, and template definitions
- Source holds: every non-trivial definition, plus internal helpers in an **anonymous namespace** — those are invisible outside the TU and never appear in the header
- **Include what you use**: every name a file mentions comes from a header that file includes directly — never lean on a transitive include. Run `include-what-you-use` against `compile_commands.json`
- **Forward-declare instead of including** when only a reference, pointer, or return type is named — `class Order;` beats `#include "order.hpp"` and cuts the rebuild fan-out (`tooling-and-limits.md`, move 6)
- `#pragma once` in new code (supported by every mainstream compiler, no name collisions); traditional `SOMEPROJECT_MODULE_WIDGET_HPP_` include guards only if the project already uses them or targets an exotic toolchain — never both
- **One namespace per directory**, matching the path: `src/myproject/billing/*` → `namespace myproject::billing`. The include path, the namespace, and the directory then say the same thing
- Put implementation-only types in a nested `detail::` namespace (`myproject::billing::detail`) — it declares "not part of the API" in a way `// internal` never will
- Group the class files into a directory per feature/domain — the directory carries the cohesion the file no longer does

```
include/myproject/billing/          # public headers, one class each
├── invoice.hpp                     # class Invoice
├── invoice_service.hpp             # class InvoiceService
├── invoice_repository.hpp          # abstract interface (pure virtual)
├── billing_error.hpp               # class BillingError : std::runtime_error
└── money.hpp                       # class Money (value type, header-only)

src/billing/
├── invoice.cpp
├── invoice_service.cpp             # + anonymous-namespace helpers
├── postgres_invoice_repository.hpp # private: consumers never see it
├── postgres_invoice_repository.cpp
└── detail/
    └── sql_builder.hpp             # namespace myproject::billing::detail
```

The one narrow exemption: a small, tightly-coupled private helper type that is unusable outside its owner — a nested state enum, an internal cursor, a pimpl `Impl` — stays in the owner's files. It is an implementation detail, not a second public class. Everything else moves.

No linter enforces this; it is a naming and review convention. The payoff is that `git log` per class is exact, merge conflicts stop colliding across unrelated types, and touching one class rebuilds one TU instead of the tree.

**Don't**
- `models.hpp` / `utils.hpp` / `common.hpp` / `types.hpp` holding five unrelated classes — that's a directory whose files were never split, and every consumer rebuilds when any one of them changes
- Both `#pragma once` and an include guard in the same file — pick one
- `#include` a header for a type you only reference by pointer or reference — forward-declare it
- Rely on a transitive include (`<vector>` arriving via someone else's header) — it breaks the day that header is cleaned up
- `using namespace` at namespace scope in a header — it leaks into every includer (see SKILL.md §1)
- Non-`inline`, non-`template` function definitions in a header — ODR violation at link time
- A directory whose namespace doesn't match its path — the mismatch survives every refactor and confuses every reader
- Split one class across two `.cpp` files to duck the file-length budget (`tooling-and-limits.md`) — a class that big is two classes

---

## Project Layout

**Do**
- Public headers under `include/<project>/`, private headers next to their `.cpp` in `src/` — the split *is* the API boundary
- The extra `<project>/` level is not decoration: consumers add `include/` to their include path and write `#include <myproject/widget.hpp>`, so two dependencies can both ship a `widget.hpp` without colliding. A flat `include/widget.hpp` is a name squatting on every consumer's namespace
- One `CMakeLists.txt` per major directory, `add_subdirectory` from the root — each directory owns its own targets
- `.clang-format`, `.clang-tidy`, and `CMakePresets.json` at the repo root, so every tool and every developer gets the same configuration without flags
- Generate `compile_commands.json` (`CMAKE_EXPORT_COMPILE_COMMANDS`) and symlink it to the root — clangd, clang-tidy, and IWYU all need it
- Declare dependencies in `vcpkg.json` or `conanfile.txt`; reserve `third_party/` for the rare dep no package manager carries (then vendor it as a submodule, not a paste)
- `build/` is generated and gitignored — always an out-of-source build

**Small library** — the floor; don't build more structure than this until it hurts:

```
mylib/
├── CMakeLists.txt              # project(), the one target, install rules
├── CMakePresets.json           # debug / release / asan configurations
├── .clang-format               # ColumnLimit and style — see tooling-and-limits.md
├── .clang-tidy                 # size + complexity budgets — see tooling-and-limits.md
├── vcpkg.json                  # or conanfile.txt
├── README.md
├── include/
│   └── mylib/                  # public API — the only headers consumers see
│       ├── parser.hpp          # class Parser
│       └── writer.hpp          # class Writer
├── src/
│   ├── parser.cpp
│   ├── writer.cpp
│   └── token_buffer.hpp        # private header: never installed, no ABI promise
└── tests/
    ├── CMakeLists.txt
    └── parser_test.cpp
```

**Application / service** — feature-first, with the boundary layers isolated:

```
myapp/
├── CMakeLists.txt              # root: project(), options, add_subdirectory only
├── CMakePresets.json
├── .clang-format
├── .clang-tidy
├── vcpkg.json                  # pinned via builtin-baseline
├── cmake/                      # helper modules: FindXxx.cmake, warnings.cmake, sanitizers.cmake
│   └── CompilerWarnings.cmake
├── include/
│   └── myapp/                  # public headers, one class each (see above)
│       ├── domain/             # pure business logic — no framework, no IO headers
│       │   ├── money.hpp
│       │   └── customer.hpp
│       └── billing/
│           ├── invoice_service.hpp
│           └── invoice_repository.hpp   # port: pure virtual interface
├── src/
│   ├── CMakeLists.txt          # defines the library targets
│   ├── domain/
│   │   ├── money.cpp
│   │   └── customer.cpp
│   ├── billing/
│   │   ├── invoice_service.cpp
│   │   ├── postgres_invoice_repository.hpp  # adapter, private header
│   │   └── postgres_invoice_repository.cpp
│   └── infra/                  # outbound: DB pools, HTTP clients, queues
│       └── postgres_pool.cpp
├── apps/
│   ├── CMakeLists.txt
│   └── server/
│       └── main.cpp            # composition root: wires adapters into the core
├── tests/
│   ├── CMakeLists.txt
│   ├── unit/                   # no IO, milliseconds — mirrors src/
│   │   └── billing/invoice_service_test.cpp
│   └── integration/            # real Postgres, tagged so unit runs stay fast
│       └── postgres_repository_test.cpp
├── benchmarks/
│   └── invoice_bench.cpp       # Google Benchmark — see testing.md
├── examples/                   # compiled in CI, so they can't rot
│   └── minimal_client.cpp
├── third_party/                # only what vcpkg/Conan can't provide
└── docs/
    └── architecture.md
```

Dependencies point inward: `apps/` and `src/infra/` may depend on `domain/`; `domain/` depends on neither. In C++ this is not a convention you hope holds — **CMake target visibility enforces it**:

```cmake
# src/CMakeLists.txt
add_library(myapp_domain domain/money.cpp domain/customer.cpp)
target_include_directories(myapp_domain PUBLIC ${PROJECT_SOURCE_DIR}/include)
# links nothing: the domain has no outbound dependencies, by construction

add_library(myapp_billing billing/invoice_service.cpp billing/postgres_invoice_repository.cpp)
target_include_directories(myapp_billing
    PUBLIC  ${PROJECT_SOURCE_DIR}/include   # public headers reach consumers
    PRIVATE ${CMAKE_CURRENT_SOURCE_DIR})    # private headers stop here
target_link_libraries(myapp_billing
    PUBLIC  myapp_domain                    # appears in billing's public headers
    PRIVATE libpq::libpq)                   # implementation detail — not propagated
```

`PUBLIC` means "my headers name this, so my consumers need it too"; `PRIVATE` means "only my `.cpp` needs it — consumers must not see it"; `INTERFACE` is for header-only targets that have no sources of their own. Get these wrong and a driver dependency leaks transitively into every consumer's include path, and the layering becomes advisory. There is no target the domain could accidentally use, because none is linked.

**Don't**
- Mix public and private headers in one flat `include/` — consumers then compile against internals you meant to change freely
- A flat `include/widget.hpp` with no project subdirectory — it collides with the next library that has a widget
- `target_include_directories(... PUBLIC src/)` — that hands every consumer your private headers and voids the whole layering
- Global `include_directories()` / `link_libraries()` — they apply to everything and hide who actually depends on what
- Commit `build/`, `compile_commands.json`, or vendored source a package manager could pin
- A top-level `utils/` or `common/` target — it becomes the dumping ground every other target links, and the dependency graph goes cyclic in spirit
- Business logic in `apps/main.cpp` — the composition root wires objects and exits; the work lives in a library that tests can link
