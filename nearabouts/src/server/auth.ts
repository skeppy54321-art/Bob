/**
 * Players and cookie sessions. There are no passwords or sign-ups: the first visit creates a
 * player tied to a long-lived, HttpOnly session cookie (stored hashed), and the player picks a
 * name. `is_guest = 1` means "has not picked a name yet".
 */
import { randomBytes, createHash } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { db, now, uid } from './db.ts';
import { config } from './config.ts';

export const SESSION_COOKIE = 'na_session';
const SESSION_TTL = 400 * 24 * 3600 * 1000; // browsers cap cookies at ~400 days

export interface UserRow {
  id: string; username: string; is_guest: number; is_admin: number;
  avatar: string; bio: string; xp: number; settings: string; created_at: number; last_seen_at: number;
}

const sha = (t: string) => createHash('sha256').update(t).digest('hex');

export const USERNAME_RE = /^[A-Za-z0-9_-]{3,20}$/;
export function validateUsername(u: unknown): string | null {
  if (typeof u !== 'string' || !USERNAME_RE.test(u)) return 'Usernames are 3–20 letters, numbers, _ or -.';
  if (/^guest/i.test(u)) return 'Pick something other than "Guest…".';
  return null;
}

export function randomAvatar() {
  const r = (n: number) => Math.floor(Math.random() * n);
  return { shape: r(6), hue: r(360), accent: r(360), face: r(6), pattern: r(5) };
}

export function createUser(opts: { username: string; guest?: boolean }): UserRow {
  const id = uid();
  db.prepare(`INSERT INTO users(id, username, is_guest, is_admin, avatar, created_at, last_seen_at)
    VALUES (?,?,?,0,?,?,?)`).run(id, opts.username, opts.guest ? 1 : 0, JSON.stringify(randomAvatar()), now(), now());
  return getUserById(id)!;
}
export function createGuest(): UserRow {
  for (let i = 0; i < 20; i++) {
    const name = `Guest-${Math.floor(1000 + Math.random() * 90000)}`;
    if (!db.prepare('SELECT 1 FROM users WHERE username=?').get(name)) return createUser({ username: name, guest: true });
  }
  return createUser({ username: `Guest-${uid().slice(0, 8)}`, guest: true });
}

export const getUserById = (id: string) => db.prepare('SELECT * FROM users WHERE id=?').get(id) as UserRow | undefined;
export const getUserByName = (name: string) => db.prepare('SELECT * FROM users WHERE username=?').get(name) as UserRow | undefined;

export function createSession(userId: string): string {
  const token = randomBytes(32).toString('base64url');
  db.prepare('INSERT INTO sessions(token_hash, user_id, created_at, expires_at) VALUES (?,?,?,?)').run(sha(token), userId, now(), now() + SESSION_TTL);
  return token;
}
export function userFromToken(token: string | undefined): UserRow | null {
  if (!token) return null;
  const row = db.prepare('SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?').get(sha(token), now()) as UserRow | undefined;
  return row ?? null;
}
export function destroySession(token: string | undefined) {
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash=?').run(sha(token));
}

export function setSessionCookie(reply: FastifyReply, token: string) {
  reply.setCookie(SESSION_COOKIE, token, { path: '/', httpOnly: true, sameSite: 'lax', secure: config.cookieSecure, maxAge: SESSION_TTL / 1000 });
}

declare module 'fastify' { interface FastifyRequest { user: UserRow | null } }

/** Current user or null (no guest is created). */
export function currentUser(req: FastifyRequest): UserRow | null {
  if (req.user === undefined || req.user === null) {
    req.user = userFromToken(req.cookies[SESSION_COOKIE]);
    if (req.user && now() - req.user.last_seen_at > 60_000) db.prepare('UPDATE users SET last_seen_at=? WHERE id=?').run(now(), req.user.id);
  }
  return req.user;
}
/** Current user, creating a guest account + session on first visit. */
export function ensureUser(req: FastifyRequest, reply: FastifyReply): UserRow {
  const u = currentUser(req);
  if (u) return u;
  const g = createGuest();
  setSessionCookie(reply, createSession(g.id));
  req.user = g;
  return g;
}

export class HttpError extends Error {
  constructor(public status: number, message: string, public code = 'error') { super(message); }
}
export function requireAccount(req: FastifyRequest): UserRow {
  const u = currentUser(req);
  if (!u) throw new HttpError(401, 'Please reload the page.', 'no_session');
  if (u.is_guest) throw new HttpError(403, 'Pick a player name first.', 'name_required');
  return u;
}

export function publicUser(u: Pick<UserRow, 'id' | 'username' | 'avatar' | 'is_guest' | 'xp'>) {
  return { id: u.id, username: u.username, avatar: JSON.parse(u.avatar || '{}'), guest: !!u.is_guest, xp: u.xp };
}
