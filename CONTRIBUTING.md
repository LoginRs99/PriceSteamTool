# 🤝 Contributing to PriceSteamTool

Thank you for your interest in contributing to **PriceSteamTool**! We welcome bug fixes, performance improvements, new source adapter suggestions, and documentation enhancements.

Please take a moment to review this guide to ensure a smooth contribution process.

---

## 🧭 Project Principles

1. **Self-Hosted & Privacy-First**: No telemetry, no third-party cloud trackers, no selling of user data.
2. **Respectful Pacing**: Storefronts and aggregators must be accessed respectfully using token-bucket pacing, jitter, exponential backoff, and circuit breakers. Never hammer APIs.
3. **Data Integrity & Evidence Before Assertions**: Best deal calculations, historical lows, and pricing errors must be mathematically sound and backed by automated tests.
4. **Clean Code & Zero Dead Weight**: Avoid bulky third-party dependencies when simple, tested native solutions suffice.

---

## 🛠️ Local Development Setup

### Prerequisites
* **Node.js**: `22.x LTS` or higher
* **npm**: `10.x` or higher
* **Git**: `2.30+`
* **Docker & Docker Compose** (optional, for containerized development)

### Getting Started

1. **Fork and clone the repository**:
   ```bash
   git clone https://github.com/LoginRs99/PriceSteamTool.git
   cd PriceSteamTool
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Configure environment variables**:
   ```bash
   cp .env.example .env
   ```
   *(On Windows Command Prompt: `copy .env.example .env`)*

4. **Start the development server**:
   ```bash
   npm run dev
   ```
   This concurrently runs the Fastify backend (with `tsx watch` for hot reload) and the Vite React client dev server on `http://localhost:5173` (proxied to API on port `3000`).

---

## 🧪 Testing & Verification Requirements

Every change submitted via a pull request **must pass all quality gates** before being merged:

```bash
# 1. Typecheck the entire TypeScript codebase
npm run typecheck

# 2. Run the automated test suite (84 test files, 815+ tests)
npm test

# 3. Test backend or frontend specifically
npm run test:server
npm run test:client

# 4. Verify production build succeeds
npm run build
```

> [!IMPORTANT]
> - Never skip or disable failing tests. If an existing test fails, either fix the regression or update the test if requirements deliberately changed.
> - When adding new features or fixing bugs, include corresponding unit tests in `tests/unit/` or client tests in `tests/client/`.

---

## 📂 Codebase Organization

* [`src/shared/types.ts`](file:///D:/github/Pricetool/src/shared/types.ts): Single Source of Truth for TypeScript domain models, enums, and interfaces.
* [`src/server/domain/`](file:///D:/github/Pricetool/src/server/domain/): Core intelligence (Deal Score v2.4, Pricing Error detection, Tukey IQR price analysis).
* [`src/server/sources/`](file:///D:/github/Pricetool/src/server/sources/): Storefront adapters (Steam, ITAD, CheapShark, GG.deals, AllKeyShop).
* [`src/server/sync/`](file:///D:/github/Pricetool/src/server/sync/): Pacing orchestrator, circuit breakers, rate limit queues.
* [`src/server/db/`](file:///D:/github/Pricetool/src/server/db/): SQLite schema, migrations (001–033), Better-SQLite3 repositories, and online backup engine.
* [`src/server/routes/`](file:///D:/github/Pricetool/src/server/routes/): Fastify route definitions (`api.ts`, `v1.ts`) and SSE stream.
* [`src/client/`](file:///D:/github/Pricetool/src/client/): React 19 SPA, Lucide icons, Tailwind styling, and modal components.
* [`docs/`](file:///D:/github/Pricetool/docs/): Complete architectural documentation, database schemas, and developer roadmaps.

---

## 📐 Coding Conventions

* **TypeScript**: Strict mode enabled (`tsconfig.json`). Explicit type signatures on exported functions. Avoid `any` whenever specific domain types are available in `src/shared/types.ts`.
* **SQL Queries**: Always use parameterized queries (`db.prepare('... WHERE id = ?').get(id)`) to prevent SQL injection.
* **Error Handling**: Throw typed domain errors (e.g. `AllKeyShopUnavailableError`) and avoid silent `catch {}` blocks that swallow root causes without logging.
* **Comments & Documentation**: Preserve existing comments and docstrings. Add concise documentation for complex algorithms or domain equations.

---

## 🚀 Submitting a Pull Request

1. Create a feature branch from `main`:
   ```bash
   git checkout -b feat/your-feature-name
   ```
2. Make atomic, focused commits with standard conventional commit prefixes:
   - `feat:` New functionality
   - `fix:` Bug fix
   - `perf:` Performance improvement
   - `docs:` Documentation changes
   - `test:` Adding or refactoring tests
   - `refactor:` Code refactoring without behavior change
3. Run verification:
   ```bash
   npm run typecheck && npm test && npm run build
   ```
4. Push your branch and open a Pull Request against `main`. Provide a clear description of the problem solved and the tests verifying your change.
