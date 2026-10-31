---
name: pricetool-audit
description: Perform a read-only technical audit of PriceSteamTool code, tests, architecture, security, data integrity, dependencies or documentation.
---
# PriceTool Technical Audit
Default to read-only. Do not implement fixes unless explicitly requested.
1. Record repository, branch, revision and working-tree state.
2. Define scope; inspect source, tests, config, docs, history and CI. Do not infer unseen behavior from README.
3. Trace important data paths end-to-end and inspect boundary/error cases.
4. Distinguish static inspection, executed tests, runtime checks, CI evidence and live external checks.
5. For each finding report severity (Critical/High/Medium/Low/Info), confidence (Confirmed/Likely/Needs runtime validation), evidence, impact, recommendation and regression test.
6. Avoid speculative padding and duplicate symptoms; group by root cause.
7. Prioritize remediation and list what was not tested.
Never claim production certification from a green test suite alone.
