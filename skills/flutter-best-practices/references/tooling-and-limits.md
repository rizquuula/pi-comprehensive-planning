# Flutter Tooling, Size & Complexity Limits

Reference for `flutter-best-practices`. The gates that keep the main skill's rules enforced, and the budgets that say when a widget has outgrown its file.

---

## Tooling

**Do**
- Pin dependency versions in `pubspec.yaml`; commit `pubspec.lock` for apps (not packages)
- Enable `flutter_lints` or `very_good_analysis`; run `dart analyze` in CI with zero warnings
- Run `dart format` on every commit (enforce via pre-commit hook or CI); Dart 3.7+ reads `formatter: page_width` from `analysis_options.yaml`
- Generate code (`freezed`, `json_serializable`, `riverpod_generator`) with `build_runner`; commit the `.g.dart`/`.freezed.dart` output only if CI does not regenerate it
- Add the size/complexity rules below to `analysis_options.yaml` so the budgets are enforced, not folklore

**Don't**
- Leave `analysis_options.yaml` empty — unenforced lints mean inconsistent code
- Use `any` versions (`^0.0.0`) without understanding transitive conflict risk
- Add `// ignore:` without a reason comment — silent suppressions accumulate
- Let `dart analyze` warnings ride "for now"; they never go down on their own

```yaml
# pubspec.yaml — Do
dependencies:
  flutter: { sdk: flutter }
  go_router: ^14.0.0
  flutter_riverpod: ^2.5.0

dev_dependencies:
  flutter_test: { sdk: flutter }
  flutter_lints: ^4.0.0
  mocktail: ^1.0.0
  custom_lint: ^0.6.0
```

---

## Size & Complexity Limits

Budgets, not gates — cross one and look for the seam, don't split mechanically at the boundary.

| Unit | Target | Pause | Refactor |
|---|---|---|---|
| Line length | ≤ 80 chars (`dart format` default) | 100 | 120 — raise via `formatter: page_width`, once, project-wide |
| Function / method | ≤ 30 lines | 50 | 80 — extract, or it's doing two jobs |
| `build()` method | ≤ 40 lines | 60 | 80 — extract a widget class, never a `_buildFoo()` |
| Widget class | ≤ 120 lines | 180 | 250 — split the subtree into child widgets |
| File (`.dart`) | 100–300 lines | 400 | 500 — split into one file per class (see `project-layout.md`) |
| Parameters | ≤ 4 named | 5 | 6 — pass a `freezed` data class or a config object |
| Widget nesting depth in `build` | ≤ 5 | 7 | 9 — extract; deep trees rebuild wide and read worse |
| Cyclomatic complexity | ≤ 8 | 10 | 12 — split branches into named methods |
| Widgets per file | 1 public | +1 private `_Foo` | 3 — the extra ones need their own files |

**Do**
- Enforce it in `analysis_options.yaml` so the numbers survive review turnover:

```yaml
# analysis_options.yaml
include: package:flutter_lints/flutter.yaml

formatter:
  page_width: 100          # Dart 3.7+; omit to keep the 80-char default

analyzer:
  errors:
    lines_longer_than_80_chars: ignore   # only if page_width is raised
  exclude:
    - "**/*.g.dart"
    - "**/*.freezed.dart"

linter:
  rules:
    - prefer_const_constructors
    - prefer_const_constructors_in_immutables
    - prefer_const_literals_to_create_immutables
    - avoid_positional_boolean_parameters
    - avoid_unnecessary_containers
    - sized_box_for_whitespace
    - use_key_in_widget_constructors
    - file_names                 # snake_case file names (see project-layout.md)
```

- Add metric limits on top. `dart_code_metrics` is now **DCM** (dcm.dev) — commercial, with a free tier for individuals and OSS. Its config, if you license it:

```yaml
# analysis_options.yaml — DCM
dart_code_metrics:
  metrics:
    cyclomatic-complexity: 10
    maximum-nesting-level: 5
    number-of-parameters: 4
    source-lines-of-code: 50
  rules:
    - avoid-returning-widgets   # forces widget classes over _buildFoo()
    - prefer-single-widget-per-file
```

- Free alternative: `custom_lint` plus `solid_lints`, which ships the same metric rules as analyzer diagnostics:

```yaml
# analysis_options.yaml — free path
include: package:solid_lints/analysis_options.yaml

custom_lint:
  rules:
    - cyclomatic_complexity:
        max_complexity: 10
    - number_of_parameters:
        max_parameters: 4
    - function_lines_of_code:
        max_lines: 50
    - avoid_returning_widgets
    - prefer_match_file_name
```

Run it as `dart run custom_lint` in CI alongside `dart analyze`.

- Count *logical* lines — a 400-line file that is 350 lines of generated `.freezed.dart` or an `.arb`-backed string table is fine
- Budget `build()` separately from the class: a 200-line widget class with a 20-line `build()` and rich named sub-builders is healthier than a 90-line `build()`

**Don't**
- `// ignore: lines_longer_than_80_chars` scattered per line — set `page_width` once or extract a local
- Long `build()` methods kept whole because "it's just layout" — layout nests, and nesting is exactly what the budget measures
- Split one widget's state across two `State` classes to duck the class budget — that's two widgets
- Count `const` constructor boilerplate and `@override` annotations against the budget

### Getting back under budget

Nesting × branches, and in Flutter almost all of it lands in `build()`. The first move fixes most violations.

