// ============================================================
//  Tiny PeerJS wrapper: host = authoritative peer, guests = clients
//  Free public signaling server, direct WebRTC afterwards.
// ============================================================

const PREFIX = 'cnm-masry-v1-';
const OPEN_TIMEOUT = 22000;

function waitOpen(peer) {
  return new Promise((resolve, reject) => {
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      reject(Object.assign(new Error('timeout'), { type: 'timeout' }));
    }, OPEN_TIMEOUT);

    peer.on('open', () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve();
    });

    peer.on('error', (err) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      reject(err);
    });
  });
}

export class Net {
  constructor(handlers = {}) {
    this.h = handlers;
    this.peer = null;
    this.conns = new Map();
    this.guestConn = null;
    this.isHost = false;
    this.room = null;
    this.closed = false;
  }

  async host(room) {
    this.isHost = true;
    this.room = room;
    const peer = new Peer(PREFIX + room, { debug: 0 });
    await waitOpen(peer);
    this.peer = peer;

    peer.on('connection', (conn) => this._accept(conn));
    peer.on('error', (err) => this.h.onError?.(err));
    peer.on('disconnected', () => {
      if (!this.closed) {
        try { peer.reconnect(); } catch { /* ignore */ }
      }
    });
    return peer.id;
  }

  _accept(conn) {
    this.conns.set(conn.peer, conn);
    conn.on('data', (data) => this.h.onData?.(data, conn.peer));
    conn.on('close', () => {
      this.conns.delete(conn.peer);
      this.h.onPeerClose?.(conn.peer);
    });
    conn.on('error', () => {});
  }

  async join(room) {
    this.isHost = false;
    this.room = room;
    const peer = new Peer({ debug: 0 });
    await waitOpen(peer);
    this.peer = peer;

    peer.on('error', (err) => {
      if (err?.type === 'peer-unavailable') return; // already reported by conn error
      this.h.onError?.(err);
    });

    const conn = peer.connect(PREFIX + room, { reliable: true });
    this.guestConn = conn;

    await new Promise((resolve, reject) => {
      let done = false;
      const timer = setTimeout(() => {
        if (done) return;
        done = true;
        reject(Object.assign(new Error('timeout'), { type: 'timeout' }));
      }, OPEN_TIMEOUT);

      const ok = () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve();
      };
      const fail = (err) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        reject(err);
      };

      conn.on('open', ok);
      conn.on('error', fail);
      peer.on('error', fail);
    });

    conn.on('data', (data) => this.h.onData?.(data, 'host'));
    conn.on('close', () => this.h.onGuestClose?.());
    conn.on('error', () => {});
    this.h.onOpen?.();
  }

  send(peerId, msg) {
    const c = this.conns.get(peerId);
    if (c && c.open) {
      try { c.send(msg); } catch { /* ignore */ }
    }
  }

  sendHost(msg) {
    if (this.guestConn && this.guestConn.open) {
      try { this.guestConn.send(msg); } catch { /* ignore */ }
    }
  }

  broadcast(msg) {
    for (const c of this.conns.values()) {
      if (c.open) {
        try { c.send(msg); } catch { /* ignore */ }
      }
    }
  }

  close() {
    this.closed = true;
    try { this.peer?.destroy(); } catch { /* ignore */ }
    this.conns.clear();
    this.peer = null;
    this.guestConn = null;
  }
}
