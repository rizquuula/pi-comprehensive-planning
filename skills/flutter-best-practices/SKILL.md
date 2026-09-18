---
name: flutter-best-practices
description: Apply when writing, reviewing, or planning Flutter/Dart code (.dart files). Covers null-safety, final/const, async/await, widget composition, keys, pure build methods, Riverpod/Bloc/Provider, disposal, BuildContext across async gaps, rebuild storms, ListView.builder, adaptive layout, Material/Cupertino, platform channels, web routing/SEO, dart analyze, dart format, flutter_lints; size and complexity budgets (build method length, widget nesting, analysis_options, dart_code_metrics, custom_lint, extract widget vs _buildFoo); file granularity (class per file, snake_case files, part/part of, barrels, lib/src); project layout (feature-first, melos, flavors); testing (testWidgets, golden tests, mocktail, bloc_test, integration_test, patrol, coverage). Use when the user mentions Flutter, Dart, widgets, setState, Riverpod, Bloc, pubspec, go_router, or Flutter project structure.
---

# Flutter Best Practices

One codebase, three platforms — Android, iOS, and web — done right.

---

## 1. Dart Idioms

**Do**
- Embrace sound null-safety: use `?.`, `??`, and `??=`; let the type system prove non-null
- Declare variables `final` by default; escalate to `const` for compile-time values
- Use `async`/`await` for sequential async logic; `Stream` for ongoing event sequences
- Use records and pattern-matching `switch` for structured data and exhaustive branching
- Use collection-if, collection-for, and spread (`...`) to build collections declaratively
- Use cascades (`..`) for chained mutations on the same object

**Don't**
- Force `!` (null-assertion) without a guarantee — prefer a guard or `??` fallback
- Use `late` without a clear initialization contract; it defers, not prevents, null errors
- Chain `.then().catchError()` — `async`/`await` + `try/catch` is clearer
- Shadow built-ins or use single-letter names outside tiny lambdas

```dart
// Do
final label = user?.displayName ?? 'Guest';
final total = prices.fold<double>(0, (sum, p) => sum + p);

// Don't
final label = user!.displayName;  // crashes if null
```

---

## 2. Widget Architecture

**Do**
- Compose widgets; never subclass `StatelessWidget`/`StatefulWidget` for behavior reuse
- Keep widgets small and single-purpose — split when `build()` exceeds ~40 lines
- Default to `StatelessWidget`; reach for `StatefulWidget` only for local, ephemeral UI state
- Add `const` constructors to every widget you write; mark instantiations `const` where possible
- Extract subtrees into dedicated widget classes — NOT private helper methods
- Use `Key` (especially `ValueKey`/`ObjectKey`) only when identity across rebuilds matters (lists, reorderable items)
- Keep `build()` pure, cheap, and free of side effects

**Don't**
- Put a helper method `_buildFoo()` where a `class _FooWidget extends StatelessWidget` belongs — helper methods forfeit `const` and rebuild short-circuit
- Trigger async work, navigation, or logging inside `build()`
- Rely on widget identity without a `Key` in dynamic lists

```dart
// Do
class _PriceTag extends StatelessWidget {
  const _PriceTag({required this.amount});
  final double amount;
  @override
  Widget build(BuildContext context) => Text('\$$amount');
}

// Don't
Widget _buildPriceTag(double amount) => Text('\$$amount'); // no const, no short-circuit
```

---

## 3. State Management

**Do**
- Pick ONE solution (Riverpod, Bloc, or Provider) and apply it consistently across the app
- Lift state to the lowest common ancestor that needs it
- Keep business logic in a separate layer (notifier, cubit, bloc) — widgets only render and dispatch
- Always `dispose()` controllers, notifiers, and subscriptions in `State.dispose()`
- Model state as immutable objects; use `copyWith` for updates

**Don't**
- Mix Riverpod and Provider in the same feature
- Put `http` calls or domain logic directly in `build()` or `initState()`
- Mutate state objects in place — triggers subtle bugs and missed rebuilds
- Forget that `StateProvider`/`ChangeNotifier` still leaks if not disposed

```dart
// Riverpod — Do
@riverpod
Future<List<Product>> products(ProductsRef ref) =>
    ref.watch(repositoryProvider).fetchProducts();

// Bloc — Do
class CartCubit extends Cubit<CartState> {
  CartCubit() : super(CartState.empty());
  void add(Item item) => emit(state.copyWith(items: [...state.items, item]));
}
```

---

## 4. Correctness Footguns

