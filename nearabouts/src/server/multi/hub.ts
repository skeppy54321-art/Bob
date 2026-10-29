/** Socket.IO wiring: authenticates sockets from the session cookie and routes intents to rooms. */
import type { Server as HttpServer } from 'node:http';
import { Server, type Socket } from 'socket.io';
import { parse as parseCookie } from './cookie.ts';
import { userFromToken, SESSION_COOKIE, getUserByName, type UserRow } from '../auth.ts';
import { db, shortCode, json } from '../db.ts';
import { Room, RoomError, realClock, type Clock, type Transport } from './room.ts';
import { isBlocked, friendIds } from '../social.ts';
import { markOnline, markOffline, isOnline } from '../presence.ts';

export class Hub {
  rooms = new Map<string, Room>();
  userRoom = new Map<string, string>();
  invites = new Map<string, { code: string; from: string; format: string; at: number }[]>();
  io: Server | null = null;
  transport: Transport;

  constructor(private clock: Clock = realClock) {
    this.transport = {
      send: (userId, event, data) => this.io?.to(`u:${userId}`).emit(event, data),
      blockedPairs: (a, b) => isBlocked(a, b),
    };
  }

  attach(server: HttpServer) {
    this.io = new Server(server, { path: '/socket.io', serveClient: false, cors: { origin: false }, pingInterval: 10_000, pingTimeout: 8_000 });
    this.io.use((socket, next) => {
      const cookies = parseCookie(socket.handshake.headers.cookie ?? '');
      const user = userFromToken(cookies[SESSION_COOKIE]);
      if (!user) return next(new Error('not_authenticated'));
      (socket.data as any).userId = user.id;
      next();
    });
    this.io.on('connection', (s) => this.onConnection(s));
  }

  private user(socket: Socket): UserRow {
    const id = (socket.data as any).userId as string;
    const u = db.prepare('SELECT * FROM users WHERE id=?').get(id) as UserRow | undefined;
    if (!u) throw new RoomError('Account not found.');
    return u;
  }

  private onConnection(socket: Socket) {
    const userId = (socket.data as any).userId as string;
    socket.join(`u:${userId}`);
    markOnline(userId);
    // Re-attach to the room the user was in (reconnect after refresh / network drop).
    const code = this.userRoom.get(userId);
    const room = code ? this.rooms.get(code) : undefined;
    if (room?.members.has(userId)) room.reconnect(userId);
    socket.emit('hello', { userId, roomCode: room ? room.code : null, invites: this.invites.get(userId) ?? [] });

    // Every handler: run, ack {ok} or {error}. Errors never crash the socket.
    const on = (event: string, fn: (data: any) => unknown | Promise<unknown>) => {
      socket.on(event, async (data: any, ack?: (r: unknown) => void) => {
        try {
          const r = await fn(data ?? {});
          ack?.({ ok: true, ...(r && typeof r === 'object' ? r : {}) });
        } catch (err) {
          const msg = err instanceof RoomError ? err.message : 'Something went wrong.';
          if (!(err instanceof RoomError)) console.error(`[socket] ${event}`, err);
          ack?.({ ok: false, error: msg, code: (err as RoomError).code ?? 'error' });
        }
      });
    };
    const roomOf = () => {
      const c = this.userRoom.get(userId);
      const r = c ? this.rooms.get(c) : undefined;
      if (!r) throw new RoomError('You are not in a room.', 'no_room');
      return r;
    };

    on('room:create', () => {
      const u = this.user(socket);
      this.leaveCurrent(userId);
      let c = shortCode(5);
      while (this.rooms.has(c)) c = shortCode(5);
      const r = new Room(c, { id: u.id, username: u.username, avatar: json(u.avatar, {}) }, this.transport, this.clock, (room) => this.dropRoom(room));
      this.rooms.set(c, r);
      this.userRoom.set(userId, c);
      return { code: c };
    });
    on('room:join', ({ code }) => {
      const c = String(code ?? '').toUpperCase().trim();
      const r = this.rooms.get(c);
      if (!r) throw new RoomError('Room not found. Check the code — rooms close when everyone leaves.', 'room_not_found');
      if (this.userRoom.get(userId) !== c) this.leaveCurrent(userId);
      const u = this.user(socket);
      r.addMember({ id: u.id, username: u.username, avatar: json(u.avatar, {}) });
      this.userRoom.set(userId, c);
      this.invites.set(userId, (this.invites.get(userId) ?? []).filter((i) => i.code !== c));
      return { code: c };
    });
    on('room:leave', () => { this.leaveCurrent(userId); });
    on('room:settings', (patch) => roomOf().updateSettings(userId, patch));
    on('room:ready', ({ ready }) => roomOf().setReady(userId, !!ready));
    on('room:team', ({ userId: target, team }) => roomOf().setTeam(userId, target ?? userId, Number(team)));
    on('room:spectate', ({ userId: target, spectator }) => roomOf().setSpectator(userId, target ?? userId, !!spectator));
    on('room:kick', ({ userId: target }) => roomOf().kick(userId, String(target)));
    on('room:host', ({ userId: target }) => roomOf().makeHost(userId, String(target)));
    on('room:start', () => roomOf().start(userId));
    on('room:guess', (g) => roomOf().guess(userId, { lat: Number(g.lat), lng: Number(g.lng), round: Number(g.round) }));
    on('room:continue', () => roomOf().continueReady(userId));
    on('room:rematch', () => roomOf().rematch(userId));
    on('room:unavailable', ({ round }) => roomOf().reportUnavailable(userId, Number(round)));
    on('room:chat', (m) => roomOf().sendChat(userId, m));
    on('room:sync', () => { const r = roomOf(); socket.emit('room:state', r.snapshot(userId)); });
    on('room:invite', ({ username }) => {
      const r = roomOf();
      const u = this.user(socket);
      const t = getUserByName(String(username ?? ''));
      if (!t) throw new RoomError('Player not found.');
      if (isBlocked(u.id, t.id)) throw new RoomError('You cannot invite this player.');
      if (!friendIds(u.id).includes(t.id)) throw new RoomError('You can only invite friends. Share the room link instead.');
      const inv = { code: r.code, from: u.username, format: r.settings.format, at: Date.now() };
      this.invites.set(t.id, [...(this.invites.get(t.id) ?? []).filter((i) => i.code !== r.code), inv].slice(-10));
      this.transport.send(t.id, 'invite', inv);
      return { online: isOnline(t.id) };
    });
    on('invite:dismiss', ({ code }) => { this.invites.set(userId, (this.invites.get(userId) ?? []).filter((i) => i.code !== code)); });

    socket.on('disconnect', () => {
      markOffline(userId);
      if (isOnline(userId)) return; // another tab is still connected
      const c = this.userRoom.get(userId);
      this.rooms.get(c ?? '')?.disconnect(userId);
    });
  }

  leaveCurrent(userId: string) {
    const c = this.userRoom.get(userId);
    if (!c) return;
    this.userRoom.delete(userId);
    this.rooms.get(c)?.leave(userId, 'leave');
  }

  private dropRoom(room: Room) {
    this.rooms.delete(room.code);
    for (const [u, c] of this.userRoom) if (c === room.code) this.userRoom.delete(u);
  }
}
