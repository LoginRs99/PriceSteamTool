---
name: pricetool-bugfix
description: Diagnose and repair PriceSteamTool defects with evidence, root-cause analysis, regression tests and verification.
---
# PriceTool Bug Fix
1. Start with `systematic-debugging`: read exact error, reproduce, inspect recent diffs and trace data/control flow.
2. Record a concise hypothesis and evidence; separate confirmed cause from speculation.
3. Compare with a similar working path, including assumptions, state and error handling.
4. Add a focused regression test. Verify it fails for the original defect when feasible; otherwise explain how it protects behavior.
5. Make the smallest root-cause correction. Do not bundle unrelated cleanup.
6. Re-run regression and relevant suite; run `npm run verify` for substantive repairs.
7. Check warnings, leaked state, unhandled promises, retry amplification and weakened assertions.
8. Update docs only if a documented contract/configuration/operation changed.
9. Report reproduction, cause, fix, test, exact verification and residual uncertainty.
After repeated failed fixes, stop guessing and reassess design. Distinguish incident containment from permanent repair.
