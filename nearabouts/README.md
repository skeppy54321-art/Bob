# Nearabouts

A location-guessing browser game. You're dropped onto a street somewhere on Earth: look around, read the clues, then drop a pin on the map. The closer your pin, the more points you get. You can play solo or in private rooms with up to 10 friends.

* **Solo:** Classic (any map, custom rules), Quick play, Daily challenge with leaderboard and streaks, Country and US-state streaks, Explorer medals, and shareable challenge links.
* **With friends:** room codes or invite links, a ready check, host controls, teams, chat with preset messages, and rematches. Formats:
  * Party classic
  * 1v1 Duels
  * Team duels
  * Battle Royale: Countries
  * Battle Royale: Distance
* **Accounts:** guest play with no sign-up, optional accounts, profiles with original avatars, friends and invites, stats, achievements, XP and levels, and leaderboards.
* **Maps:** World, continents, about 200 countries, cities and landmarks, plus a map editor for your own community maps.

> **Demo mode vs. real imagery.** Out of the box, Nearabouts runs in **demo mode**: rounds show illustrated 360° scenes drawn by the game's own code. They are clearly labelled and are not photos. The whole game works in demo mode. To use real street-level photos, add a free Mapillary token (see [Real imagery](#real-imagery-mapillary)).

---

## 1. Run it on your computer (for testing)

