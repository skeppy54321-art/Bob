// Tour of the supporting features through the UI: map editor, playing a custom map, daily, explorer,
// challenge links shared between two players, friends, leaderboards and renaming.
import { launch, newPlayer, panoReady, BASE, OUT } from './_lib.mjs';
const errors = [];
const browser = await launch();
const A = await newPlayer(browser, 'Maker', errors);
const B = await newPlayer(browser, 'Pal', errors);
const nameOf = async (p) => (await p.evaluate(() => fetch('/api/me').then((r) => r.json()))).user.username;
const nameA = await nameOf(A), nameB = await nameOf(B);
const ok = (msg) => console.log('✓', msg);

// --- map editor: create a map and add 5 demo locations by coordinates
await A.goto(`${BASE}/maps`);
await A.getByTestId('create-map').click();
await A.locator('.modal input').first().fill('E2E Road Trip');
await A.locator('.modal').getByRole('button', { name: /create/i }).last().click();
await A.waitForURL(/\/edit$/);
const pts = ['39.5, -117.0', '42.0, -93.5', '51.51, -0.12', '35.68, 139.7', '-33.87, 151.2'];
for (const [i, c] of pts.entries()) {
  await A.getByPlaceholder(/lat, lng/).fill(c);
  await A.getByRole('button', { name: 'Find' }).click();
  await A.getByTestId('add-location').click();
  await A.waitForFunction((n) => document.body.textContent.includes(`Locations (${n})`), i + 1, { timeout: 10000 });
}
await A.screenshot({ path: `${OUT}/editor-5.png` });
ok('editor: 5 locations added with imagery preview');
const slug = A.url().split('/maps/')[1].replace('/edit', '');
await A.goto(`${BASE}/maps/${slug}`);
await A.getByTestId('play-classic').click();
await panoReady(A);
ok(`custom map "${slug}" is playable`);

// --- daily challenge
await A.goto(`${BASE}/daily`);
await A.getByTestId('daily-play').click();
await panoReady(A);
ok('daily challenge starts');

// --- explorer
await A.goto(`${BASE}/explorer`);
await A.getByRole('button', { name: 'Play United States' }).click();
await panoReady(A);
ok('explorer country game starts');

// --- challenge link: A creates, B plays the same challenge
await A.goto(`${BASE}/maps/world`);
await A.getByTestId('make-challenge').click();
await A.waitForURL(/\/c\//);
const code = A.url().split('/c/')[1];
await B.goto(`${BASE}/c/${code}`);
await B.getByTestId('challenge-play').click();
await panoReady(B);
const rounds = await B.evaluate(async (c) => (await fetch(`/api/challenges/${c}`).then((r) => r.json())).rounds, code);
ok(`challenge ${code} opened by a second player (${rounds} rounds)`);

// --- friends: B adds A, A accepts
await B.goto(`${BASE}/friends`);
await B.getByLabel('Search players by username').fill(nameA);
await B.getByRole('button', { name: 'Add', exact: true }).click();
await B.waitForFunction(() => document.body.textContent.includes('Request sent') || document.body.textContent.includes('Friend request sent'));
await A.goto(`${BASE}/friends`);
await A.getByRole('button', { name: 'Accept' }).first().click();
await A.waitForFunction((n) => document.body.textContent.includes(n), nameB);
const fr = await A.evaluate(() => fetch('/api/friends').then((r) => r.json()));
if (!fr.friends.some((f) => f.username === nameB)) throw new Error('friendship not created');
ok('friend request sent and accepted');

// --- leaderboards (friends scope)
await A.goto(`${BASE}/leaderboards`);
await A.getByRole('button', { name: 'Friends' }).click();
await A.waitForTimeout(800);
await A.screenshot({ path: `${OUT}/leaderboards-friends.png` });
ok('leaderboards render (friends scope)');

// --- rename in settings
await A.goto(`${BASE}/settings`);
const newName = `Renamed${Math.floor(Math.random() * 1e4)}`;
await A.getByTestId('name-input').fill(newName);
await A.getByTestId('name-submit').click();
await A.waitForFunction((n) => document.querySelector('.topbar').textContent.includes(n), newName);
ok(`renamed to ${newName}`);

console.log('errors:', errors);
await browser.close();
if (errors.length) process.exit(1);
