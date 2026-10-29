// Three independent players play Battle Royale: Distance through the UI until one is left.
import { launch, newPlayer, guessOn, BASE, OUT } from './_lib.mjs';
const errors = [];
const browser = await launch();
const [A, B, C] = [await newPlayer(browser, 'Ari', errors), await newPlayer(browser, 'Bo', errors), await newPlayer(browser, 'Cy', errors)];
await A.goto(`${BASE}/rooms`);
await A.getByTestId('create-room').click();
const code = (await (await A.waitForSelector('[data-testid=room-code]')).textContent()).trim();
await A.getByRole('button', { name: 'BR Distance' }).click();
for (const p of [B, C]) { await p.goto(`${BASE}/r/${code}`); await p.getByTestId('ready-btn').click(); }
await A.waitForFunction(() => !document.querySelector('[data-testid=start-btn]').disabled);
await A.getByTestId('start-btn').click();
const players = [A, B, C];
for (let round = 0; round < 6; round++) {
  await A.waitForSelector('[data-testid=mp-round], [data-testid=mp-finished]', { timeout: 30000 });
  if (await A.$('[data-testid=mp-finished]')) break;
  // Everyone still alive guesses at a different spot so somebody is clearly farthest.
  for (const [i, p] of players.entries()) {
    const btn = p.getByTestId('guess-btn');
    if (await btn.isDisabled().catch(() => true) && !(await p.$('[data-testid=guess-map]'))) continue;
    const label = await btn.textContent().catch(() => '');
    if (/Eliminated|Spectating/.test(label)) continue;
    await guessOn(p, 0.2 + i * 0.3, 0.3 + i * 0.15).catch(() => {});
  }
  await A.waitForSelector('[data-testid=mp-reveal], [data-testid=mp-finished]', { timeout: 30000 });
  if (round === 0) { await A.waitForTimeout(700); await A.screenshot({ path: `${OUT}/br-reveal.png` }); }
  if (await A.$('[data-testid=mp-finished]')) break;
  for (const p of players) await p.getByTestId('continue-btn').click({ timeout: 2000 }).catch(() => {});
}
await A.waitForSelector('[data-testid=mp-finished]', { timeout: 30000 });
const heads = await Promise.all(players.map(async (p) => { await p.waitForSelector('[data-testid=mp-headline]'); return p.getByTestId('mp-headline').textContent(); }));
console.log('final headlines:', heads.join(' | '));
if (heads.filter((h) => /Winner/.test(h)).length !== 1) throw new Error('expected exactly one winner');
await A.screenshot({ path: `${OUT}/br-finished.png`, fullPage: true });
console.log('errors:', errors);
await browser.close();
if (errors.length) process.exit(1);
