import Database from 'better-sqlite3';
import { readdirSync, readFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, randomUUID } from 'node:crypto';
import { config } from './config.ts';

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), 'migrations');

export type DB = Database.Database;

export function openDb(path: string): DB {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  migrate(db);
  return db;
}

/** Applies every migrations/NNN_*.sql file not yet recorded in schema_migrations, in order. */
export function migrate(db: DB): string[] {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)');
  const done = new Set(db.prepare('SELECT name FROM schema_migrations').all().map((r: any) => r.name));
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => /^\d+_.*\.sql$/.test(f)).sort();
  const applied: string[] = [];
  for (const f of files) {
    if (done.has(f)) continue;
    const sql = readFileSync(join(MIGRATIONS_DIR, f), 'utf8');
    db.transaction(() => {
      db.exec(sql);
      db.prepare('INSERT INTO schema_migrations(name, applied_at) VALUES (?, ?)').run(f, Date.now());
    })();
    applied.push(f);
  }
  return applied;
}

export const db: DB = openDb(process.env.NODE_ENV === 'test' ? ':memory:' : config.dbPath);

export const now = () => Date.now();
export const uid = () => randomUUID();
/** Short human-friendly code without ambiguous characters. */
export function shortCode(len = 6): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = randomBytes(len);
  let s = '';
  for (let i = 0; i < len; i++) s += alphabet[bytes[i] % alphabet.length];
  return s;
}
export const json = <T = any>(s: string | null | undefined, fallback: T): T => {
  if (!s) return fallback;
  try { return JSON.parse(s) as T; } catch { return fallback; }
};
export function audit(actorId: string | null, action: string, target: string | null, detail: object = {}) {
  db.prepare('INSERT INTO audit_log(actor_id, action, target, detail, created_at) VALUES (?,?,?,?,?)').run(actorId, action, target, JSON.stringify(detail), now());
}
