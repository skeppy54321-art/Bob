# Security and fair play

**Nearabouts is not cheat-proof.** It's built so honest play is fair and casual cheating takes effort. A determined player with browser developer tools can still find the answer.

## What the server controls

* **Answers:**
  * Answer coordinates and countries stay on the server until a round closes.
  * The browser receives only what the panorama viewer needs: the provider name, an image ID, a starting direction and attribution.
  * Demo panorama IDs are opaque hashes, so an ID doesn't give away the country.
  * Future rounds' locations are never sent ahead of time.
* **Scoring:** distances, scores, streak correctness (point-in-polygon on Natural Earth borders), damage, lives, eliminations and results are all computed on the server.
* **Timers:**
  * The server sets each deadline when the round starts.
  * Guesses after the deadline plus a 1.5-second network grace period are rejected.
  * Solo rounds that expire are closed as missed the next time the game is loaded.
* **Duplicate submissions:** the first accepted guess per round counts. Duplicates and late guesses get the current state back and change nothing.
* **Race conditions:**
  * Solo guesses run inside a SQLite transaction.
  * Room actions run on Node's single thread, and every timer callback checks the room's "epoch", so stale timers from earlier rounds or matches can't fire.
* **Your games are yours:** game IDs are random UUIDs, and the server checks that each game belongs to the requesting player.

## Unavoidable answer exposure

* **Live imagery (Mapillary):** the browser loads the panorama through MapillaryJS. To display the image, the SDK fetches the image's metadata, which **includes its coordinates**. Anyone watching network traffic in developer tools can read the location. This is true of any game that shows third-party street imagery in the browser.
* **Demo mode:** the scene description (biome, road paint, driving side, sun angle) is sent to the browser because the browser draws the scene. It reveals only the visual clues a player can already see.

## Movement rules

No Move and NMPZ are enforced by the viewer in the browser, for example by disabling drag, zoom and travel controls. A player who modifies the page could bypass them.

## Players, sessions and abuse

* **Identity:**
  * There are no passwords or emails.
  * A player is identified by a random 256-bit session token in an HttpOnly, SameSite=Lax cookie (Secure in production). The server stores only its SHA-256 hash.
  * Player names are unique.
* **Admins:** admin rights can only be granted on the server (`npm run make-admin`), never by picking a name.
* **Rate limits:**
  * Global: 300 API requests per minute per IP.
  * Creating games: 30 per minute.
  * Profile and name updates: 30 per minute.
  * Imagery lookups in the editor: 40 per minute.
  * Adding map locations: 60 per minute.
  * Chat: 5 messages per 10 seconds.
* **Provider spending cap:** `PROVIDER_DAILY_BUDGET` caps imagery-provider calls per UTC day. The count is stored in the database, so restarts don't reset it.
* **Input validation:**
  * Coordinates, rule values, names, text lengths and room settings are all clamped or validated on the server.
  * Map locations are only accepted after the imagery provider confirms imagery exists at that spot. The server never trusts a panorama ID sent by the browser.
* **Social safety:**
  * **Block** hides chat both ways and prevents friend requests and invites.
  * **Mute** hides a player's chat locally.
  * Hosts can kick players from rooms.
  * There's no report or moderation queue; that was dropped from scope. Admins can remove community maps.
* **HTTP headers:** responses send `X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN` and a strict `Referrer-Policy`.

## Secrets

* There are no secrets in the source code. `.env` is git-ignored, and `.env.example` documents every setting.
* The only provider credential is the Mapillary **client token**. MapillaryJS needs it in the browser, so it's public by design.
* Use a dedicated Mapillary application for the game, so you can rotate its token without affecting anything else.
