# Development and Verification

The source tree and `package.json` are authoritative. Do not copy historical test counts or version numbers into this guide.

## Prerequisites
- Node.js 22 or later; npm 10 or later.
- Git.
- Docker Engine/Compose only for container testing.

## Setup
```bash
npm ci
cp .env.example .env
```
PowerShell: `Copy-Item .env.example .env`. Configure only required settings. Keep real secrets in the untracked `.env`.

## Development
```bash
npm run dev
```
Check terminal output for actual local URLs and ports.

## Verification commands
| Command | Purpose |
|---|---|
| `npm run typecheck` | TypeScript check |
| `npm test` | Complete deterministic Vitest suite |
| `npm run test:server` | Server test project |
| `npm run test:client` | Client test project |
| `npm run build` | Production build |
| `npm run verify` | Typecheck, full tests, production build |
| `npm run test:sources` | Live external source diagnostics |

Run `npm run verify` before handing off substantive changes. Use focused suites first during implementation. `test:sources` sends real requests and depends on credentials, network, upstream availability and rate limits; it is not routine deterministic CI.

## Test organization
- `tests/unit/`: domain logic, utilities, adapters and database behavior.
- `tests/integration/`: API, persistence and cross-component behavior.
- `tests/client/`: React components and hooks in jsdom.
- Shared setup: `tests/setup.ts`, `tests/setupClient.ts`.
- Runner configuration: `vitest.config.ts`.

Server tests use sequential execution and shared module state. Clean up mocks, global state, timers, servers, database handles and temporary files.

## Build and start
```bash
npm run build
npm start
```

## Docker
```bash
docker compose up -d --build
docker compose logs -f pricetool
```
Compose persists application data from host `./data` to container `/data`. Never delete or replace it during routine development or verification.

## Configuration
`.env.example` is the canonical variable inventory. Keep it aligned with `src/server/config/index.ts`. Never commit real secrets.

## CI
`.github/workflows/docker-publish.yml` runs typecheck, tests and production build for pushes and pull requests targeting `main`. Publishing runs only after successful verification on push. Historical CI does not certify the current revision.
