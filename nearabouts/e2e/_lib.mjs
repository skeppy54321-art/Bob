// Shared helpers for the browser tests.
import { createRequire } from 'node:module';
export const { chromium } = createRequire(import.meta.url)('playwright');
export const BASE = process.env.BASE ?? 'http://localhost:8787';
export const OUT = process.env.OUT ?? '/tmp/nearabouts-e2e';
export const launch = () => chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
/** New independent player (own cookies) at a Chromebook-sized window; picks a name on the welcome screen. */
export async function newPlayer(browser, name, errors = [], viewport = { width: 1366, height: 768 }) {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`[${name}] ${e.message}`));
  await page.goto(BASE);
  await page.getByTestId('name-input').fill(`${name}${Math.floor(Math.random() * 1e5)}`);
  await page.getByTestId('name-submit').click();
  await page.waitForSelector('[data-testid=quick-play]');
  return page;
}
export async function guessOn(page, fx, fy) {
  await page.waitForSelector('[data-testid=guess-map]');
  await page.getByTestId('guess-map').hover();
  await page.waitForTimeout(250);
  const b = await page.getByTestId('guess-map').boundingBox();
  await page.mouse.click(b.x + b.width * fx, b.y + b.height * fy);
  await page.getByTestId('guess-btn').click();
}
export const panoReady = (page) => page.waitForFunction(() => document.querySelector('[data-testid=pano] canvas') && !document.querySelector('.pano-loading'), null, { timeout: 20000 });
