import type { PriceEventType } from '../types.js';

const RECORD_DROP_EVENTS: PriceEventType[] = [
  'RECORD_DROP',
  'UNCONFIRMED_RECORD_DROP',
  'NEW_HISTORICAL_LOW',
  'AT_HISTORICAL_LOW'
];

export function isRecordDropEvent(e?: PriceEventType | null): boolean {
  return Boolean(e && RECORD_DROP_EVENTS.includes(e));
}
