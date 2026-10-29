/** Friends and blocks. */
import { db, now, json } from './db.ts';
import { HttpError, getUserByName, publicUser, type UserRow } from './auth.ts';
import { isOnline } from './presence.ts';
import { checkAchievements } from './progression.ts';

export function isBlocked(a: string, b: string): boolean {
  return !!db.prepare('SELECT 1 FROM blocks WHERE (blocker_id=? AND blocked_id=?) OR (blocker_id=? AND blocked_id=?)').get(a, b, b, a);
}
export const blockedBy = (userId: string): Set<string> => new Set((db.prepare('SELECT blocker_id b FROM blocks WHERE blocked_id=?').all(userId) as any[]).map((r) => r.b));
export const blocking = (userId: string): Set<string> => new Set((db.prepare('SELECT blocked_id b FROM blocks WHERE blocker_id=?').all(userId) as any[]).map((r) => r.b));

export function friendIds(userId: string): string[] {
  return (db.prepare(`SELECT CASE WHEN requester_id=? THEN addressee_id ELSE requester_id END id FROM friendships
    WHERE (requester_id=? OR addressee_id=?) AND status='accepted'`).all(userId, userId, userId) as any[]).map((r) => r.id);
}
export function friendStatus(a: string, b: string): 'none' | 'friends' | 'outgoing' | 'incoming' {
  const r = db.prepare('SELECT * FROM friendships WHERE (requester_id=? AND addressee_id=?) OR (requester_id=? AND addressee_id=?)').get(a, b, b, a) as any;
  if (!r) return 'none';
  if (r.status === 'accepted') return 'friends';
  return r.requester_id === a ? 'outgoing' : 'incoming';
}

function target(username: string, me: UserRow): UserRow {
  const t = getUserByName(String(username ?? ''));
  if (!t || t.is_guest) throw new HttpError(404, 'No player with that username.');
  if (t.id === me.id) throw new HttpError(400, "That's you!");
  return t;
}

export function listFriends(me: UserRow) {
  const rows = db.prepare(`SELECT f.*, u.id uid, u.username, u.avatar, u.is_guest, u.xp, u.last_seen_at FROM friendships f
    JOIN users u ON u.id = CASE WHEN f.requester_id=? THEN f.addressee_id ELSE f.requester_id END
    WHERE f.requester_id=? OR f.addressee_id=?`).all(me.id, me.id, me.id) as any[];
  const shape = (r: any) => ({ ...publicUser({ id: r.uid, username: r.username, avatar: r.avatar, is_guest: r.is_guest, xp: r.xp }), online: isOnline(r.uid), lastSeenAt: r.last_seen_at, since: r.created_at });
  return {
    friends: rows.filter((r) => r.status === 'accepted').map(shape).sort((a, b) => Number(b.online) - Number(a.online) || a.username.localeCompare(b.username)),
    incoming: rows.filter((r) => r.status === 'pending' && r.addressee_id === me.id).map(shape),
    outgoing: rows.filter((r) => r.status === 'pending' && r.requester_id === me.id).map(shape),
  };
}

export function requestFriend(me: UserRow, username: string) {
  const t = target(username, me);
  if (isBlocked(me.id, t.id)) throw new HttpError(403, 'You cannot add this player.');
  const st = friendStatus(me.id, t.id);
  if (st === 'friends') return 'friends';
  if (st === 'incoming') { acceptFriend(me, username, true); return 'friends'; }
  if (st === 'none') db.prepare("INSERT INTO friendships(requester_id, addressee_id, status, created_at) VALUES (?,?,'pending',?)").run(me.id, t.id, now());
  return 'outgoing';
}
export function acceptFriend(me: UserRow, username: string, accept: boolean) {
  const t = target(username, me);
  if (accept) {
    const r = db.prepare("UPDATE friendships SET status='accepted', created_at=? WHERE requester_id=? AND addressee_id=? AND status='pending'").run(now(), t.id, me.id);
    if (!r.changes) throw new HttpError(404, 'No pending request from that player.');
    checkAchievements(me.id); checkAchievements(t.id);
  } else {
    db.prepare("DELETE FROM friendships WHERE requester_id=? AND addressee_id=? AND status='pending'").run(t.id, me.id);
  }
}
export function removeFriend(me: UserRow, username: string) {
  const t = target(username, me);
  db.prepare('DELETE FROM friendships WHERE (requester_id=? AND addressee_id=?) OR (requester_id=? AND addressee_id=?)').run(me.id, t.id, t.id, me.id);
}
export function block(me: UserRow, username: string) {
  const t = target(username, me);
  db.prepare('INSERT OR IGNORE INTO blocks(blocker_id, blocked_id, created_at) VALUES (?,?,?)').run(me.id, t.id, now());
  db.prepare('DELETE FROM friendships WHERE (requester_id=? AND addressee_id=?) OR (requester_id=? AND addressee_id=?)').run(me.id, t.id, t.id, me.id);
}
export function unblock(me: UserRow, username: string) {
  const t = getUserByName(username);
  if (t) db.prepare('DELETE FROM blocks WHERE blocker_id=? AND blocked_id=?').run(me.id, t.id);
}
export function listBlocks(me: UserRow) {
  return (db.prepare('SELECT u.id, u.username, u.avatar, u.is_guest, u.xp FROM blocks b JOIN users u ON u.id=b.blocked_id WHERE b.blocker_id=?').all(me.id) as any[])
    .map((u) => publicUser(u));
}
export const avatarOf = (s: string) => json(s, {});
