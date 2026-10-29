// Two independent browser sessions (separate cookies = separate players) play a full duel through the UI.
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
const BASE = process.env.BASE ?? 'http://localhost:8787';
const OUT = process.env.OUT ?? '/tmp/claude-0/shots';
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
const mk = async (name) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 780 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log(`[${name}] pageerror`, e.message));
  await page.goto(BASE);
  return page;
};
const A = await mk('A'), B = await mk('B');
await A.goto(`${BASE}/rooms`);
await A.getByTestId('create-room').click();
await A.waitForSelector('[data-testid=room-code]');
const code = (await A.getByTestId('room-code').textContent()).trim();
console.log('room', code);
await A.getByRole('button', { name: 'Duel (1v1)' }).click();
await A.getByRole('button', { name: '3,000' }).click();
await B.goto(`${BASE}/rooms`);
await B.getByTestId('join-code').fill(code);
await B.getByTestId('join-room').click();
await B.waitForSelector('[data-testid=ready-btn]');
await A.waitForFunction(() => document.querySelectorAll('[data-testid=player-row]').length === 2);
await B.getByTestId('ready-btn').click();
await A.waitForFunction(() => !document.querySelector('[data-testid=start-btn]').disabled);
await A.screenshot({ path: `${OUT}/mp-lobby.png` });
await A.getByTestId('start-btn').click();

const guessOn = async (page, fx, fy) => {
  await page.waitForSelector('[data-testid=guess-map]');
  await page.getByTestId('guess-map').hover();
  await page.waitForTimeout(250);
  const b = await page.getByTestId('guess-map').boundingBox();
  await page.mouse.click(b.x + b.width * fx, b.y + b.height * fy);
  await page.getByTestId('guess-btn').click();
};
let rounds = 0;
for (; rounds < 25; rounds++) {
  const st = await Promise.race([
    A.waitForSelector('[data-testid=stage] [data-testid=pano] canvas', { timeout: 30000 }).then(() => 'round'),
    A.waitForSelector('[data-testid=mp-finished]', { timeout: 30000 }).then(() => 'done'),
  ]);
  if (st === 'done') break;
  await guessOn(A, 0.5, 0.4);
  // B should now see the countdown triggered by A's first guess.
  await B.waitForFunction(() => document.body.textContent.includes('Hurry!'), null, { timeout: 10000 });
  if (rounds === 0) await B.screenshot({ path: `${OUT}/mp-round-B.png` });
  await guessOn(B, 0.2 + (rounds % 3) * 0.2, 0.6);
  const st2 = await Promise.race([
    A.waitForSelector('[data-testid=mp-reveal]', { timeout: 20000 }).then(() => 'reveal'),
    A.waitForSelector('[data-testid=mp-finished]', { timeout: 20000 }).then(() => 'done'),
  ]);
  if (rounds === 0) { await A.waitForTimeout(800); await A.screenshot({ path: `${OUT}/mp-reveal-A.png` }); }
  if (st2 === 'done') break;
  await A.getByTestId('continue-btn').click();
  await B.getByTestId('continue-btn').click().catch(() => {});
}
await A.waitForSelector('[data-testid=mp-finished]', { timeout: 30000 });
await B.waitForSelector('[data-testid=mp-finished]', { timeout: 30000 });
const ha = await A.getByTestId('mp-headline').textContent(), hb = await B.getByTestId('mp-headline').textContent();
console.log('rounds played:', rounds + 1, '| A:', ha, '| B:', hb);
await A.screenshot({ path: `${OUT}/mp-finished-A.png`, fullPage: true });
await A.getByTestId('rematch-btn').click();
await B.waitForSelector('[data-testid=ready-btn]', { timeout: 10000 });
console.log('rematch -> both back in lobby');
await browser.close();