**Do**
- Check `if (!mounted) return;` after every `await` before using `BuildContext`
- Dispose `TextEditingController`, `AnimationController`, `ScrollController`, and `StreamSubscription` in `dispose()`
- Move heavy computation off the UI isolate with `compute()` or `Isolate.run()`
- Call `setState()` only on leaf/local state widgets, not high in the tree

**Don't**
- Use `context` (Navigator, Theme, etc.) after an `await` without a `mounted` guard
- Call `setState()` inside `build()`, in a constructor, or after `dispose()`
- Fire-and-forget a `StreamSubscription` without storing and cancelling it
- Block the main isolate with JSON parsing or image processing — jank guaranteed

```dart
// Do
Future<void> _load() async {
  final data = await repository.fetch();
  if (!mounted) return;
  setState(() => _items = data);
}

// Do — dispose
@override
void dispose() {
  _controller.dispose();
  _sub.cancel();
  super.dispose();
}
```

---

## 5. Performance

**Do**
- Mark widget instantiations `const` — Flutter skips their `build()` on rebuilds
- Use `ListView.builder`, `GridView.builder`, or slivers for any list that could grow
- Wrap independently animated or repainted subtrees in `RepaintBoundary`
- Resize and cache network images (`cacheWidth`/`cacheHeight`, `cached_network_image`)
- Use `Selector` (Provider) or `select` (Riverpod) to subscribe to only the slice of state you need

**Don't**
- Build a `Column` with hundreds of children — always prefer lazy builders
- Do expensive work (sorting, parsing, filtering) inside `build()`; pre-compute in the notifier/cubit
- Wrap everything in `RepaintBoundary` — it costs memory; target genuinely isolated repaint regions
- Load full-resolution images when a thumbnail will do

```dart
// Do
ListView.builder(
  itemCount: items.length,
  itemBuilder: (context, i) => const ProductTile(), // const if data-independent
);

// Don't
Column(children: items.map((i) => ProductTile(item: i)).toList()); // eager, non-lazy
```

---

## 6. Cross-Platform — Android, iOS & Web

**Do**
- Use `LayoutBuilder` and `MediaQuery` for responsive layouts; prefer `Flexible`/`Expanded` over fixed pixel sizes
- Wrap root screens in `SafeArea` to handle notches, system bars, and home indicators
- Use platform-adaptive widgets (`.adaptive` constructors, `CupertinoPageScaffold` on iOS where appropriate, `defaultTargetPlatform`, `kIsWeb`)
- Route via `go_router` for deep links and URL strategy on web; configure `usePathUrlStrategy()`
- Access native APIs through well-maintained plugins or platform channels (`MethodChannel`)
- Test on all three platforms before shipping — layout bugs are often platform-specific

**Don't**
- Import `dart:io` in web-targeted code — use `kIsWeb` guards or conditional imports
- Use fixed pixel sizes for touch targets — Material spec: 48×48 dp minimum
- Assume CanvasKit renderer for web by default — evaluate CanvasKit vs HTML renderer per app (CanvasKit: fidelity; HTML: bundle size/SEO)
- Expect Flutter web to rank well with raw SEO — use meta tags, pre-rendering, or a server-side approach for content that must be indexed
- Mix Material and Cupertino widgets arbitrarily — pick a strategy and apply it consistently

```dart
// Do
Widget build(BuildContext context) {
  if (kIsWeb) return const WebHomePage();
  return switch (defaultTargetPlatform) {
    TargetPlatform.iOS => const CupertinoHome(),
    _ => const MaterialHome(),
  };
}
```

---

## References

Bundled deep-dives — load the file when the task reaches it.

- **`references/tooling-and-limits.md`** — `pubspec.yaml` pinning, `flutter_lints`, `dart analyze`, `dart format`, `analysis_options.yaml`, DCM and `custom_lint` metric rules, the size and complexity budget table, and "Getting back under budget". Read when setting up the project's gates, or when a `build()` method, widget class, or file has grown too large.
- **`references/project-layout.md`** — one public class per file, snake_case file names, `lib/src/`, barrels, `part`/`part of`, feature-first application layout, flavors, and dependency-direction enforcement. Read when starting a project, adding a feature directory, or deciding where a file goes.
- **`references/testing.md`** — the unit/widget/integration tiers, `testWidgets`, `pump` versus `pumpAndSettle`, key-based finders, `mocktail`, `bloc_test`, `fakeAsync`, golden tests, `patrol`, and coverage. Read when writing or reviewing tests.
