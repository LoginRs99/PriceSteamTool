---
trigger: model_decision
description: Apply when changing tests, async behavior, services, UI, sync or verification.
---
# Testing and Verification Rules
- Read `vitest.config.ts` before changing runner behavior. Server tests cover `tests/unit/` and `tests/integration/`; client tests live in `tests/client/` using jsdom.
- Server execution is sequential and uses shared module state (`isolate: false`). Treat config, singletons, timers and global mocks as shared mutable state.
- Test observable behavior and contracts, not private implementation details.
- Add regression tests for bugs and boundary coverage for pricing, scoring, currencies, migrations and synchronization where relevant.
- Prefer fixed fixtures, fake clocks and deterministic randomness. Avoid real sleeps and live storefront calls in unit tests.
- Restore spies/mocks, clear timers, close servers/database handles and clean temporary state on all paths.
- Never weaken assertions, delete tests or silence global warnings to obtain green output.
- Focused checks: `npm run test:server` and/or `npm run test:client`.
- Standard gate: `npm run verify` (typecheck → full tests → production build).
- `npm run test:sources` is live network diagnostics, not deterministic CI.
- Coverage is not currently a configured gate. Do not invent thresholds or percentages; establish baseline/provider before adopting one.
- Record exact command and observed result. Distinguish failed, blocked, not run and passed.
