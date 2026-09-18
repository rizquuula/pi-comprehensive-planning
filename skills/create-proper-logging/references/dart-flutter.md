# Logging in Dart and Flutter

**Library:** the `logging` package (Dart team) for a hierarchical logger with your
own output handler, or the `logger` package for ready-made pretty console output
in development. Both let you attach one sink that formats records as JSON.

`print()` is banned in production code. It has no level, no fields, and no way
to disable it. `flutter_lints` flags it through `avoid_print`; keep that rule on.

---

## Setup

**Do**
- Configure the root logger once, in `main()`, before `runApp`
- Default to `Level.INFO`; raise to `Level.FINE` through a build-time constant
- Register one listener that formats records and writes them to your sink
- Use `debugPrint` only inside `kDebugMode` blocks, never as the production path

```dart
import 'dart:convert';
import 'dart:developer' as developer;
import 'package:logging/logging.dart';

const bool _verbose = bool.fromEnvironment('VERBOSE_LOGS', defaultValue: false);

void initLogging() {
  Logger.root.level = _verbose ? Level.FINE : Level.INFO;

  Logger.root.onRecord.listen((record) {
    final payload = <String, Object?>{
      'ts': record.time.toUtc().toIso8601String(),
      'level': record.level.name,
      'logger': record.loggerName,
      'msg': record.message,
      if (record.object is Map<String, Object?>) ...record.object! as Map<String, Object?>,
      if (record.error != null) 'error': '${record.error}',
      if (record.stackTrace != null) 'stack': '${record.stackTrace}',
    };
    developer.log(jsonEncode(payload), name: record.loggerName);
  });
}
```

Run with `flutter run --dart-define=VERBOSE_LOGS=true` to enable debug output.

**Don't**
- Call `print()` anywhere outside a throwaway script
- Create a `Logger` inside `build()`; create it once per file or class

---

## Correlation ID

**Child logger passed explicitly** — clearest, and works with any state manager:

```dart
class RequestLogger {
  RequestLogger(this._base, this.correlationId);
  final Logger _base;
  final String correlationId;

  void info(String message, [Map<String, Object?> fields = const {}]) =>
      _base.log(Level.INFO, message, {'correlation_id': correlationId, ...fields});
}
```

Build it in the repository or API client that owns the request, then pass it down.

**Zone-scoped value** — when threading a logger through is impractical:

```dart
const _key = #correlationId;

String? get currentCorrelationId => Zone.current[_key] as String?;

Future<T> withCorrelation<T>(String id, Future<T> Function() body) =>
    runZoned(body, zoneValues: {_key: id});
```

The zone value follows every `await` inside `body`. Read it in `onRecord` so
every line carries the ID without a call-site change.

---

## Bad / Good

```dart
// Bad — print, interpolated message, PII, error with no stack trace
print('placed order for ${user.email}, amount $amountCents');
print('failed: $e');

// Good — leveled logger, structured fields, error and stack preserved
_log.info('order placed', {
  'order_id': order.id,
  'user_id': user.id,
  'amount_cents': amountCents,
});
_log.severe('order placement failed', e, stackTrace);
```

`Logger.severe(message, error, stackTrace)` keeps both. Interpolating `$e` into
the message loses them.

---

## Level notes

- The `logging` package uses names, not the usual four: `FINEST`, `FINER`, `FINE`,
  `CONFIG`, `INFO`, `WARNING`, `SEVERE`, `SHOUT`. Map them as
  `FINE` → DEBUG, `INFO` → INFO, `WARNING` → WARN, `SEVERE` → ERROR.
- The `logger` package uses `Level.trace/debug/info/warning/error/fatal`; its
  `PrettyPrinter` is development-only — swap in a JSON printer for release.
- `Logger('a.b')` is a child of `Logger('a')`; a parent level applies to the
  subtree. Set `hierarchicalLoggingEnabled = true` first.
- Send `SEVERE` records to your crash reporter, and hook `FlutterError.onError`
  into the same logger.

**Don't**
- Log user input, tokens, or auth responses; mobile logs are readable over USB
