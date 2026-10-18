# 📚 PriceSteamTool — Documentation Hub & Sitemap

Welcome to the comprehensive documentation directory for **PriceSteamTool** (v2.7.0). This directory serves as the Single Source of Truth for system architecture, data models, source adapters, synchronization mechanics, project logs, release history, and future development roadmaps.

---

## 🗺️ Master Documentation Index

### 🌟 Core Summaries, Logs & Strategic Direction
| Document | Description | Target Audience |
| :--- | :--- | :--- |
| [**`project-summary.md`**](file:///D:/github/Pricetool/docs/project-summary.md) | **Master Project Summary & Architecture Reference**: Complete technical specification, core intelligence engines (Deal Score, Pricing Errors, Purchase Advice, Savings Tracker), adapter matrix, 16 SQLite tables, and operational guide. | Developers, Architects, AI Assistants |
| [**`project-logs.md`**](file:///D:/github/Pricetool/docs/project-logs.md) | **Comprehensive Project Logs & Engineering Ledger**: Complete version release history (v1.0.0 through v2.7.0), full database migration ledger (001–031), Architectural Decision Records (ADR-001 through ADR-012), incident post-mortems, and test suite evolution. | Maintainers, Contributors, Tech Leads |
| [**`ideas-and-roadmap.md`**](file:///D:/github/Pricetool/docs/ideas-and-roadmap.md) | **Ideas, Concepts & Strategic Roadmap**: Categorized innovation ledger covering ML sale forecasting, publisher fake discount tracking, HowLongToBeat value metrics, ProtonDB badges, budget cart optimization, active bundle aggregators, Telegram bot alerts, and offsite backups. | Product Owners, Developers, Visionaries |

---

### 🧠 System Architecture & Data Specifications
| Document | Description | Target Audience |
| :--- | :--- | :--- |
| [**`architecture.md`**](file:///D:/github/Pricetool/docs/architecture.md) | **System Architecture**: Single-process Node.js 22 + Fastify 5 runtime, React 19 SPA, SQLite WAL persistence, decoupled pacing queues, circuit breakers, and container security posture. | Software Engineers, DevOps |
| [**`data-model.md`**](file:///D:/github/Pricetool/docs/data-model.md) | **Domain Data Model**: Detailed schema specification for all 16 SQLite tables, entity-relationship ASCII diagram, composite index topology, and migration strategies. | Database Administrators, Backend Devs |
| [**`api-data-matrix.md`**](file:///D:/github/Pricetool/docs/api-data-matrix.md) | **API Data Matrix**: Source query capabilities, batch limits, rate limits, authentication requirements, and payload support across Steam, ITAD, CheapShark, GG.deals, and AllKeyShop. | Integrators, API Consumers |

---

### 🔄 Ingestion, Sources & Synchronization
| Document | Description | Target Audience |
| :--- | :--- | :--- |
| [**`sources.md`**](file:///D:/github/Pricetool/docs/sources.md) | **Source Comparison & Integration Analysis**: Deep technical breakdown of each digital storefront adapter, batching efficiencies (CheapShark 25x, ITAD 200x), solver requirements (Byparr/FlareSolverr), and epoch header parsing. | Backend Engineers |
| [**`sync.md`**](file:///D:/github/Pricetool/docs/sync.md) | **Synchronization Engine & Queue Orchestration**: Token-bucket pacing, 4-state circuit breakers (`NORMAL`, `BACKOFF`, `PAUSED`, `COOLDOWN`), priority scheduling, and Server-Sent Events (SSE) telemetry. | Systems Engineers |

---

### 📖 User & Operational Guides
| Document | Description | Target Audience |
| :--- | :--- | :--- |
| [**`user-guide.md`**](file:///D:/github/Pricetool/docs/user-guide.md) | **User & Intelligence Guide**: Explains the 2D pricing engine, Deal Score v2.3 formula, the 4 pillars ($S_{\text{atl}}$, $S_{\text{disc}}$, $S_{\text{hist}}$, $S_{\text{mkt}}$), score tiers, purchase verdicts, and price volatility. | End Users, Gamers, Operators |
| [**`backup-restore.md`**](file:///D:/github/Pricetool/docs/backup-restore.md) | **Database Backup & Disaster Recovery Guide**: Zero-downtime online SQLite backup engine (`better-sqlite3` backup API + `wal_checkpoint`), integrity verification (`quick_check`), rolling 7-day retention, and step-by-step restore instructions. | System Administrators |
| [**`development.md`**](file:///D:/github/Pricetool/docs/development.md) | **Development & Deployment Guide**: Local environment setup, test runner commands, Docker orchestration, environment variables reference, and GitHub Actions CI/CD pipeline. | Contributors, Maintainers |
| [**`audit.md`**](file:///D:/github/Pricetool/docs/audit.md) | **Technical Audit & Validation Report**: Verification scorecard across architecture, scoring formulas, self-healing anomalies, backups, multi-currency, and the 82 automated test suites (776 tests passing). | Quality Assurance, Auditors |
| [**`real-world-validation.md`**](file:///D:/github/Pricetool/docs/real-world-validation.md) | **Real-World Validation**: Historical test results, real catalog edge cases, and performance benchmarks under 2,000+ item workloads. | Testers, Data Scientists |

---

### 🔌 Third-Party Reference Material
* [**`CheapShark API.md`**](file:///D:/github/Pricetool/docs/CheapShark%20API.md): Official CheapShark REST API reference and parameters.
* [**`GGDEALS.md`**](file:///D:/github/Pricetool/docs/GGDEALS.md): GG.deals API documentation and response schemas.

---

*This documentation directory is automatically indexed and updated with each release of PriceSteamTool.*
