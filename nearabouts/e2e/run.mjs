// Runs every browser test in this folder against BASE (default http://localhost:8787).
import { spawnSync } from 'node:child_process';
import { readdirSync, mkdirSync } from 'node:fs';
const dir = new URL('.', import.meta.url).pathname;
mkdirSync(process.env.OUT ?? '/tmp/nearabouts-e2e', { recursive: true });
let failed = 0;
for (const f of readdirSync(dir).filter((x) => x.endsWith('.mjs') && x !== 'run.mjs' && !x.startsWith('_')).sort()) {
  console.log(`\n▶ ${f}`);
  const r = spawnSync(process.execPath, [dir + f], { stdio: 'inherit', env: { OUT: '/tmp/nearabouts-e2e', ...process.env } });
  if (r.status !== 0) { failed++; console.log(`✗ ${f} failed`); } else console.log(`✓ ${f}`);
}
process.exit(failed ? 1 : 0);
