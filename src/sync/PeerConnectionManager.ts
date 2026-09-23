import Peer, { type DataConnection } from 'peerjs';
import type { PeerMessage } from './protocol.ts';
import type { PeerLink } from './PeerLink.ts';

export type ConnectionStatus = 'idle' | 'connecting' | 'connected' | 'disconnected' | 'error';
export interface PeerDisconnectedEvent {
  peerId: string;
  allDisconnected: boolean;
}

const ROOM_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const ROOM_CODE_PATTERN = new RegExp(`^[${ROOM_CODE_CHARS}]{6}$`);

function generateRoomCode(length = 6): string {
  let code = '';
  const random = new Uint32Array(length);
  crypto.getRandomValues(random);
  for (const value of random) code += ROOM_CODE_CHARS[value % ROOM_CODE_CHARS.length];
  return code;
}

function normalizeRoomCode(roomCode: string): string {
  const normalized = roomCode.trim().toUpperCase();
  if (!ROOM_CODE_PATTERN.test(normalized)) {
    throw new Error('Room codes must use six unambiguous letters or numbers.');
  }
  return normalized;
}

export class PeerConnectionManager implements PeerLink {
  readonly localId: string;
  private peer: Peer;
  private connections = new Map<string, DataConnection>();
  private messageListeners: Array<(message: PeerMessage) => void> = [];
  private statusListeners: Array<(status: ConnectionStatus) => void> = [];
  private peerDisconnectedListeners: Array<(event: PeerDisconnectedEvent) => void> = [];

  constructor(roomCode?: string) {
    this.localId = roomCode ? normalizeRoomCode(roomCode) : generateRoomCode();
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
      if (!this.connections.delete(conn.peer)) return;
      const allDisconnected = this.connections.size === 0;
      this.emitStatus(allDisconnected ? 'idle' : 'connected');
      for (const listener of this.peerDisconnectedListeners) listener({ peerId: conn.peer, allDisconnected });
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

  onPeerDisconnected(cb: (event: PeerDisconnectedEvent) => void): void {
    this.peerDisconnectedListeners.push(cb);
  }

  private emitStatus(status: ConnectionStatus): void {
    for (const listener of this.statusListeners) listener(status);
  }
}
