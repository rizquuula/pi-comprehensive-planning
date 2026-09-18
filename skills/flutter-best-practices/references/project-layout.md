# Flutter Class Granularity & Project Layout

Reference for `flutter-best-practices`. Where each kind of file belongs in a Flutter project, and what belongs in one file.

---

## Class & File Granularity

Dart permits any number of top-level declarations per file. Don't take it up on that.

**Do**
- **One public class per file**, named after the class in `snake_case`: `class InvoiceService` → `invoice_service.dart`, `class OrderSummaryCard` → `order_summary_card.dart`. Dart file names are snake_case, never PascalCase — `file_names` and `prefer_match_file_name` lint this
- Keep private widgets prefixed `_` in the owner's file when they exist only to serve it (`_PriceTag`, `_EmptyState`) — the narrow exemption; they are implementation detail, not a second public class. The moment one is used by a second screen, it moves to its own file and loses the underscore
- Put package internals under `lib/src/` and expose only `lib/<package>.dart` — anything under `lib/src/` is off-contract for consumers, which is the whole point of the convention
- Use a barrel file for a *package's* public surface (`lib/billing.dart` with `export 'src/invoice_service.dart';`), and keep it hand-written and explicit
- Use `part` / `part of` for generated code only — `freezed`, `json_serializable`, `riverpod_generator` require `part 'order.freezed.dart';`. That is essentially its whole legitimate use
- Promote a directory to its own package once it has a stable API, its own tests, and a second consumer — a `melos` workspace makes `packages/billing/` importable and enforces the boundary at the pub level

```
lib/
├── billing.dart                        # barrel: the package's public surface
└── src/
    └── billing/
        ├── domain/
        │   ├── invoice.dart            # class Invoice (+ part 'invoice.freezed.dart')
        │   ├── invoice.freezed.dart    # generated, gitignored or committed as a unit
        │   └── invoice_repository.dart # abstract class InvoiceRepository (port)
        ├── data/
        │   └── http_invoice_repository.dart
        ├── application/
        │   └── invoice_controller.dart # class InvoiceController extends Notifier
        └── presentation/
            ├── invoice_screen.dart     # class InvoiceScreen (+ private _Header)
            └── invoice_summary_card.dart
```

Barrel files trade convenience for two real costs: they widen the import graph, which makes circular imports easy to create and hard to see, and they weaken tree-shaking when a consumer imports the barrel for one symbol. Keep barrels at package boundaries; do not add a `widgets.dart` barrel inside a feature just to shorten imports.

No linter enforces one-class-per-file on its own (DCM's `prefer-single-widget-per-file` and solid_lints' `prefer_match_file_name` come closest). It is a review convention, and it pays off in exact per-class `git log`, merge conflicts that stop colliding across unrelated widgets, and finding a definition by filename without a symbol index.

**Don't**
- `models.dart`, `utils.dart`, `constants.dart`, `helpers.dart` — grab-bags that every feature imports and nobody can safely change. One model per file; a constant belongs to the class or theme that owns it
- Three public widgets in one `.dart` file because they render on the same screen — the screen is the composition, the file is not
- `part` / `part of` to split a hand-written class across files — it defeats `import` privacy analysis and hides the file's real dependencies. A class too big for one file is two classes
- Export `lib/src/**` directly from consumer code — that pins you to internals you meant to keep free
- A barrel that re-exports another barrel — the cycle is now two hops away from visible

---

## Project Layout

**Do**
- Feature-first: everything one feature needs lives in one directory, so a feature change touches one subtree
- `lib/main.dart` stays a bootstrap: config, DI root, `runApp` — nothing else
- Mirror `lib/` in `test/`; keep `integration_test/` at the project root (the `integration_test` package requires it)
- Declare every asset directory in `pubspec.yaml`; keep localization `.arb` files under `l10n/` with `l10n.yaml` driving codegen
- Keep flavors (`main_dev.dart`, `main_prod.dart`) as thin entrypoints over one shared bootstrap, with values injected by `--dart-define` / `--dart-define-from-file`, never checked-in secrets
- Commit the generated `android/`, `ios/`, `web/` directories — they are generated once and then hand-edited (signing, permissions, `index.html`)

**Small package** — the floor; don't build more than this until it hurts:

