---
trigger: model_decision
description: Apply when changing README, docs, release notes, product requirements, architecture decisions, configuration or user-facing behavior.
---
# Documentation Rules
- Use `docs/README.md` as the index; place facts in the existing document with clearest ownership.
- Prefer updating an existing page over creating another summary or overlapping guide.
- Use repository-relative links only; never commit local machine paths.
- Source, tests, `package.json`, `.env.example`, migrations, Docker and CI are implementation truth.
- Keep `.env.example` aligned with `src/server/config/index.ts`; never include real secrets.
- Document API/schema/config/operational/user-visible changes in existing reference pages.
- README is user-facing; CONTRIBUTING is contributor-facing; CHANGELOG is released user-visible changes; project logs preserve engineering context.
- Do not hard-code changing test counts, coverage, performance claims or "all green" in evergreen docs. Date historical measurements and state limitations.
- Archive superseded audits and validation snapshots; they are not current certification.
- Create ADRs only for durable decisions with meaningful alternatives and trade-offs.
- Keep docs concise, accurate and actionable.
