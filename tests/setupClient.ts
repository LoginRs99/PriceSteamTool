import '@testing-library/jest-dom/vitest';

export class MockEventSource {
  static instances: MockEventSource[] = [];
  url: string;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  listeners: Record<string, Function[]> = {};

  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: Function) {
    if (!this.listeners[type]) this.listeners[type] = [];
    this.listeners[type].push(listener);
  }

  removeEventListener(type: string, listener: Function) {
    if (!this.listeners[type]) return;
    this.listeners[type] = this.listeners[type].filter(l => l !== listener);
  }

  close() {
    MockEventSource.instances = MockEventSource.instances.filter(i => i !== this);
  }

  emitMessage(data: any) {
    const event = { data: typeof data === 'string' ? data : JSON.stringify(data) } as MessageEvent;
    if (this.onmessage) {
      this.onmessage(event);
    }
    if (this.listeners['message']) {
      this.listeners['message'].forEach(l => l(event));
    }
  }
}

(globalThis as any).EventSource = MockEventSource;

// Provide resilient localStorage mock for jsdom / Node 26 environment
const store = new Map<string, string>();
const mockLocalStorage: Storage = {
  getItem: (key: string) => store.get(String(key)) ?? null,
  setItem: (key: string, value: string) => { store.set(String(key), String(value)); },
  removeItem: (key: string) => { store.delete(String(key)); },
  clear: () => { store.clear(); },
  get length() { return store.size; },
  key: (index: number) => Array.from(store.keys())[index] ?? null,
};

Object.defineProperty(globalThis, 'localStorage', {
  value: mockLocalStorage,
  writable: true,
  configurable: true,
});

if (typeof window !== 'undefined') {
  Object.defineProperty(window, 'localStorage', {
    value: mockLocalStorage,
    writable: true,
    configurable: true,
  });
}