```
my_package/
├── pubspec.yaml
├── analysis_options.yaml
├── README.md
├── CHANGELOG.md
├── lib/
│   ├── my_package.dart        # barrel: public API exports only
│   └── src/
│       ├── parser.dart        # class Parser
│       └── token_buffer.dart  # internal — not exported
├── test/
│   └── src/
│       └── parser_test.dart   # mirrors lib/src/
└── example/
    └── main.dart
```

**Application** — feature-first, layers isolated inside each feature:

```
my_app/
├── pubspec.yaml
├── pubspec.lock                     # committed for apps, not packages
├── analysis_options.yaml            # lints + size budgets (see tooling-and-limits.md)
├── l10n.yaml                        # drives gen-l10n
├── melos.yaml                       # only if this is a multi-package workspace
├── android/ ios/ web/               # generated, then hand-edited — commit them
├── assets/
│   ├── images/
│   └── fonts/
├── l10n/
│   ├── app_en.arb
│   └── app_id.arb
├── lib/
│   ├── main.dart                    # runApp(const MyApp()) — bootstrap only
│   ├── main_dev.dart                # flavor entrypoint → shared bootstrap
│   ├── main_prod.dart
│   ├── bootstrap.dart               # DI root, error handlers, ProviderScope
│   ├── core/                        # cross-cutting, feature-agnostic
│   │   ├── config/app_config.dart   # --dart-define → typed config, read once
│   │   ├── router/app_router.dart   # go_router config
│   │   ├── theme/app_theme.dart
│   │   └── network/dio_client.dart
│   ├── shared/
│   │   └── widgets/                 # reusable widgets, one per file
│   │       └── primary_button.dart
│   └── features/
│       ├── cart/
│       │   ├── presentation/        # widgets + screens; imports application
│       │   │   ├── cart_screen.dart
│       │   │   └── cart_item_tile.dart
│       │   ├── application/         # controllers/blocs; use cases
│       │   │   └── cart_controller.dart
│       │   ├── domain/              # entities, ports — NO flutter imports
│       │   │   ├── cart.dart
│       │   │   └── cart_repository.dart      # abstract port
│       │   └── data/                # implements domain ports
│       │       ├── http_cart_repository.dart
│       │       └── cart_dto.dart
│       └── checkout/
│           └── ...                  # same four layers
├── test/
│   ├── features/
│   │   └── cart/
│   │       ├── application/cart_controller_test.dart   # unit
│   │       └── presentation/cart_screen_test.dart      # widget
│   └── goldens/
│       └── cart_screen.png
└── integration_test/
    └── checkout_flow_test.dart      # runs on a device/emulator
```

Layer-first (`lib/models/ + lib/widgets/ + lib/services/`) works for exactly one feature. Past that, every change fans out across three directories, two features' files sit adjacent with nothing in common, and no directory can be deleted, extracted, or code-owned as a unit. Feature-first inverts all three.

Dependency direction inside a feature: **presentation → application → domain**, and **data implements domain ports**. `domain/` imports no Flutter — no `package:flutter/*`, no `BuildContext`, no widgets — which is what makes it unit-testable without `flutter_test`. Enforce it rather than trusting review:

```yaml
# analysis_options.yaml
linter:
  rules:
    - depend_on_referenced_packages
    - implementation_imports        # blocks importing another package's lib/src/
```

For real direction enforcement use a `custom_lint` rule (or DCM's `avoid-banned-imports`) banning `package:flutter/` under `**/domain/**`, and `**/data/**` imports from `**/presentation/**`. In a `melos` monorepo, make each feature a package — then `pubspec.yaml` dependencies *are* the allowed edges, and a violation fails `pub get`.

**Don't**
- Type-first folders (`lib/widgets/`, `lib/models/`, `lib/screens/`) that spread one feature across the tree
- A monster `main.dart` — bootstrap and `runApp` only
- Business logic in `lib/` root files outside any feature/core boundary
- A `lib/utils/` or `lib/common/` — it becomes the node every feature depends on and nobody can refactor
- Feature A importing `features/b/data/**` — cross-feature traffic goes through B's public surface, or through `core/`
- `BuildContext`, `Widget`, or `Colors` referenced under `domain/` — that layer must compile without Flutter
- Secrets or API keys in `--dart-define` defaults committed to the repo; a compiled Flutter binary is readable
