export interface AllKeyShopMetrics {
  currentDelayMs: number;
  consecutiveFailures: number;
  cooldownUntil: string | null;
  queueLength: number;
  activeRequest: string | null;
  lastSuccessTime: string | null;
  lastFailureTime: string | null;
  lastCatalogRefresh: string | null;
}

export interface AllKeyShopQueueTask<T> {
  key: string;
  fn: () => Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: any) => void;
  enqueuedAt: number;
  gameTitle?: string;
}
