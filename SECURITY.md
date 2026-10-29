# 🛡️ Security Policy

We take the security of **PriceSteamTool** seriously. As a self-hosted price intelligence application handling API tokens, webhook URLs, and external web requests, protecting user infrastructure and network boundaries is a paramount priority.

---

## 📦 Supported Versions

Only the latest active minor release receives active security patches.

| Version | Supported |
| :--- | :--- |
| **2.8.x** | :white_check_mark: Fully Supported |
| **2.7.x** | :warning: Critical Fixes Only |
| **< 2.7.0** | :x: End of Life (Please Upgrade) |

---

## 🔒 Reporting a Vulnerability

If you discover a potential security vulnerability within PriceSteamTool:

> [!IMPORTANT]
> **Please DO NOT report security vulnerabilities through public GitHub issues, discussions, or pull requests.**

Instead, please report the vulnerability privately through one of the following methods:

1. **GitHub Private Security Advisory**: Use the [Security Advisories](https://github.com/LoginRs99/PriceSteamTool/security/advisories) tab on GitHub and click **"New draft security advisory"**.
2. **Direct Maintainer Contact**: Contact the repository owner directly through GitHub or your established private communication channel.

### What to Include in Your Report
To help us triage and resolve the issue quickly, please provide:
* A detailed description of the vulnerability and its potential impact (e.g. SSRF, rate limit exhaustion, CSV injection).
* Step-by-step reproduction instructions or a minimal Proof of Concept (PoC).
* Any affected routes, files, or configuration parameters.
* Your recommended mitigation or patch, if available.

### Response Timeline
* **Initial Acknowledgement**: Within 48 hours.
* **Assessment & Fix Development**: Within 7 business days for high/critical severity issues.
* **Release & Public Disclosure**: A patched release will be published before public disclosure.

---

## 🛡️ Built-in Security Safeguards

PriceSteamTool incorporates multiple layers of security hardening by default:

* **CWE-1236 (CSV Formula Injection)**: CSV exports automatically neutralize formula trigger characters (`=`, `+`, `-`, `@`, `\t`, `\r`) by prepending a single quote (`'`).
* **CWE-918 (Server-Side Request Forgery)**: External notification webhooks (Discord) enforce strict domain allowlisting and URL validation (`isValidDiscordWebhookUrl`), blocking loops to internal loopback (`127.0.0.1`, `localhost`) or private network ranges (`10.0.0.0/8`, `192.168.0.0/16`).
* **CWE-400 / CWE-770 (Resource Exhaustion)**: In-memory sliding-window IP rate limiters enforce a maximum capacity ceiling (`MAX_ENTRIES = 5000`) with LRU eviction to prevent memory exhaustion under distributed spoofing.
* **SQL Injection Prevention**: All SQLite queries utilize parameterized prepared statements via `better-sqlite3`. Dynamic SQL filters strictly validate and escape column names and operators.
* **Path Traversal Prevention**: User inputs (such as Steam IDs) are URL-encoded (`encodeURIComponent`) before inclusion in remote fetch URLs.
* **Optional API Token**: The `API_TOKEN` environment variable provides shared-secret Bearer authentication (`X-API-Token` header) across all endpoints.

---

## 💡 Best Practices for Deployers

When deploying PriceSteamTool in production:
1. **Reverse Proxy & HTTPS**: Run behind a hardened reverse proxy (Caddy, Nginx, Traefik, or Cloudflare Tunnel) with valid TLS certificates.
2. **Set `API_TOKEN`**: If exposing your instance to the public internet, always set `API_TOKEN=your-strong-random-secret`.
3. **Configure `TRUSTED_ORIGINS`**: Explicitly set `TRUSTED_ORIGINS=https://your-domain.com` to restrict cross-origin browser requests.
4. **Regular Backups**: Utilize the zero-downtime backup engine via `POST /api/backup` or enable the automated daily snapshot scheduler (`BACKUP_ENABLED=true`).
