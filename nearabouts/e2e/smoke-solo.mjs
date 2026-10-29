// Plays a Quick game start-to-finish in headless Chromium and screenshots each stage.
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
const BASE = process.env.BASE ?? 'http://localhost:8787';
const OUT = process.env.OUT ?? '/tmp/claude-0/shots';
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1366, height: 800 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(BASE);
await page.getByTestId('quick-play').click();
await page.waitForSelector('[data-testid=pano] canvas');
await page.waitForFunction(() => !document.querySelector('.pano-loading'), null, { timeout: 20000 });
await page.screenshot({ path: `${OUT}/1-round.png` });
for (let i = 0; i < 3; i++) {
  await page.waitForSelector('[data-testid=guess-map]');
  const box = await page.getByTestId('guess-map').boundingBox();
  await page.getByTestId('guess-map').hover();
  await page.waitForTimeout(300);
  const b2 = await page.getByTestId('guess-map').boundingBox();
  await page.mouse.click(b2.x + b2.width * (0.3 + i * 0.15), b2.y + b2.height * 0.45);
  await page.getByTestId('guess-btn').click();
  await page.waitForSelector('[data-testid=round-result]');
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${OUT}/2-result-${i}.png` });
  await page.getByTestId('next-btn').click();
  if (i < 2) await page.waitForFunction(() => !document.querySelector('.pano-loading') && document.querySelector('[data-testid=pano] canvas'), null, { timeout: 20000 });
}
await page.waitForSelector('[data-testid=summary]');
await page.waitForTimeout(800);
await page.screenshot({ path: `${OUT}/3-summary.png`, fullPage: true });
console.log('final score:', await page.getByTestId('final-score').textContent());
console.log('errors:', errors);
await browser.close();
