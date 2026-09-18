# Logging in Kotlin

**Library:** SLF4J as the API, Logback as the implementation, `kotlin-logging`
for the idiomatic Kotlin wrapper. SLF4J keeps your code independent of the
backend. `kotlin-logging` gives lambda-based calls so the message is built only
when the level is enabled. Add `logstash-logback-encoder` for JSON output.

---

## Setup

**Do**
- Declare the logger once per class with `KotlinLogging.logger {}`
- Default the root level to `INFO`; override through an environment variable
- Emit JSON in production with `LogstashEncoder`
- Keep the configuration in `src/main/resources/logback.xml`

```kotlin
import io.github.oshai.kotlinlogging.KotlinLogging

private val log = KotlinLogging.logger {}
```

```xml
<!-- logback.xml -->
<configuration>
  <appender name="JSON" class="ch.qos.logback.core.ConsoleAppender">
    <encoder class="net.logstash.logback.encoder.LogstashEncoder">
      <includeMdcKeyName>correlation_id</includeMdcKeyName>
      <customFields>{"service":"order-api"}</customFields>
    </encoder>
  </appender>

  <root level="${LOG_LEVEL:-INFO}">
    <appender-ref ref="JSON"/>
  </root>

  <logger name="org.hibernate.SQL" level="WARN"/>
</configuration>
```

**Don't**
- Use `println` in application code
- Bind two SLF4J implementations; the classpath warning means one is ignored
- Set the root level to `DEBUG` in production — raise a single package instead

---

## Correlation ID

MDC (Mapped Diagnostic Context) is the SLF4J request scope. It is thread-local,
so the encoder can add it to every line without any call-site change.

```kotlin
import org.slf4j.MDC
import java.util.UUID

class CorrelationFilter : Filter {
    override fun doFilter(req: ServletRequest, res: ServletResponse, chain: FilterChain) {
        val http = req as HttpServletRequest
        val correlationId = http.getHeader("X-Correlation-ID") ?: UUID.randomUUID().toString()

        MDC.put("correlation_id", correlationId)
        try {
            log.info { "request received" }
            chain.doFilter(req, res)
        } finally {
            MDC.clear() // mandatory: pooled threads otherwise leak the previous ID
        }
    }
}
```

With coroutines MDC does not follow a suspension across dispatchers. Add
`kotlinx-coroutines-slf4j` and launch with `MDCContext()`:

```kotlin
withContext(Dispatchers.IO + MDCContext()) {
    log.info { "charging payment" } // correlation_id is still present
}
```

Use structured arguments for per-event fields:

```kotlin
import net.logstash.logback.argument.StructuredArguments.kv

log.info("order placed", kv("order_id", order.id), kv("amount_cents", order.amountCents))
```

---

## Bad / Good

```kotlin
// Bad — string concatenation, PII, exception logged as text
log.info("placed order for " + user.email + " amount " + amount)
log.error("failed: ${e.message}")

// Good — structured fields, surrogate identity, full throwable
log.info("order placed", kv("order_id", order.id), kv("user_id", user.id),
         kv("amount_cents", amount))
log.error(e) { "order placement failed, order_id=${order.id}" }
```

Always pass the `Throwable` itself; `e.message` drops the stack trace and the cause chain.

---

## Level notes

- SLF4J levels: `TRACE`, `DEBUG`, `INFO`, `WARN`, `ERROR`. There is no `FATAL`;
  Logback maps it onto `ERROR`.
- `kotlin-logging`'s lambda form (`log.debug { expensive() }`) skips the lambda
  when the level is off. Prefer it over string concatenation everywhere.
- SLF4J placeholders are lazy too: `log.info("saved {}", id)` — never `"saved " + id`.

**Don't**
- Forget `MDC.clear()` in a `finally` block on pooled threads
- Log inside a `data class` `toString()`; it is called by the logger itself
