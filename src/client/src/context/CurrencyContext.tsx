import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import { api } from '../api.js';

export type SupportedCurrency = 'EUR' | 'USD' | 'GBP' | 'CAD' | 'AUD' | 'HUF';

export interface CurrencyInfo {
  code: SupportedCurrency;
  symbol: string;
  label: string;
  isPrefix: boolean;
  decimalPlaces: number;
}

export const CURRENCY_MAP: Record<SupportedCurrency, CurrencyInfo> = {
  EUR: { code: 'EUR', symbol: '€', label: 'EUR (€)', isPrefix: true, decimalPlaces: 2 },
  USD: { code: 'USD', symbol: '$', label: 'USD ($)', isPrefix: true, decimalPlaces: 2 },
  GBP: { code: 'GBP', symbol: '£', label: 'GBP (£)', isPrefix: true, decimalPlaces: 2 },
  CAD: { code: 'CAD', symbol: 'C$', label: 'CAD (C$)', isPrefix: true, decimalPlaces: 2 },
  AUD: { code: 'AUD', symbol: 'A$', label: 'AUD (A$)', isPrefix: true, decimalPlaces: 2 },
  HUF: { code: 'HUF', symbol: 'Ft', label: 'HUF (Ft)', isPrefix: false, decimalPlaces: 0 },
};

// Fallback rates if offline: 1 EUR = X Foreign Currency
const DEFAULT_RATES_FROM_EUR: Record<SupportedCurrency, number> = {
  EUR: 1.0,
  USD: 1.087,
  GBP: 0.855,
  CAD: 1.47,
  AUD: 1.667,
  HUF: 395.0,
};

interface CurrencyContextType {
  currency: SupportedCurrency;
  setCurrency: (c: SupportedCurrency) => void;
  currencyInfo: CurrencyInfo;
  rates: Record<string, number>;
  formatPrice: (eurVal: number | null | undefined) => string;
  convertEurToLocal: (eurVal: number | null | undefined) => number | null;
  convertLocalToEur: (localVal: number | null | undefined) => number | null;
}

const CurrencyContext = createContext<CurrencyContextType>({
  currency: 'EUR',
  setCurrency: () => {},
  currencyInfo: CURRENCY_MAP.EUR,
  rates: DEFAULT_RATES_FROM_EUR,
  formatPrice: (eurVal) => eurVal != null ? `€${eurVal.toFixed(2)}` : '—',
  convertEurToLocal: (eurVal) => eurVal ?? null,
  convertLocalToEur: (localVal) => localVal ?? null,
});

const LOCAL_STORAGE_KEY = 'pricesteamtool_preferred_currency';

export const CurrencyProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currency, setCurrencyState] = useState<SupportedCurrency>(() => {
    try {
      const saved = localStorage.getItem(LOCAL_STORAGE_KEY);
      if (saved && saved in CURRENCY_MAP) {
        return saved as SupportedCurrency;
      }
    } catch {}
    return 'EUR';
  });

  const [rates, setRates] = useState<Record<string, number>>(DEFAULT_RATES_FROM_EUR);

  useEffect(() => {
    api.getExchangeRates()
      .then((res: { base: string; rates: Record<string, number> }) => {
        if (res?.rates) {
          setRates(prev => ({
            ...prev,
            ...res.rates
          }));
        }
      })
      .catch(() => {
        // Fallback rates already loaded
      });
  }, []);

  const setCurrency = useCallback((c: SupportedCurrency) => {
    setCurrencyState(c);
    try {
      localStorage.setItem(LOCAL_STORAGE_KEY, c);
    } catch {}
  }, []);

  const convertEurToLocal = useCallback((eurVal: number | null | undefined): number | null => {
    if (eurVal === null || eurVal === undefined || isNaN(eurVal)) return null;
    if (currency === 'EUR') return eurVal;
    const rate = rates[currency] ?? DEFAULT_RATES_FROM_EUR[currency] ?? 1.0;
    return eurVal * rate;
  }, [currency, rates]);

  const convertLocalToEur = useCallback((localVal: number | null | undefined): number | null => {
    if (localVal === null || localVal === undefined || isNaN(localVal)) return null;
    if (currency === 'EUR') return localVal;
    const rate = rates[currency] ?? DEFAULT_RATES_FROM_EUR[currency] ?? 1.0;
    if (rate <= 0) return localVal;
    return localVal / rate;
  }, [currency, rates]);

  const currencyInfo = useMemo(() => CURRENCY_MAP[currency] || CURRENCY_MAP.EUR, [currency]);

  const formatPrice = useCallback((eurVal: number | null | undefined): string => {
    if (eurVal === null || eurVal === undefined || isNaN(eurVal)) return '—';
    const localVal = convertEurToLocal(eurVal);
    if (localVal === null) return '—';

    if (currency === 'HUF') {
      // HUF is integer with space separator, e.g. "3 990 Ft"
      const rounded = Math.round(localVal);
      return `${rounded.toLocaleString('hu-HU')} ${currencyInfo.symbol}`;
    }

    const formattedNum = localVal.toFixed(currencyInfo.decimalPlaces);
    if (currencyInfo.isPrefix) {
      return `${currencyInfo.symbol}${formattedNum}`;
    }
    return `${formattedNum} ${currencyInfo.symbol}`;
  }, [convertEurToLocal, currency, currencyInfo]);

  const contextValue = useMemo(() => ({
    currency,
    setCurrency,
    currencyInfo,
    rates,
    formatPrice,
    convertEurToLocal,
    convertLocalToEur,
  }), [currency, setCurrency, currencyInfo, rates, formatPrice, convertEurToLocal, convertLocalToEur]);

  return (
    <CurrencyContext.Provider value={contextValue}>
      {children}
    </CurrencyContext.Provider>
  );
};

export const useCurrency = () => useContext(CurrencyContext);
