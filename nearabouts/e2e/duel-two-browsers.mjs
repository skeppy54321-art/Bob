// Two independent browser sessions (separate cookies = separate players) play a full duel through the UI.
import { launch, newPlayer, guessOn, BASE, OUT } from './_lib.mjs';
const errors = [];
const browser = await launch();
const A = await newPlayer(browser, 'Ana', errors), B = await newPlayer(browser, 'Ben', errors);
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

// Reload mid-game: B refreshes during a round and lands back in the same round.
await A.getByRole('button', { name: 'Party classic' }).click();
await B.getByTestId('ready-btn').click();
await A.waitForFunction(() => !document.querySelector('[data-testid=start-btn]').disabled);
await A.getByTestId('start-btn').click();
await B.waitForSelector('[data-testid=mp-round]', { timeout: 20000 });
const before = await B.getByTestId('mp-round').textContent();
await B.reload();
await B.waitForSelector('[data-testid=mp-round]', { timeout: 20000 });
console.log('B reloaded mid-round; round before/after:', before, '/', await B.getByTestId('mp-round').textContent());
// B closes the tab entirely: A is not kept waiting (offline players don't block the round).
await B.context().close();
await guessOn(A, 0.5, 0.5);
await A.waitForSelector('[data-testid=mp-reveal]', { timeout: 20000 });
console.log('A got the round result without waiting for disconnected B');
console.log('errors:', errors);
await browser.close();
if (errors.length) process.exit(1);
