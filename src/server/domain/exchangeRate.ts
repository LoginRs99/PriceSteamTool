/**
 * ExchangeRateService: Handles currency normalization to EUR.
 * Caches exchange rates in memory for 24 hours with reliable fallback rates.
 */

export interface ExchangeRates {
  base: string;
  rates: Record<string, number>; // Currency to EUR multiplier (e.g., USD: 0.92 means 1 USD = 0.92 EUR)
  lastUpdated: number;
}

// Fallback rates relative to EUR (1 TargetCurrency = X EUR)
export const FALLBACK_TO_EUR_RATES: Record<string, number> = {
  EUR: 1.0,
  USD: 0.92,
  GBP: 1.17,
  HUF: 0.0025, // ~400 HUF = 1 EUR
  PLN: 0.23,
  CAD: 0.68,
  AUD: 0.60,
  CHF: 1.05,
  JPY: 0.0062,
  CNY: 0.13,
  BRL: 0.16,
  TRY: 0.026,
  NOK: 0.086,
  SEK: 0.088,
  DKK: 0.134,
  NZD: 0.55,
  RUB: 0.0100,
  KRW: 0.00069,
  VND: 0.000037,
  IDR: 0.000059,
  CLP: 0.00095,
  COP: 0.00023,
  MXN: 0.053,
  ZAR: 0.050,
  HKD: 0.115,
  SGD: 0.69,
  TWD: 0.028,
  THB: 0.026,
  MYR: 0.20,
  PHP: 0.016,
  INR: 0.011,
  UAH: 0.022,
  CZK: 0.040,
  RON: 0.20,
  BGN: 0.51,
  ISK: 0.0067
};

const warnedCurrencies = new Set<string>();

export class ExchangeRateService {
  private ratesToEur: Map<string, number> = new Map();
  private lastFetched: number = 0;
  private cacheTtlMs: number = 24 * 60 * 60 * 1000; // 24 hours

  constructor() {
    this.initFallbackRates();
  }

  private initFallbackRates() {
    for (const [curr, rate] of Object.entries(FALLBACK_TO_EUR_RATES)) {
      this.ratesToEur.set(curr.toUpperCase(), rate);
    }
  }

  /**
   * Normalizes common currency symbols or strings to standard 3-letter ISO code
   */
  public normalizeCurrencyCode(rawCurrency: string = 'EUR'): string {
    const clean = rawCurrency.trim().toUpperCase();
    if (clean === '€' || clean === 'EUR' || clean === 'EURO' || clean === 'EU') return 'EUR';
    if (clean === '$' || clean === 'USD' || clean === 'US') return 'USD';
    if (clean === '£' || clean === 'GBP' || clean === 'UKP') return 'GBP';
    if (clean === 'FT' || clean === 'HUF') return 'HUF';
    if (clean === 'ZŁ' || clean === 'PLN') return 'PLN';
    if (clean === 'C$' || clean === 'CAD') return 'CAD';
    if (clean === 'A$' || clean === 'AUD') return 'AUD';
    if (clean === '¥' || clean === 'JPY') return 'JPY';
    if (clean === 'R$' || clean === 'BRL') return 'BRL';
    if (clean === 'CHF') return 'CHF';
    if (clean === 'TRY' || clean === 'TL') return 'TRY';
    return clean || 'EUR';
  }

  /**
   * Gets multiplier to convert 1 unit of currency to EUR
   */
  public getRateToEur(currency: string): number {
    const code = this.normalizeCurrencyCode(currency);
    const rate = this.ratesToEur.get(code) ?? FALLBACK_TO_EUR_RATES[code];
    if (rate !== undefined && rate > 0) {
      return rate;
    }
    if (!warnedCurrencies.has(code)) {
      warnedCurrencies.add(code);
      console.warn(`[ExchangeRate] Unknown currency code: "${code}". No conversion rate available (returning 0).`);
    }
    return 0;
  }

  /**
   * Converts an amount in given currency to normalized EUR
   */
  public convertToEur(amount: number, currency: string = 'EUR'): number {
    if (typeof amount !== 'number' || isNaN(amount) || amount <= 0) {
      return 0;
    }
    const code = this.normalizeCurrencyCode(currency);
    if (code === 'EUR') {
      return Math.round(amount * 100) / 100;
    }
    const rate = this.getRateToEur(code);
    if (rate <= 0) {
      return 0;
    }
    return Math.round(amount * rate * 100) / 100;
  }

  /**
   * Optionally updates rates from a public exchange rate endpoint
   */
  public async refreshRates(): Promise<void> {
    if (process.env.NODE_ENV === 'test' && !process.env.TEST_ALLOW_LIVE_FX) {
      return;
    }

    const now = Date.now();
    if (this.lastFetched > 0 && now - this.lastFetched < this.cacheTtlMs) {
      return;
    }

    try {
      const response = await fetch('https://open.er-api.com/v6/latest/EUR', {
        headers: { 'Accept': 'application/json' },
        signal: AbortSignal.timeout(4000)
      });
      if (!response.ok) return;

      const data: any = await response.json();
      if (data?.result === 'success' && data?.rates && typeof data.rates === 'object') {
        // data.rates gives: 1 EUR = X ForeignCurrency -> so 1 ForeignCurrency = 1/X EUR
        for (const [code, rateAgainstEur] of Object.entries(data.rates)) {
          const numRate = Number(rateAgainstEur);
          if (numRate > 0) {
            this.ratesToEur.set(code.toUpperCase(), 1 / numRate);
          }
        }
        this.ratesToEur.set('EUR', 1.0);
        this.lastFetched = now;
      }
    } catch {
      // Graceful fallback to static reliable rates
    }
  }

  /**
   * Resets all rates to default fallback values
   */
  public resetRates(): void {
    this.ratesToEur.clear();
    this.initFallbackRates();
    this.lastFetched = 0;
  }

  /**
   * Manual override for testing or fixed rates
   */
  public setRate(currency: string, multiplierToEur: number): void {
    this.ratesToEur.set(this.normalizeCurrencyCode(currency), multiplierToEur);
  }
}

export const exchangeRateService = new ExchangeRateService();
