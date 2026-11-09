// How the page talks to a room: over a WebSocket, or to a room running right here for solo races.

import { DT } from '../sim/race';
import { PROTOCOL_VERSION, type ClientMsg, type ServerMsg } from './protocol';
import { Room } from './room';

export interface Link {
  readonly local: boolean;
  send(m: ClientMsg): void;
  onMessage: (m: ServerMsg) => void;
  onClose: (reason: string) => void;
  close(): void;
  /** Local rooms are ticked by the page's own loop. */
  update(dt: number): void;
}

export class LocalLink implements Link {
  readonly local = true;
  onMessage: (m: ServerMsg) => void = () => {};
  onClose: (reason: string) => void = () => {};
  readonly room = new Room('SOLO');
  private queue: ServerMsg[] = [];
  private acc = 0;

  constructor(name: string, char: string) {
    this.room.add({ id: 'me', send: (m) => this.queue.push(m) }, name, char);
  }

  send(m: ClientMsg): void {
    if (m.t === 'create' || m.t === 'join' || m.t === 'leave') return;
    this.room.handle('me', m);
  }

  update(dt: number): void {
    this.acc = Math.min(this.acc + dt, 0.25);
    while (this.acc >= DT) {
      this.room.tick(DT);
      this.acc -= DT;
    }
    this.flush();
  }

  flush(): void {
    const q = this.queue;
    this.queue = [];
    for (const m of q) this.onMessage(m);
  }

  close(): void {}
}

export class WsLink implements Link {
  readonly local = false;
  onMessage: (m: ServerMsg) => void = () => {};
  onClose: (reason: string) => void = () => {};
  private ws: WebSocket;
  private pending: ClientMsg[] = [];
  private closed = false;

  constructor(first: ClientMsg) {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    this.ws = new WebSocket(`${proto}//${location.host}/ws`);
    this.pending.push(first);
    this.ws.onopen = () => {
      for (const m of this.pending) this.ws.send(JSON.stringify(m));
      this.pending = [];
    };
    this.ws.onmessage = (e) => {
      try {
        this.onMessage(JSON.parse(String(e.data)));
      } catch (err) {
        console.error(err);
      }
    };
    this.ws.onclose = () => {
      if (!this.closed) this.onClose('Lost connection to the server.');
      this.closed = true;
    };
  }

  send(m: ClientMsg): void {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
    else if (this.ws.readyState === WebSocket.CONNECTING) this.pending.push(m);
  }

  update(): void {}

  close(): void {
    this.closed = true;
    try {
      this.ws.send(JSON.stringify({ t: 'leave' }));
    } catch {
      /* already gone */
    }
    this.ws.close();
  }
}

export const hello = (name: string, char: string, code?: string): ClientMsg =>
  code ? { t: 'join', v: PROTOCOL_VERSION, code, name, char } : { t: 'create', v: PROTOCOL_VERSION, name, char };