You need **Node.js 22 or newer** ([nodejs.org](https://nodejs.org), pick the "LTS" download).

Open a terminal in this `nearabouts` folder and run these one at a time:

```bash
npm install
```

```bash
npm run build
```

```bash
npm start
```

Then open **http://localhost:8787** in your browser.

* To test multiplayer on one computer, open a second browser, or a private/incognito window. Each window is a separate player.
* Press `Ctrl+C` in the terminal to stop the server.

**For development** (auto-reload when you edit code), run `npm run dev` and open http://localhost:5173.

## 2. Put it on the internet (so friends can play without your computer)

The game is one program: a web server, a real-time server and a small database file. It needs a host that:

1. runs a **Docker** container or Node.js app,
2. supports **WebSockets** (for multiplayer), and
3. has a **persistent disk** for the database file. Without one, accounts and history are wiped every time the site restarts.

Both options below cost a few dollars a month and need a payment card. Check their current pricing pages before you sign up, because prices change.

### Option A: Render (easiest, all in the browser)

1. Put this repository on GitHub (it already is if you're reading this there).
2. Create an account at [render.com](https://render.com) and connect your GitHub account.
3. Click **New +** → **Blueprint** and choose this repository. Render reads `nearabouts/render.yaml` and sets up:
   * a web service built from the `Dockerfile`, and
   * a 1 GB disk mounted at `/data` for the database.
4. When it asks for environment variables, leave them empty for demo mode. Fill in `MAPILLARY_CLIENT_TOKEN` later if you want real imagery (also set `IMAGERY_PROVIDER` to `mapillary`).
5. Click **Apply**. The first build takes a few minutes. Render then gives you a public address like `https://nearabouts-xxxx.onrender.com`. Share it with your friends.

Notes:
* The blueprint uses the **Starter** instance type, because persistent disks aren't available on Render's free tier.
* Multiplayer rooms live in the server's memory, so keep the service at **one instance**.

### Option B: Fly.io (cheaper, uses the command line)

1. Install the Fly CLI: [fly.io/docs/flyctl/install](https://fly.io/docs/flyctl/install/), then log in:
   ```bash
   fly auth login
   ```
2. In this `nearabouts` folder, create the app (pick a unique name when asked, and say **no** to databases):
   ```bash
   fly launch --no-deploy --copy-config
   ```
3. Create the database disk:
   ```bash
   fly volumes create nearabouts_data --size 1
   ```
4. Deploy:
   ```bash
   fly deploy
   ```
5. Open the site:
   ```bash
   fly open
   ```

### Any other Docker host

Build with the included `Dockerfile`. Mount a persistent volume at `/data` and expose port `8787`. Set `TRUST_PROXY=true` if the host puts a proxy in front of your app (most do).

## 3. Settings (environment variables)

Copy `.env.example` to `.env` for local use, or enter the same names in your host's "Environment" settings page. **Never commit `.env`**, because it can contain keys. It's already ignored by git.

| Variable | What it does |
|---|---|
| `IMAGERY_PROVIDER` | `demo` (default, illustrated scenes) or `mapillary` (real photos) |
| `MAPILLARY_CLIENT_TOKEN` | Your free Mapillary client token. Required for `mapillary`. |
| `PROVIDER_DAILY_BUDGET` | Max imagery lookups per day (default 2000). Protects against runaway usage. |
| `MAP_TILE_URL`, `MAP_TILE_ATTRIBUTION` | Optional street map for the guessing map (see below) |
| `DATABASE_PATH` | Where the SQLite file lives (`/data/nearabouts.sqlite` in Docker) |
| `ADMIN_USERNAMES` | Comma-separated usernames allowed to remove anyone's community maps |
| `TRUST_PROXY` | `true` behind Render/Fly/other proxies, so rate limits see real visitor IPs |
| `PUBLIC_URL`, `PORT` | Usually not needed |

### Real imagery (Mapillary)

[Mapillary](https://www.mapillary.com) is a free, community-made street-photo service. Photos are licensed CC BY-SA 4.0, and the game shows the photographer's name and a link in every round.

1. Create a free account at mapillary.com.
2. Go to **Dashboard → Developers → Register application**. Any name works; tick read access.
3. Copy the **Client Token** (it starts with `MLY|`).
4. Set `IMAGERY_PROVIDER=mapillary` and `MAPILLARY_CLIENT_TOKEN=MLY|...` on your host, then restart or redeploy.

How it behaves:
* The client token is sent to players' browsers, because Mapillary's viewer needs it. Mapillary designed it to be public. Don't put any other secrets in it.
* New games ask Mapillary for real photos near random points in the chosen map, using only places where imagery actually exists. The game saves those places, so later games are faster and make fewer requests.
* The first games on a fresh site can take a few seconds while that pool is built.
* Coverage differs a lot by country. A small or remote country map may say it has too few locations; try a bigger map.

> I couldn't reach Mapillary from the build sandbox, so the Mapillary connection is written against their documented API but **has not been tested live**. If something doesn't work, the server log shows the error, and you can switch back to `IMAGERY_PROVIDER=demo` at any time.

### Street map tiles for the guessing map (optional)

Without settings, the guessing map shows country borders only. That's enough for world maps, but too little for city maps. To show streets, set for example:

```
MAP_TILE_URL=https://tile.openstreetmap.org/{z}/{x}/{y}.png
MAP_TILE_ATTRIBUTION=&copy; OpenStreetMap contributors
```

OpenStreetMap's own servers only allow light use. For a busy site, use a tile company with a free tier and an API key (MapTiler, Stadia Maps, …) and follow their attribution rules.

## 4. Become an admin (optional)

Set `ADMIN_USERNAMES=yourname` and restart. Your account, once signed up, can edit or remove any community map. You can also run `npm run make-admin -- yourname` on the server.

## 5. Tests

```bash
npm test
```

This runs the unit and integration tests: scoring, distances, movement rules, timers, the daily challenge, accounts and every multiplayer format.

```bash
npm run e2e
```

This drives real browsers against a running server on port 8787. It plays a solo game, a two-player duel, a phone-sized game and a reconnect.

More documents:
* [docs/FEATURES.md](docs/FEATURES.md): feature checklist with an honest status for each feature
* [docs/GAME_RULES.md](docs/GAME_RULES.md): every mode's rules, including timers, ties, missed guesses, disconnects and win conditions
* [docs/SECURITY.md](docs/SECURITY.md): what's protected, and what isn't (the game is **not** cheat-proof)
