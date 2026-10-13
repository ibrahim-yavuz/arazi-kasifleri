import type { ClientMessage, ServerMessage } from './protocol';

/** WebSocket URL of the room server: same host as the page (Vite proxies /ws in dev). */
export function defaultServerUrl(): string {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}/ws`;
}

/** Thin JSON-over-WebSocket client for the room server. */
export class NetClient {
  private ws: WebSocket | null = null;
  id: string | null = null;
  private readonly listeners = new Set<(m: ServerMessage) => void>();
  private closeListeners = new Set<(reason: string) => void>();

  constructor(private readonly url = defaultServerUrl()) {}

  get connected(): boolean {
    return !!this.ws && this.ws.readyState === WebSocket.OPEN && this.id !== null;
  }

  /** Connects (if needed) and resolves once the server sent its welcome. */
  connect(timeoutMs = 6000): Promise<void> {
    if (this.connected) return Promise.resolve();
    this.close();
    return new Promise((resolve, reject) => {
      let settled = false;
      const ws = new WebSocket(this.url);
      this.ws = ws;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        ws.close();
        reject(new Error('Sunucuya bağlanılamadı (zaman aşımı).'));
      }, timeoutMs);
      ws.onmessage = (ev) => {
        let msg: ServerMessage;
        try {
          msg = JSON.parse(String(ev.data)) as ServerMessage;
        } catch {
          return;
        }
        if (msg.type === 'welcome') {
          this.id = msg.id;
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            resolve();
          }
        }
        for (const l of this.listeners) l(msg);
      };
      ws.onerror = () => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(new Error('Sunucuya bağlanılamadı.'));
        }
      };
      ws.onclose = () => {
        const was = this.id !== null;
        this.id = null;
        if (this.ws === ws) this.ws = null;
        if (was) for (const l of this.closeListeners) l('Sunucu bağlantısı koptu.');
      };
    });
  }

  send(msg: ClientMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  onMessage(cb: (m: ServerMessage) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  onClose(cb: (reason: string) => void): () => void {
    this.closeListeners.add(cb);
    return () => this.closeListeners.delete(cb);
  }

  close(): void {
    const ws = this.ws;
    this.ws = null;
    this.id = null;
    if (ws) {
      ws.onclose = null;
      ws.close();
    }
  }
}
