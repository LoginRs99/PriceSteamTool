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
