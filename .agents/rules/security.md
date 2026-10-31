---
trigger: model_decision
description: Apply to HTTP routes, authentication, outbound requests, webhooks, exports, logs, Docker and dependency security.
---
# Security Rules
- Treat request data, external API responses, merchant metadata, imports and environment values as untrusted.
- Follow existing Fastify schema/Zod validation at HTTP boundaries; enforce domain constraints in domain code.
- Use parameterized SQL and allowlisted dynamic identifiers.
- Prevent SSRF: validate schemes, hosts, redirects and private/loopback address handling. Do not rely on string-prefix checks.
- Keep AllKeyShop behind the configured solver and existing queue/pacing/circuit-breaker policy. Never add a direct-fetch fallback or bypass upstream protections.
- Respect rate limits, Retry-After, cancellation, timeouts and bounded retries.
- Neutralize CSV formula injection in exported untrusted fields.
- Never log API keys, bearer tokens, webhook URLs, proxy credentials, cookies or secret-bearing payloads.
- Preserve authentication, trusted-origin and rate-limit behavior; test allowed and rejected cases.
- Review dependency purpose, maintenance, license, runtime impact and advisories before adding dependencies.
