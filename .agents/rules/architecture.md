---
trigger: model_decision
description: Apply to module boundaries, API contracts, shared types, source adapters and cross-cutting behavior.
---
# Architecture Rules
- Inspect current implementation; source and tests outrank stale diagrams.
- Preserve Fastify/Node server, React/Vite client, shared TypeScript contracts and SQLite unless scope explicitly changes them.
- Respect boundaries: shared contracts in `src/shared/`; domain in `src/server/domain/`; integrations in `src/server/sources/`; orchestration in `src/server/sync/`; persistence in `src/server/db/`; HTTP in `src/server/routes/`; UI in `src/client/`.
- Keep business rules out of routes, UI and adapters. Reuse existing normalizers, repositories, safe-fetch, pacing and error patterns.
- Normalize and validate external data before it enters domain or storage.
- Preserve source provenance, canonical offer deduplication, raw currency metadata and EUR normalization semantics.
- Maintain API compatibility unless a breaking change is explicitly intended and documented.
- Avoid speculative abstractions and unnecessary dependencies.
