# Seam Catalog

The seams that usually pay off, grouped by project kind. Each row names one seam, what it abstracts, and the second implementation it anticipates.

Build a seam from this catalog when the project matches the group and the second implementation is plausible. Skip a row when no roadmap item and no plausible second implementation exist.

---

## LLM and agent applications

These projects change provider, tool set, and transport more often than they change domain logic. The seams below absorb those changes.

| Seam | What it abstracts | Second implementation it anticipates |
|---|---|---|
| Model provider port | Chat and completion calls | A second vendor, or a local model |
| Tool registry | Tool lookup by name | A tool added by a plugin or a config file |
| Memory store port | Conversation and agent state | Redis, Postgres, or a file store |
| Prompt template source | Where prompt text comes from | Templates loaded from disk or a service |
| Transport port | How a request reaches the agent | HTTP, a queue consumer, or a CLI |
| Tracing sink | Where spans and traces go | Langfuse, OpenTelemetry, or a log file |
| Sub-agent factory | How a child agent is built | A second agent type with other tools |
| Checkpoint store | Run state between steps | Durable storage for resume after a crash |
| Output parser | How model text becomes a typed value | Structured output, or a second schema |

---

## Web backends

These projects change persistence, outbound integrations, and identity providers. Domain rules stay longer than any of them.

| Seam | What it abstracts | Second implementation it anticipates |
|---|---|---|
| Repository per aggregate | Load and save for one aggregate | A second database, or a read replica |
| Outbound HTTP client port | Calls to one external service | A sandbox client, or a second vendor |
| Message bus port | Publish and subscribe | Kafka, NATS, or an in-process bus |
| Auth provider port | Identity and token checks | OIDC, an API key, or a service token |
| Cache port | Read-through cache access | Redis after an in-memory start |
| Clock port | Current time | A fixed clock in tests |
| ID generator port | New identifiers | UUIDv7 after an integer sequence |
| Unit of work | Transaction scope | A second store in the same transaction |

---

## CLIs and tools

These projects grow by command count and by output format. Both grow faster than the core logic.

| Seam | What it abstracts | Second implementation it anticipates |
|---|---|---|
| Command registry | Command lookup by name | Every command added after the first |
| Output renderer | How a result is printed | JSON and table output beside text |
| Config source | Where settings come from | A file, environment variables, and flags |
| Filesystem port | File read and write | An in-memory filesystem in tests |
| Prompt and input port | How the tool asks the user | Non-interactive mode for scripts |
| Exit code mapper | Domain error to exit status | A second error class with its own code |

---

## Data pipelines

These projects grow by connector count. The transform core stays stable while sources and sinks multiply.

| Seam | What it abstracts | Second implementation it anticipates |
|---|---|---|
| Source connector | How records enter the pipeline | A second source, such as a file or an API |
| Sink connector | Where records land | A warehouse beside the first store |
| Transform step interface | One step in the chain | Every step added after the first |
| Scheduler port | What triggers a run | Cron, an event, or a manual trigger |
| Checkpoint store | Progress between runs | Durable offsets for resume |
| Record schema registry | Field shape per stream | A second stream, or a schema version bump |
| Dead-letter sink | Where bad records go | A queue after a log-only start |
