---
name: pricetool-verify
description: Run PriceSteamTool verification gates and report exact results for the current revision.
---
# PriceTool Verification
1. Read `package.json` and `vitest.config.ts`; do not assume commands.
2. Record branch, commit and working-tree state.
3. Use focused server/client suites during development.
4. For substantive handoff run `npm run verify` (typecheck → full Vitest suite → production build).
5. Run migration/backup/API/security tests when the affected area warrants them.
6. Run `npm run test:sources` only when live external connectivity is explicitly in scope; it sends real requests and can be rate-limited.
7. For Docker changes, build/start image, inspect health/logs and validate persistence only in an authorized Docker environment.
8. Capture exact command, exit status and relevant output. Distinguish failed, blocked and not-run.
9. Never invent test totals, coverage, timings, CI status or successful outcomes. CI validates only its own commit.

## Report
- Revision:
- Focused checks:
- Typecheck:
- Full tests:
- Production build:
- Risk-specific checks:
- Live checks (if run):
- Docker checks (if run):
- Remaining unverified items:
