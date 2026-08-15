import fs from 'fs';
import path from 'path';
import { config } from '../config/index.js';

const logFilePath = path.join(config.dataDir, 'sync_diagnostics.log');

export function logInfo(message: string, context?: Record<string, any>): void {
  const timestamp = new Date().toISOString();
  const contextStr = context ? ` | ${JSON.stringify(context)}` : '';
  const logLine = `[${timestamp}] [INFO] ${message}${contextStr}`;
  
  console.log(logLine);
  appendToFile(logLine);
}

export function logWarn(message: string, context?: Record<string, any>): void {
  const timestamp = new Date().toISOString();
  const contextStr = context ? ` | ${JSON.stringify(context)}` : '';
  const logLine = `[${timestamp}] [WARN] ⚠️ ${message}${contextStr}`;
  
  console.warn(logLine);
  appendToFile(logLine);
}

export function logError(message: string, error?: any): void {
  const timestamp = new Date().toISOString();
  const errStr = error ? (error.stack || error.message || JSON.stringify(error)) : '';
  const logLine = `[${timestamp}] [ERROR] ❌ ${message} ${errStr}`;
  
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
    const lines = content.split('\n');
    return lines.slice(-linesCount).join('\n');
  } catch (err: any) {
    return `Error reading log file: ${err.message}`;
  }
}

function appendToFile(text: string): void {
  try {
    fs.appendFileSync(logFilePath, text + '\n', 'utf-8');
  } catch (e) {
    // Suppress filesystem write error
  }
}
