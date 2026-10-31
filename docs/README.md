# PriceSteamTool Documentation

Source code, tests, migrations and configuration are authoritative when docs disagree.

## Start here
| Resource | Purpose |
|---|---|
| [README](../README.md) | Product overview, deployment and quick start |
| [Contributing](../CONTRIBUTING.md) | Development and contribution guide |
| [Security](../SECURITY.md) | Vulnerability reporting and deployment security |
| [Product](../PRODUCT.md) | Product purpose, users and constraints |
| [Agent working agreement](../GEMINI.md) | Antigravity operating instructions |
| [Agent rules](../.agents/rules/) | Architecture, testing, database, security and docs invariants |
| [Agent skills](../.agents/skills/) | Reusable task playbooks |

## Architecture and implementation
- [Architecture](architecture.md)
- [Data model](data-model.md)
- [Synchronization](sync.md)
- [Sources](sources.md)
- [API data matrix](api-data-matrix.md)
- [Backup and restore](backup-restore.md)
- [Development and verification](development.md)
- [User guide](user-guide.md)

## Product and engineering records
- [Ideas and roadmap](ideas-and-roadmap.md) — candidate ideas, not committed delivery.
- [Project logs](project-logs.md) — historical engineering context.
- [Changelog](../CHANGELOG.md) — released user-visible changes.

## Third-party references
- [CheapShark API notes](CheapShark%20API.md)
- [GG.deals API notes](GGDEALS.md)

## Historical snapshots
These are point-in-time context, not current specifications or proof of current verification:
- [Project summary v2.8.2](archive/project-summary-v2.8.2.md)
- [Root AI summary v2.8.2](archive/PROJECT_SUMMARY-v2.8.2.md)
- [Technical audit, 2026-10-28](archive/audit-2026-10-28.md)
- [Real-world validation, 2026-08-15](archive/real-world-validation-2026-08-15.md)

## Documentation policy
1. Update existing pages before creating overlapping docs.
2. Use repository-relative links; never use local `file:///` paths.
3. Avoid hard-coded changing test counts, coverage, migration counts and "all green" claims.
4. Record durable architecture trade-offs as ADRs; use project logs for historical context and CHANGELOG for released user-facing changes.
5. Keep operational steps aligned with scripts, Docker files and config.
