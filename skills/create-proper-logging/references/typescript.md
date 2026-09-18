# Logging in TypeScript

**Library:** `pino` for Node backends. It writes newline-delimited JSON, costs
little per call, and supports child loggers and redaction paths natively.
`winston` is the alternative when you need many transports in-process, but pino
plus a shipping sidecar is the simpler production setup.

---

## Setup

**Do**
- Create one logger module and import it everywhere
- Default to `info`; read `LOG_LEVEL` from the environment for `debug`
- Declare redaction paths in the logger config, not at call sites
- Use `pino-pretty` in development only, through a separate pipe or transport

```ts
// src/logger.ts
import pino from 'pino';

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  base: { service: 'order-api', version: process.env.APP_VERSION },
  timestamp: pino.stdTimeFunctions.isoTime,
  formatters: {
    level: (label) => ({ level: label }), // "level":"info" instead of 30
  },
  redact: {
    paths: ['req.headers.authorization', 'req.headers.cookie', '*.password', '*.token'],
    censor: '[redacted]',
  },
});
```

**Don't**
- Call `console.log` in server code — it is unstructured and synchronous on some streams
- Instantiate a new `pino()` per module; that duplicates transports
- Ship `pino-pretty` to production; the JSON stream is what aggregators parse

---

## Correlation ID

`AsyncLocalStorage` is the Node request scope. It survives `await` boundaries, so
a child logger bound once at the inbound boundary reaches every later call.

```ts
// src/request-context.ts
import { AsyncLocalStorage } from 'node:async_hooks';
import type { Logger } from 'pino';
import { logger } from './logger';

const store = new AsyncLocalStorage<{ log: Logger }>();

export const log = (): Logger => store.getStore()?.log ?? logger;

export function withCorrelation(req, res, next): void {
  const correlationId = (req.headers['x-correlation-id'] as string) ?? crypto.randomUUID();
  const child = logger.child({ correlation_id: correlationId });

  res.setHeader('x-correlation-id', correlationId);
  store.run({ log: child }, () => {
    child.info({ method: req.method, path: req.url }, 'request received');
    next();
  });
}
```

Anywhere downstream, `log().info({ order_id }, 'order placed')` carries the ID
without passing it as an argument.

---

## Bad / Good

```ts
// Bad — template literal, nothing queryable, error becomes a bare string
console.log(`placed order for user ${userId}, amount ${amountCents}`);
console.error(`failed: ${err}`);

// Good — stable message, typed fields, serialized error
log().info({ order_id: orderId, user_id: userId, amount_cents: amountCents }, 'order placed');
log().error({ order_id: orderId, err }, 'order placement failed');
```

pino serializes a field named `err` through its error serializer: message, type,
and stack are all preserved. `{ error: String(err) }` loses the stack.

---

## Level notes

- pino levels: `trace=10`, `debug=20`, `info=30`, `warn=40`, `error=50`, `fatal=60`.
- The first argument is the field object, the second is the message —
  `logger.info(obj, msg)`. Reversing them puts your fields into the message.
- `logger.level = 'debug'` changes the level at runtime.
- Use `logger.child({...})` for per-request or per-component context; children are cheap.

---

## Frontend console discipline

The browser has no log aggregator, so the rules differ.

**Do**
- Keep `console.error` and `console.warn` for real faults; they surface in error reporting tools
- Route production diagnostics to your error-reporting SDK, not to the console
- Strip debug output at build time (`drop_console` in the minifier, or a `debug()` wrapper that is a no-op in production)

**Don't**
- Leave `console.log` debugging in shipped bundles; it leaks internals to any user
- Log tokens, session data, or user records to the console — they are readable in DevTools
- Log inside a render function or effect that runs on every frame
