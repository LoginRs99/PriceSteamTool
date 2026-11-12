import fs from 'fs';
import path from 'path';
import { config } from '../config/index.js';

const logFilePath = path.join(config.dataDir, 'sync_diagnostics.log');

/**
 * Redacts sensitive credentials (API keys, tokens, webhooks, passwords)
 * from URLs, error messages, and log lines.
 */
export function sanitizeSecrets(text: string): string {
  if (!text || typeof text !== 'string') return text;

  let sanitized = text;

  // 1. Redact URL query parameters (e.g. ?key=..., &api_key=..., &token=...)
  sanitized = sanitized.replace(
    /([?&](?:key|api_key|apiKey|token|password|secret|auth)=)([^&\s"'>]+)/gi,
    '$1[REDACTED]'
  );

  // 1b. Redact key-value pairs in text and JSON bodies (e.g. key=..., "token": "...")
  sanitized = sanitized.replace(
    /(["']?(?:(?<![a-zA-Z0-9_])key|api[_-]?key|apiKey|api[_-]?token|token|password|secret|auth)["']?\s*[:=]\s*["']?)([^"'\s,;&]+)(["']?)/gi,
    '$1[REDACTED]$3'
  );

  // 2. Redact Authorization Bearer tokens
  sanitized = sanitized.replace(
    /(Bearer\s+)[A-Za-z0-9\-._~+/]+=*/gi,
    '$1[REDACTED]'
  );

  // 3. Redact Discord webhook URLs (contains webhook token in path)
  sanitized = sanitized.replace(
    /(https?:\/\/(?:ptb\.|canary\.)?discord(?:app)?\.com\/api\/webhooks\/\d+\/)([A-Za-z0-9_-]+)/gi,
    '$1[REDACTED]'
  );

  // 4. Redact known runtime secrets from config if present
  try {
    if (config?.itadApiKey && config.itadApiKey.length >= 6) {
      sanitized = sanitized.split(config.itadApiKey).join('[REDACTED]');
    }
    if (config?.steamApiKey && config.steamApiKey.length >= 6) {
      sanitized = sanitized.split(config.steamApiKey).join('[REDACTED]');
    }
    if (config?.apiToken && config.apiToken.length >= 6) {
      sanitized = sanitized.split(config.apiToken).join('[REDACTED]');
    }
  } catch {}

  return sanitized;
}

export function logInfo(message: string, context?: Record<string, any>): void {
  const timestamp = new Date().toISOString();
  const contextStr = context ? ` | ${JSON.stringify(context)}` : '';
  const logLine = sanitizeSecrets(`[${timestamp}] [INFO] ${message}${contextStr}`);
  
  console.log(logLine);
  appendToFile(logLine);
}

export function logWarn(message: string, context?: Record<string, any>): void {
  const timestamp = new Date().toISOString();
  const contextStr = context ? ` | ${JSON.stringify(context)}` : '';
  const logLine = sanitizeSecrets(`[${timestamp}] [WARN] ⚠️ ${message}${contextStr}`);
  
  console.warn(logLine);
  appendToFile(logLine);
}

export function logError(message: string, error?: any): void {
  const timestamp = new Date().toISOString();
  const errStr = error ? (error.stack || error.message || JSON.stringify(error)) : '';
  const logLine = sanitizeSecrets(`[${timestamp}] [ERROR] ❌ ${message} ${errStr}`);
  
  console.error(logLine);
  appendToFile(logLine);
}

export function logSummaryReport(report: {
  runId: string;
  trigger: string;
  profileName: string;
  steamId: string;
  status: string;
  durationSec: number;
  totalWishlist: number;
  staleQueried: number;
  cacheHitPercent: number;
  offersUpdated: number;
  selectedSources: string[];
  sourceStats: Record<string, { requests: number; success: number; failures: number; rateLimits: number; state: string }>;
}): void {
  const border = '='.repeat(68);
  const divider = '-'.repeat(68);
  const now = new Date().toISOString();

  const lines = [
    '',
    border,
    `📊 PRICETOOL SYNC SUMMARY REPORT [${now}]`,
    divider,
    `Profile:              ${report.profileName} (${report.steamId})`,
    `Trigger:              ${report.trigger}`,
    `Run ID:               ${report.runId}`,
    `Status:               ${report.status} (${report.durationSec}s)`,
    `Total Wishlist Games: ${report.totalWishlist}`,
    `Items Queried:        ${report.staleQueried} (Cache Hit Ratio: ${report.cacheHitPercent.toFixed(1)}%)`,
    `Offers Ingested:      ${report.offersUpdated}`,
    `Active Sources:       ${report.selectedSources.join(', ')}`,
    divider,
    'Circuit Breaker & Source Health:'
  ];

  for (const [code, stats] of Object.entries(report.sourceStats)) {
    lines.push(
      `  • ${code.padEnd(12)}: State: [${stats.state}] | Req: ${stats.requests} | OK: ${stats.success} | 429: ${stats.rateLimits} | Err: ${stats.failures}`
    );
  }

  lines.push(border, '');
  const reportText = lines.join('\n');

  console.log(reportText);
  appendToFile(reportText);
}

export function getRecentDiagnosticsLogs(linesCount: number = 200): string {
  try {
    if (!fs.existsSync(logFilePath)) {
      return 'No diagnostics log file created yet.';
    }
    const content = fs.readFileSync(logFilePath, 'utf-8');
    const sanitized = sanitizeSecrets(content);
    const lines = sanitized.split('\n');
    return lines.slice(-linesCount).join('\n');
  } catch (err: any) {
    return `Error reading log file: ${err.message}`;
  }
}

const MAX_LOG_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

function appendToFile(text: string): void {
  try {
    if (fs.existsSync(logFilePath)) {
      const stats = fs.statSync(logFilePath);
      if (stats.size >= MAX_LOG_SIZE_BYTES) {
        fs.renameSync(logFilePath, `${logFilePath}.1`);
      }
    }
    fs.appendFileSync(logFilePath, text + '\n', 'utf-8');
  } catch (e) {
    // Suppress filesystem write error
  }
}

