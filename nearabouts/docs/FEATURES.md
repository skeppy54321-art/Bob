# Feature checklist

What each status means:
* **Working:** implemented and verified by automated tests and/or driving the real UI in a browser.
* **Partially working:** usable, with the gap described.
* **Blocked:** needs something outside this codebase (an account or network access).
* **Dropped:** removed from scope at the owner's request.

Verification used to fill this in:
* `npm test`: 45 server tests.
* `npm run e2e`: 4 browser scripts at 1366×768, using independent browser sessions for multiplayer.

## Gameplay

| Feature | Status | Notes |
|---|---|---|
| Interactive street-level panorama | Working (demo) / Blocked (live) | Demo: own WebGL 360° viewer with procedural scenes. Live: MapillaryJS adapter, written but untested without a token or network access |
| Look around, zoom, travel along roads | Working (demo) | Drag, arrow keys, wheel or pinch; travel with arrows or W/S. Covered by the e2e test |
| Moving / No Move / NMPZ | Working | Enforced by the viewer. The e2e test checks travel works in Moving and the view is locked in NMPZ |
| Compass, return to start, fullscreen, keyboard shortcuts, help overlay | Working | |
| Resizable guess map (hover-expand, 3 sizes, drag-resize, pin open), zoom, pan, movable marker | Working | |
| Guess map views: satellite (default), street map, borders | Working | Tile requests verified. Real imagery can't load inside the build sandbox (network blocked), so this was checked by request URLs, not by eye |
| Results: answer, guess, connecting line, distance, score | Working | |
| Kilometres and miles | Working | Settings |
| 5 rounds × 5,000 = 25,000 default | Working | |
| Documented scoring formula with map-size scaling | Working | docs/GAME_RULES.md; unit-tested |
| Timers / untimed / round count / difficulty | Working | Server-enforced deadlines with a 1.5 s grace period; expiry is unit-tested |
| Round summaries, final results, replay, share text, challenge link | Working | |

## Modes

| Mode | Status | Notes |
|---|---|---|
| Classic on World, continents, countries, cities, landmarks, community maps | Working | In demo mode many maps have too few demo locations and say so clearly |
| Daily challenge, leaderboard, daily streaks | Working | Identical locations and rules for everyone (unit-tested) |
| Country streak / US state streak | Working | Point-in-polygon on Natural Earth borders |
| Explorer (per-country progress, best scores, medals) | Working | Demo mode: only the US has 5+ demo locations |
| 1v1 duels (health, damage, multipliers, countdown after first guess) | Working | Played through the UI by two independent browsers; unit-tested |
| 2v2 team duels (shared health, best guess per team) | Working | Unit-tested. Supports 1–5 per team. Not driven by 4 real browsers |
| Battle Royale: Countries (lives, configurable rules) | Working | Unit-tested |
| Battle Royale: Distance (farthest eliminated) | Working | Played by three independent browsers; unit-tested |
| Private parties: room codes, invite links, host controls, teams, ready states, custom rules, rematches | Working | Up to 10 players |
| Asynchronous challenges | Working | |
| Quick play | Working | |
| Ranked play, matchmaking, divisions, seasons | Dropped | Owner asked for a friends-only game |
| Tournaments | Dropped | Owner's request |

## Maps and locations

| Feature | Status | Notes |
|---|---|---|
| Map browser: search, categories, favorites, descriptions, creators, popularity | Working | |
| Map editor: add locations with imagery preview, set starting direction, publish or keep private | Working | Locations are accepted only after the provider confirms imagery exists |
| Explicit location lists and geographic boundaries | Working | Region maps: world, continent, countries, US states, circles |
| Validate imagery before use | Working (demo) / Blocked (live) | Live provider calls are untested here |
| Geographic spread and no repeats within a match | Working | Unit-tested |
| Recover from unavailable panoramas | Working (logic) | Re-checks the panorama with the provider and swaps the location. Never triggered in demo mode |
| Accurate boundaries; no invented coverage | Working | Natural Earth 1:50m, cut at the antimeridian. Demo locations are labelled as illustrations, never as real imagery |

## Players and community

| Feature | Status | Notes |
|---|---|---|
| Accounts with sign-up and login | Dropped / replaced | Owner's request: everyone picks a name, gets a random avatar, and is remembered by browser cookie |
| Profiles, original avatars (editable), bio | Working | |
| Friends, requests, invitations to rooms | Working | Invites arrive live, or are listed on the Rooms page |
| Match history, detailed stats, achievements (20), XP and levels | Working | |
| Global and friends leaderboards (XP, best World game, streak, today's daily, wins) | Working | |
| Party chat with preset messages, mute, block | Working | |
| Report system and admin moderation queue | Dropped | Admins (granted by CLI) can edit or remove community maps |

## Platform and technical

| Feature | Status | Notes |
|---|---|---|
| Laptop and Chromebook layouts | Working | Checked at 1366×768 |
| Phones and tablets | Dropped | Owner's request. The basic layout still adapts, but isn't tested |
| Loading, empty and error states; keyboard navigation; reduced motion | Working | |
| Server-authoritative multiplayer: timers, guesses, scores, damage, outcomes | Working | |
| Reconnects, duplicate submissions, host departure, races, abandoned rooms | Working | Unit tests plus reload and disconnect in a real browser |
| Future answers kept out of client responses | Working | Tested |
| Provider abstraction and attribution | Working | Demo plus Mapillary; Google Street View not implemented (cost and terms) |
| Rate limits and provider daily budget | Working | |
| SQLite schema and migrations | Working | `src/server/migrations` |
| Deployment files (Dockerfile, render.yaml, fly.toml) | Ready, not deployed | No Docker daemon or hosting credentials in the build environment. A production install was simulated with runtime dependencies only |
| Multiplayer rooms survive a server restart | Not supported | Rooms live in memory; one server instance only |
