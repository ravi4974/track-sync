import Peer, { type DataConnection } from 'peerjs';
import type { PeerMessage } from './protocol.ts';
import type { PeerLink } from './PeerLink.ts';

export type ConnectionStatus = 'idle' | 'connecting' | 'connected' | 'disconnected' | 'error';

const ROOM_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function generateRoomCode(length = 6): string {
  let code = '';
  const random = new Uint32Array(length);
  crypto.getRandomValues(random);
  for (const value of random) code += ROOM_CODE_CHARS[value % ROOM_CODE_CHARS.length];
  return code;
}

export class PeerConnectionManager implements PeerLink {
  readonly localId: string;
  private peer: Peer;
  private connections = new Map<string, DataConnection>();
  private messageListeners: Array<(message: PeerMessage) => void> = [];
  private statusListeners: Array<(status: ConnectionStatus) => void> = [];

  constructor() {
    this.localId = generateRoomCode();
    this.peer = new Peer(this.localId);
    this.peer.on('connection', (conn) => this.attachConnection(conn));
    this.peer.on('error', () => this.emitStatus('error'));
    this.peer.on('disconnected', () => this.emitStatus('disconnected'));
  }

  connectTo(remoteId: string): void {
    this.emitStatus('connecting');
    const conn = this.peer.connect(remoteId.trim().toUpperCase());
    this.attachConnection(conn);
  }

  private attachConnection(conn: DataConnection): void {
    conn.on('open', () => {
      this.connections.set(conn.peer, conn);
      this.emitStatus('connected');
    });
    conn.on('data', (data) => {
      for (const listener of this.messageListeners) listener(data as PeerMessage);
    });
    conn.on('close', () => {
      this.connections.delete(conn.peer);
      this.emitStatus('disconnected');
    });
    conn.on('error', () => this.emitStatus('error'));
  }

  broadcast(message: PeerMessage): void {
    for (const conn of this.connections.values()) conn.send(message);
  }

  onMessage(cb: (message: PeerMessage) => void): void {
    this.messageListeners.push(cb);
  }

  onStatusChange(cb: (status: ConnectionStatus) => void): void {
    this.statusListeners.push(cb);
  }

  private emitStatus(status: ConnectionStatus): void {
    for (const listener of this.statusListeners) listener(status);
  }
}
