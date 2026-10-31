---
name: pricetool-feature
description: Implement a PriceSteamTool feature from acceptance criteria through architecture-aware changes, regression tests, verification and documentation.
---
# PriceTool Feature
You are the feature's primary owner. Follow `GEMINI.md` and applicable rules.
1. Convert request into observable acceptance criteria; ask only when missing information changes the outcome.
2. Trace current behavior through UI, API, domain, source, sync, persistence and shared types as relevant.
3. Identify affected contracts, migrations, failure modes and checks. Plan proportionately.
4. For behavior changes, add a focused test and observe expected failure when practical. Use test-driven-development and vitest-skill where helpful.
5. Implement incrementally; preserve boundaries and public contracts. Avoid unrelated refactors and unnecessary dependencies.
6. Cover invalid input, empty results, partial upstream failure, timeout, cancellation, stale data, duplicates and persistence errors as relevant.
7. Run focused tests, then `npm run verify` for substantive changes.
8. Review full diff and update existing docs/config examples only where behavior changed.
9. Report criteria met, files, exact checks/results, assumptions and remaining risks.
Never claim Docker, external API, performance or runtime verification unless performed.