**1. Extract a widget class, not a `_buildFoo()` method.** This is the one that matters. A helper method returns a subtree that becomes part of the *parent's* element — it has no `Element` of its own, so it cannot be `const`, cannot short-circuit, and rebuilds every time the parent rebuilds. A widget class gets its own element and its own rebuild boundary.

```dart
// over — helper method: rebuilds with the whole parent, never const
class OrderPage extends StatelessWidget {
  const OrderPage({super.key, required this.order});
  final Order order;

  Widget _buildSummary() => Column(
        children: [
          Text(order.reference),
          Text('${order.itemCount} items'),
        ],
      );

  @override
  Widget build(BuildContext context) => Column(children: [_buildSummary()]);
}

// prefer — widget class: own element, own rebuild boundary, const-able
class OrderSummary extends StatelessWidget {
  const OrderSummary({super.key, required this.order});
  final Order order;

  @override
  Widget build(BuildContext context) => Column(
        children: [
          Text(order.reference),
          Text('${order.itemCount} items'),
        ],
      );
}

class OrderPage extends StatelessWidget {
  const OrderPage({super.key, required this.order});
  final Order order;

  @override
  Widget build(BuildContext context) =>
      Column(children: [OrderSummary(order: order)]);
}
```

**2. `const` every constructor you can.** A `const` subtree is canonicalized — Flutter compares identity and skips its `build()` entirely. Extraction (1) is what makes `const` reachable in the first place.

**3. Guard clauses in non-`build` logic.** Controllers, repositories, and event handlers get the standard invert-and-return-early treatment; nesting depth collapses.

```dart
// over
Future<void> submit() async {
  if (form.isValid) {
    if (!isSubmitting) {
      if (user != null) {
        await api.send(form.data);
      }
    }
  }
}

// prefer
Future<void> submit() async {
  if (!form.isValid) return;
  if (isSubmitting) return;
  if (user == null) return;
  await api.send(form.data);
}
```

**4. Move branching out of `build` into the state/controller layer.** `build()` should render one state, not decide which state it is in. Compute the decision once in the notifier/cubit and let `build` `switch` over the result.

**5. `switch` expressions and pattern matching over `if`/`else` chains.** One expression, exhaustive, and it reads as a table.

```dart
// over
Widget build(BuildContext context) {
  if (state.isLoading) return const Spinner();
  if (state.error != null) return ErrorView(message: state.error!);
  if (state.items.isEmpty) return const EmptyView();
  return ItemList(items: state.items);
}

// prefer — sealed state, no nullable flags, compiler-checked exhaustiveness
Widget build(BuildContext context) => switch (state) {
      CartLoading() => const Spinner(),
      CartFailed(:final message) => ErrorView(message: message),
      CartEmpty() => const EmptyView(),
      CartReady(:final items) => ItemList(items: items),
    };
```

**6. Sealed classes for state variants, replacing nullable-flag soup.** `isLoading` + `error` + `items` is three fields encoding four states, two of which are illegal. A `sealed class CartState` with one subclass per variant makes the illegal ones unrepresentable and deletes the guards.

**7. Parameter objects / `freezed` data classes past ~5 named params.** Params that always travel together are one missing concept, and the data class is where validation and `copyWith` land.

```dart
// over
const PriceRow({required this.label, required this.amount, required this.currency,
    required this.isDiscounted, required this.strikeThrough, required this.taxRate});

// prefer
@freezed
class PriceLine with _$PriceLine {
  const factory PriceLine({
    required String label,
    required Money amount,
    @Default(false) bool isDiscounted,
    Money? strikeThrough,
  }) = _PriceLine;
}

const PriceRow({super.key, required this.line});
```

**8. Extension methods to pull behavior off a fat class.** Formatting, mapping, and adapter helpers move to `extension OrderX on Order { ... }` in their own file — the class stays the data, the extension carries the verbs.

**9. Composition via `child` / `builder` params to flatten nesting.** A wrapper that takes a `child` lets the caller keep the tree one level deep instead of inlining decoration around every subtree.

```dart
// prefer — caller sees one level, not four
class CardSection extends StatelessWidget {
  const CardSection({super.key, required this.title, required this.child});
  final String title;
  final Widget child;

  @override
  Widget build(BuildContext context) => Card(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(children: [Text(title), child]),
        ),
      );
}
```

**10. `ListView.builder` and slivers replace hand-rolled loops.** `Column(children: items.map(...).toList())` is a loop, an eager allocation, and a complexity hit at once; the builder form is lazy and one line.

**11. Scope rebuilds to the leaf with `Consumer` / `Selector` / `ref.watch`.** Watching state at the top of the screen rebuilds everything below it. Push the watch down to the widget that actually reads the value.

```dart
// over — whole screen rebuilds on any cart change
Widget build(BuildContext context) {
  final cart = ref.watch(cartProvider);
  return Scaffold(body: BigStaticBody(), bottomNavigationBar: Text('${cart.count}'));
}

// prefer — only the badge rebuilds
class CartBadge extends ConsumerWidget {
  const CartBadge({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final count = ref.watch(cartProvider.select((c) => c.count));
    return Text('$count');
  }
}
```

**Don't** trade complexity for indirection: eight one-off widget classes used once each, in order, is the same `build()` with extra files. Extract when the piece has a name, a rebuild boundary, and ideally its own widget test.
