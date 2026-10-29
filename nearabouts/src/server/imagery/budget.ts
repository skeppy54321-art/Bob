/** Daily cap on paid / rate-limited provider calls, stored in SQLite so it survives restarts. */
import { db } from '../db.ts';
import { config } from '../config.ts';

export function spendBudget(key: string, amount = 1): boolean {
  const day = new Date().toISOString().slice(0, 10);
  const row = db.prepare('SELECT count FROM api_usage WHERE day=? AND key=?').get(day, key) as { count: number } | undefined;
  if ((row?.count ?? 0) + amount > config.providerDailyBudget) return false;
  db.prepare('INSERT INTO api_usage(day,key,count) VALUES (?,?,?) ON CONFLICT(day,key) DO UPDATE SET count=count+excluded.count').run(day, key, amount);
  return true;
}
export function budgetUsed(key: string): number {
  const day = new Date().toISOString().slice(0, 10);
  return (db.prepare('SELECT count FROM api_usage WHERE day=? AND key=?').get(day, key) as any)?.count ?? 0;
}
