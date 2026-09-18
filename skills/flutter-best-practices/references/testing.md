# Flutter Testing

Reference for `flutter-best-practices`. Test mechanics for Flutter and Dart — unit, widget, golden, and integration tests.

---

## Testing

Mechanics only — for the red-green-refactor process and how wide to sweep per change, use `test-driven-development`.

Three tiers, each answering a different question:

| Tier | Package | Runs on | Answers |
|---|---|---|---|
| Unit | `test` | Dart VM, milliseconds | does this controller/entity compute the right thing? |
| Widget | `flutter_test` (`testWidgets`) | headless test binding | does this subtree render and respond correctly? |
| Integration | `integration_test` | real device/emulator | does the whole flow work against the real app? |

**Do**
- Put the bulk in unit tests of `application/` and `domain/`; widget tests for every screen's states; a handful of integration tests for critical journeys only
- `await tester.pumpWidget(...)` to mount, then `await tester.pump()` to advance one frame — one `pump()` per expected frame
- `pumpAndSettle()` only when animations actually terminate; it **hangs until timeout** on an infinite animation (a spinner, a looping `AnimationController.repeat()`). Assert on a loading state with `pump()`, never `pumpAndSettle()`
- Prefer `find.byKey(const Key('submit'))` — `find.byType` breaks when you extract a widget, `find.text` breaks on copy edits or localization. Keys are the only finder that survives refactors
- `mocktail` over `mockito` for new code: no `build_runner` codegen, no `.mocks.dart` to keep in sync; `mockito` is the right call only when you already depend on its generated `@GenerateMocks` setup. Register fallbacks with `registerFallbackValue` for `any()` on custom types
- Fakes over mocks for stateful collaborators — an `InMemoryCartRepository implements CartRepository` beats a stack of `when(...).thenAnswer(...)` and doesn't encode call order
- Override the DI graph at pump time: `ProviderScope(overrides: [...])` for Riverpod, `BlocProvider.value` with a test double for Bloc
- `blocTest` from `bloc_test` for state-sequence assertions — it's the right tool when the assertion is "these states, in this order"
- Inject a `Clock` (`package:clock`) or a time function rather than sleeping; use `fakeAsync` (`package:fake_async`) to advance timers instantly
- `await tester.runAsync(() async { ... })` when the test needs *real* async work (an actual HTTP call in an integration test, image decoding) — the widget tester's fake async otherwise never lets it complete
- Test the `BuildContext`-across-async-gap path explicitly: pump, trigger the async action, dispose the widget mid-flight, and assert no exception — that's where `mounted` bugs live
- Stub image loading: `NetworkImage` fails in widget tests (the test `HttpClient` returns 400). Wrap in `HttpOverrides.runZoned` with a fake client, or use `precacheImage` with a `MemoryImage`, or inject the `ImageProvider`
- Golden tests for design-critical widgets: `expect(find.byType(PriceRow), matchesGoldenFile('goldens/price_row.png'))`. Regenerate with `flutter test --update-goldens`, and pin the CI platform — font rasterization differs across OSes, so goldens generated on macOS fail on Linux. Load a bundled test font, or run goldens only on one CI image
- `flutter test --coverage` + `genhtml coverage/lcov.info` as a gap-finder: read it for untested error branches, don't gate the build on a percentage
- `patrol` when integration tests must touch native surfaces — permission dialogs, notifications, WebViews — which `integration_test` alone cannot drive

```dart
testWidgets('shows the error view when loading fails', (tester) async {
  final repository = MockCartRepository();
  when(() => repository.fetch()).thenThrow(const NetworkFailure('offline'));

  await tester.pumpWidget(
    ProviderScope(
      overrides: [cartRepositoryProvider.overrideWithValue(repository)],
      child: const MaterialApp(home: CartScreen()),
    ),
  );

  expect(find.byType(CircularProgressIndicator), findsOneWidget); // first frame
  await tester.pump();                                            // future resolves

  expect(find.byKey(const Key('cart-error')), findsOneWidget);
  expect(find.byType(CircularProgressIndicator), findsNothing);
});
```

Table-driven unit tests keep the cases as data, not as branches:

```dart
void main() {
  const cases = <({String label, int quantity, Money unit, Money expected})>[
    (label: 'single item', quantity: 1, unit: Money(500), expected: Money(500)),
    (label: 'multiple items', quantity: 3, unit: Money(500), expected: Money(1500)),
    (label: 'empty cart', quantity: 0, unit: Money(500), expected: Money(0)),
  ];

  for (final c in cases) {
    test('subtotal — ${c.label}', () {
      final cart = Cart.of(quantity: c.quantity, unitPrice: c.unit);
      expect(cart.subtotal, c.expected);
    });
  }
}
```

**Don't**
- `pumpAndSettle()` as a reflex — it masks missing frames, and it deadlocks on any never-ending animation
- `await Future.delayed(...)` inside a test to "wait for" something — pump frames or use `fakeAsync`
- Assert on `find.text('Total')` in a localized app — the string moves to the `.arb` file and the test breaks for the wrong reason
- Golden tests for anything with a live clock, an animation mid-flight, or platform-dependent scrollbars
- Commit a golden regenerated with `--update-goldens` without eyeballing the diff — that flag turns a failing test green by definition
- Integration tests hitting live network or production credentials — stub at the repository boundary or point at a seeded test backend
- Mock the class under test, or leave `verify(() => mock.foo())` as the only assertion — that tests the wiring, not the behavior
- A widget test that pumps the entire `MyApp` to check one card — pump the smallest subtree that reproduces the behavior
- Chase 100% coverage through generated `.g.dart`/`.freezed.dart` files — exclude them from `lcov` and spend the effort on error paths
- `@Skip` or delete a flaky widget test without diagnosing it — flakiness here is usually a missing `pump()` or an undisposed controller
