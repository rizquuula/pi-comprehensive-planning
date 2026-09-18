# Logging in C++

**Library:** `spdlog`. It is fast, thread-safe, and formats through `fmt`. It
supports async logging, rotating files, and custom patterns. Nothing in the
standard library covers this.

---

## Setup

**Do**
- Configure the loggers once, early in `main`
- Default to `info`; read the level from an environment variable
- Emit one JSON object per line through a custom pattern
- Register named loggers so each component can be tuned separately

```cpp
#include <spdlog/spdlog.h>
#include <spdlog/sinks/stdout_color_sinks.h>
#include <spdlog/async.h>
#include <cstdlib>

void init_logging() {
    spdlog::init_thread_pool(8192, 1);

    auto sink = std::make_shared<spdlog::sinks::stdout_sink_mt>();
    auto logger = std::make_shared<spdlog::async_logger>(
        "app", sink, spdlog::thread_pool(), spdlog::async_overflow_policy::block);

    // One JSON object per line. %v is the already-formatted message.
    logger->set_pattern(
        R"({"ts":"%Y-%m-%dT%H:%M:%S.%eZ","level":"%l","logger":"%n","msg":%v})");

    const char* lvl = std::getenv("LOG_LEVEL");
    logger->set_level(lvl ? spdlog::level::from_str(lvl) : spdlog::level::info);
    logger->flush_on(spdlog::level::err);
    spdlog::set_default_logger(logger);
}
```

Because `%v` is raw text, build the message body with `fmt` so it is valid JSON.

**Don't**
- Use `std::cout` or `printf` for diagnostics; neither is thread-safe as a record
- Create a logger per object; look up a named logger or hold a shared pointer
- Forget `spdlog::shutdown()` before exit with async loggers — queued records are lost

---

## Correlation ID

spdlog has no MDC. Two patterns work.

**Logger per request** — one allocation per request:

```cpp
class RequestLogger {
public:
    RequestLogger(std::shared_ptr<spdlog::logger> base, std::string correlation_id)
        : base_(std::move(base)), correlation_id_(std::move(correlation_id)) {}

    template <typename... Args>
    void info(fmt::format_string<Args...> fmt_str, Args&&... args) const {
        base_->info(R"({{"correlation_id":"{}","msg":"{}"}})",
                    correlation_id_,
                    fmt::format(fmt_str, std::forward<Args>(args)...));
    }

private:
    std::shared_ptr<spdlog::logger> base_;
    std::string correlation_id_;
};
```

Pass it down the call chain, or store it on the request context object your
framework already threads through.

**Thread-local context** — when threading a logger through is impractical:

```cpp
inline thread_local std::string t_correlation_id;

struct CorrelationScope {
    explicit CorrelationScope(std::string id) { t_correlation_id = std::move(id); }
    ~CorrelationScope() { t_correlation_id.clear(); } // RAII: never leak into the next request
};
```

Read `t_correlation_id` in a custom formatter flag so every line carries it.
This pattern breaks with coroutines or work-stealing pools, where a task can
resume on another thread. Prefer the logger-per-request pattern there.

---

## Bad / Good

```cpp
// Bad — concatenated stream output, no fields, no correlation
std::cout << "placed order for user " << user_id
          << " amount " << amount_cents << std::endl;

// Good — one structured record with the IDs a search needs
req_log.info(R"("order_id":"{}","user_id":"{}","amount_cents":{})",
             order_id, user_id, amount_cents);
SPDLOG_ERROR("order placement failed order_id={} cause=\"{}\"", order_id, e.what());
```

---

## Level notes

- spdlog levels: `trace`, `debug`, `info`, `warn`, `err`, `critical`, `off`.
  The names are `err` and `warn` — not `error` and `warning` — in the API.
- `#define SPDLOG_ACTIVE_LEVEL SPDLOG_LEVEL_INFO` before the include compiles
  lower levels out. It affects the `SPDLOG_*` macros only, not member calls.
- Use the `SPDLOG_*` macros when you want file and line in the pattern (`%s:%#`).
- `set_level` on one logger does not change others; use `spdlog::apply_all`.

**Don't**
- Format arguments eagerly before the level check (`logger->debug(expensive())`)
