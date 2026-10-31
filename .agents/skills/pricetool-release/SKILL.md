---
name: pricetool-release
description: Prepare a PriceSteamTool release with verification, version/changelog consistency, CI/Docker review and release-risk assessment.
---
# PriceTool Release Preparation
1. Confirm target version/scope. Inspect package.json, tags/releases, CHANGELOG, Git history and CI.
2. Verify branch and working tree; never release from an unexpected branch or include unrelated changes.
3. Review user-visible changes, compatibility, migration order, env defaults and rollback/deployment implications.
4. Update CHANGELOG with concise user-facing changes, not an engineering diary.
5. Run `/pricetool-verify` plus applicable database, security and Docker checks.
6. Review lockfile consistency and release/publish workflow conditions.
7. Inspect full diff and ensure release notes do not claim unrun checks.
8. Do not tag, publish, deploy, release or merge without explicit user authorization.
9. Report version, changes, evidence, deployment considerations and blockers.
