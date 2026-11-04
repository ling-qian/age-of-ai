// Camada de rede: WebSocket com reconexão automática (backoff exponencial),
// envio tipado de ClientMessage e despacho de ServerMessage.
// Mensagens desconhecidas ou malformadas são ignoradas silenciosamente.

import type { ClientMessage, ServerMessage } from '@age/shared';
import { GAME_PORT } from '@age/shared';

export type NetStatus = 'connecting' | 'open' | 'closed';

// Escolhe a URL do WebSocket conforme como a página foi servida:
 //  - Vite dev (porta 5199): conecta ao servidor autoritativo na porta GAME_PORT.
 //  - Cliente servido pelo Node (qualquer PORT) ou via HTTPS/Cloudflare:
 //    usa a mesma origem e o caminho /ws. Assim HTTP e HTTPS funcionam sem
 //    fixar a porta 8080 nem expor uma segunda porta.
 function wsUrl(): string {
   if (location.port === '5199') {
     return `ws://${location.hostname}:${GAME_PORT}`;
   }
   const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
   return `${protocol}//${location.host}/ws`;
 }

export class Net {
  onMessage: (msg: ServerMessage) => void = () => {};
  onStatus: (status: NetStatus) => void = () => {};

  private ws: WebSocket | null = null;
  private backoffMs = 500;
  private reconnectTimer: number | null = null;
  private stopped = false; // true após close() proposital (F5/pagehide): não reconecta

  get isOpen(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  connect(): void {
    if (
      this.ws &&
      (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }
    this.emitStatus('connecting');
    let ws: WebSocket;
    try {
      ws = new WebSocket(wsUrl());
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;

    ws.onopen = () => {
      if (this.ws !== ws) return;
      this.backoffMs = 500;
      this.emitStatus('open');
    };

    ws.onmessage = (ev: MessageEvent) => {
      if (this.ws !== ws) return;
      let data: unknown;
      try {
        data = JSON.parse(String(ev.data));
      } catch {
        return; // frame inválido — ignora
      }
      if (!data || typeof data !== 'object') return;
      const type = (data as { type?: unknown }).type;
      if (typeof type !== 'string') return;
      try {
        this.onMessage(data as ServerMessage);
      } catch (err) {
        // Nunca derruba o app por causa de uma mensagem inesperada.
        console.error('Erro ao processar mensagem do servidor:', err);
      }
    };

    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.emitStatus('closed');
      this.scheduleReconnect();
    };

    ws.onerror = () => {
      // onclose é disparado em seguida; nada a fazer aqui.
    };
  }

  send(msg: ClientMessage): boolean {
    if (!this.isOpen || !this.ws) return false;
    try {
      this.ws.send(JSON.stringify(msg));
      return true;
    } catch {
      return false;
    }
  }

  /** Fecha o socket de propósito (F5/pagehide) e para de reconectar — assim o
   *  servidor vê o 'close' na hora e libera o nome. */
  close(): void {
    this.stopped = true;
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    try {
      this.ws?.close();
    } catch {
      // ignora
    }
  }

  private emitStatus(status: NetStatus): void {
    try {
      this.onStatus(status);
    } catch (err) {
      console.error('Erro no handler de status de rede:', err);
    }
  }

  private scheduleReconnect(): void {
    if (this.stopped) return;
    if (this.reconnectTimer !== null) return;
    const delay = this.backoffMs;
    this.backoffMs = Math.min(this.backoffMs * 2, 8000);
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }
}
