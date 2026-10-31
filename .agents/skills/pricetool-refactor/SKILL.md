---
name: pricetool-refactor
description: Refactor PriceSteamTool while preserving observable behavior, data integrity and API compatibility.
---
# PriceTool Safe Refactoring
1. Define the structural improvement and behavior that must remain unchanged.
2. Inspect call sites, exports, tests, dependencies and architecture rules.
3. Establish a focused passing baseline; broaden it for cross-cutting changes.
4. Add characterization tests where behavior is insufficiently covered.
5. Refactor in small steps. Keep domain rules out of routes/UI/adapters; preserve contracts and data semantics.
6. Separate behavior changes from refactoring where practical; test intentional behavior changes explicitly.
7. Do not change persisted meaning/schema without a versioned migration.
8. Run `npm run verify`, inspect complete diff and remove only proven dead/redundant code.
9. Update architecture docs only when architecture actually changed.
A refactor is complete when behavior is protected and the maintainability benefit is concrete, not merely because line count fell.
