---
trigger: model_decision
description: Apply to SQLite schema, migrations, repositories, price history, offers, transactions, backup and restore.
---
# Database and Data Integrity Rules
- Treat `/data/pricetool.db` and backups as user data. Never delete, replace, reset or seed production data during routine development/tests.
- Inspect schema, migrations, affected repository and migration tests before changing persistence.
- Never edit or renumber a migration that may have run. Add a new sequential migration using the existing mechanism.
- Test fresh initialization and upgrade from a representative prior schema; verify preserved rows, constraints and indexes.
- Use parameterized SQL. Allowlist dynamic identifiers; SQL parameters cannot bind table/column names.
- Preserve transaction consistency, canonical offer uniqueness, source observations, price history and anomaly lifecycle semantics.
- Keep EUR normalization and raw source currency/conversion metadata consistent; test conversion and rounding boundaries.
- Preserve WAL, foreign keys, backup, integrity-check and retention guarantees.
- Never fabricate historical lows or synthetic price observations to fill missing history.
