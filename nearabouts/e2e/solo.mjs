// Plays a Quick game start-to-finish and checks movement rules on the panorama.
import { launch, newPlayer, guessOn, panoReady, OUT } from './_lib.mjs';
const errors = [];
const browser = await launch();
const page = await newPlayer(browser, 'Solo', errors);
await page.getByTestId('quick-play').click();
await panoReady(page);
await page.screenshot({ path: `${OUT}/solo-round.png` });
// Moving rules: W travels forward along the road; R returns to the start.
const step0 = await page.getByTestId('pano').getAttribute('data-step');
await page.keyboard.press('w'); await page.waitForTimeout(600);
const step1 = await page.getByTestId('pano').getAttribute('data-step');
await page.keyboard.press('r'); await page.waitForTimeout(600);
const step2 = await page.getByTestId('pano').getAttribute('data-step');
if (!(step0 === '0' && step1 !== '0' && step2 === '0')) throw new Error(`movement failed ${step0} ${step1} ${step2}`);
console.log('moving: W moved', step0, '->', step1, '; R returned ->', step2);
for (let i = 0; i < 3; i++) {
  await guessOn(page, 0.3 + i * 0.15, 0.45);
  await page.waitForSelector('[data-testid=round-result]');
  if (i === 0) { await page.waitForTimeout(1000); await page.screenshot({ path: `${OUT}/solo-result.png` }); }
  await page.getByTestId('next-btn').click();
  if (i < 2) await panoReady(page);
}
await page.waitForSelector('[data-testid=summary]');
console.log('final score:', await page.getByTestId('final-score').textContent());
await page.screenshot({ path: `${OUT}/solo-summary.png`, fullPage: true });

// No Move, Pan or Zoom: dragging and keys must not change the view, and no travel arrows.
await page.goto(page.url().replace(/\/play\/.*/, '/play'));
await page.getByTestId('mode-streak_country').click();
await page.getByRole('button', { name: 'NMPZ' }).click();
await page.getByTestId('start-streak').click();
await panoReady(page);
const h0 = await page.getByTestId('pano').getAttribute('data-heading');
const box = await page.getByTestId('pano').boundingBox();
await page.mouse.move(box.x + 400, box.y + 300); await page.mouse.down(); await page.mouse.move(box.x + 700, box.y + 300, { steps: 5 }); await page.mouse.up();
await page.keyboard.press('ArrowRight'); await page.keyboard.press('w');
const h1 = await page.getByTestId('pano').getAttribute('data-heading');
const arrows = await page.locator('.move-arrow').count();
if (h0 !== h1 || arrows !== 0) throw new Error(`NMPZ not enforced: heading ${h0}->${h1}, arrows ${arrows}`);
console.log('NMPZ: view locked, no travel arrows');
console.log('errors:', errors);
await browser.close();
if (errors.length) process.exit(1);
