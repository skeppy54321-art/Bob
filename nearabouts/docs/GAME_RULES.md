# Nearabouts game rules

All rules below are enforced on the server. The browser only sends intents ("I guess here", "I'm ready") and shows what the server decides.

## Scoring (all distance modes)

```
score = 5000                                  if d ≤ r0
score = round(5000 · e^(−9·(d − r0)/S))       otherwise
```

* `d` is the great-circle distance between your guess and the answer, in km (haversine formula).
* `S` is the map **scale**:
  * World: 18,000 km.
  * Continents: hand-set (Europe 6,000, Asia 11,000, …).
  * Countries and regions: the great-circle diagonal of the region's main landmass bounding box. Far-off islands are ignored.
  * Custom maps: the extent of their locations.
  * Every scale is clamped to between 2 km and 18,000 km.
* `r0` is the "perfect" radius, `S × 0.0002`. That's about 3.6 km on the world map, about 100 m on a 500 km country, and a few metres on a city map.

So a small regional map is judged relative to its own size. Being 50 km off is excellent on the World map and poor on a 30 km city map.

| World map distance | Points |
|---|---|
| 100 km | ~4,780 |
| 500 km | ~3,890 |
| 2,000 km | ~1,840 |
| 5,000 km | ~410 |
| 10,000 km | ~30 |

Classic games default to 5 rounds, so the maximum is 25,000 points. Distances display in km or miles; you choose in Settings.

## Movement rules

| Rule | Look around | Zoom | Travel |
|---|---|---|---|
| Moving | ✓ | ✓ | ✓ |
| No Move | ✓ | ✓ | ✗ |
| No Move, Pan, Zoom (NMPZ) | ✗ | ✗ | ✗ |

The viewer adapter enforces these in the browser. It's a rule of fair play, not a security boundary (see SECURITY.md).

## Timers

* Each round has a time limit: none, or 10–600 seconds.
* The deadline is set by the **server clock** when the round starts. Browsers show a countdown corrected for clock differences.
* A guess arriving up to **1.5 s after the deadline** still counts, to allow for network delay. Anything later is rejected.
* If time runs out with no guess, it's a **missed guess**: 0 points, or "wrong" in streak modes.

## Solo modes

| Mode | Rounds | Timer | Ends when | Notes |
|---|---|---|---|---|
| Classic | 1–20 (default 5) | your choice | all rounds played | any map, any rules |
| Quick play | 3 | 60 s | all rounds played | World, Moving, easy |
| Daily challenge | 5 | 3 min | all rounds played | see below |
| Country streak | open-ended | your choice | first wrong or missed answer | click anywhere inside the country; sea = wrong |
| US state streak | open-ended | your choice | first wrong or missed answer | 50 states + DC |
| Explorer | 5 | your choice | all rounds played | medals by total: bronze 10,000 · silver 15,000 · gold 20,000 · platinum 23,500 |
| Challenge link | as created | as created | all rounds played | identical locations and rules for everyone; one attempt each |

* Leaving a solo game doesn't forfeit it. Reopen it from your profile and the server clock keeps running, so expired rounds count as missed.
* Duplicate submissions (a double click, two tabs) are ignored. The first accepted guess stands.
* Streaks end with "You played every location" if the map runs out of unused locations.

### Daily challenge
* At the first request of each UTC day, the server picks the day's 5 World locations with a random-number generator seeded from the date. It stores them, so everyone gets the same places and rules (Moving, 3 minutes, 5 rounds).
* One attempt per player per day.
* The leaderboard ranks by score. On a tie, the faster total time ranks higher.
* Your daily streak counts consecutive UTC days with a finished daily. It stays alive if you played today or yesterday.

## Private rooms (2–10 players)

The host creates a room, which has a 5-character code and an invite link. Players join, and the host picks the format, map and rules.

**Ready check:** everyone except the host must press **Ready**. The host's **Start** button stays disabled until the roster fits the format and everyone is ready. If the host changes the rules, everyone has to confirm again.

**Host controls:** change settings, move players between teams, make someone a spectator, kick (a kicked player can't rejoin that room), hand over host, and start a rematch.

**Every round:**
1. All players get the same location.
2. Once every connected, still-playing player has guessed, the round ends immediately. Otherwise it ends at the deadline.
3. Results show for 9 seconds. If everyone presses **Continue**, the next round starts straight away.

**Duplicates and late guesses:** only the first guess per player per round counts. Guesses after the deadline plus the grace period are rejected.

**Disconnects:**
* If you drop out during a match, you have a **45-second grace period** to come back. Refreshing the page or briefly losing Wi-Fi is fine, and you rejoin the same round.
* Rounds don't wait for disconnected players. Anything you miss counts as a missed guess.
* After the grace period, you **forfeit**. Clicking **Leave** during a match forfeits immediately.

**Host leaves:** the longest-present connected player becomes host. In the lobby, a disconnected host gets 20 seconds to return before this happens.

**Empty rooms:** when nobody has been connected for 5 minutes, the room closes. An unfinished match is saved as "abandoned".

**Late joiners and spectators:** people who join mid-match watch as spectators and play from the next rematch. Players can also choose to spectate.

**Chat:**
* Free text (up to 200 characters, mild profanity masked) and preset messages.
* Rate-limited to 5 messages per 10 seconds.
* **Mute** hides someone in your browser. **Block** hides chat both ways and stops friend requests and invites.
* Chat isn't saved to the database.

**Server restarts** end any running room games, because rooms live in memory.

### Party classic (1–10 players)
* Everyone plays the set number of rounds, and the highest total wins.
* Players with equal totals share a place. A shared first place is a draw.
* **Teams (optional, 2 teams of up to 5):**
  * Each round, a team's score is the **average** of its members' scores, with missed guesses counted as 0. This keeps uneven teams fair.
  * The higher team total wins, and equal totals are a draw.
* Players who leave are placed last.

### Duel (exactly 2 players)
* Both players start with the same health (default 6,000; 1,000–20,000).
* Each round, the worse score takes **damage = (better score − worse score) × multiplier**.
  * Equal scores do no damage.
  * A missed guess scores 0. If both miss, nobody takes damage.
* **Multiplier:** ×1 until round *N* (default 4). After that it grows by a set step each round (default +0.5, so ×1.5, ×2, …, up to ×6). Both are configurable.
* **Countdown:** after the first guess, the other player has a short countdown (default 15 s, configurable or off).
* **Winning:** a player at 0 health loses. After 40 rounds, higher health wins and equal health is a draw.
* **Forfeit:** leaving, or staying disconnected past the grace period, loses the match.

### Team duel (2 teams, 1–5 players each)
* Each team shares one health pool.
* A team's round score is its **best** (closest) guess.
* Damage = (better team score − worse team score) × multiplier, taken from the worse team's pool.
* The countdown starts after the first guess from anyone.
* **Winning:** a team at 0 health loses. If every player on a team leaves, that team forfeits. After 40 rounds, the healthier team wins, and equal health is a draw.

### Battle Royale: Countries (2–10 players)
* Click inside the country you think you're in before time runs out (default 30 s).
* **Lives:** a wrong country, a click in the sea or no answer costs **1 life** (default 3 lives, 1–5). At 0 lives you're eliminated and watch the rest of the game.
* **Everyone would be eliminated:** if every remaining player would hit 0 lives in the same round, nobody loses a life that round.
* **Optional rule:** if everyone answers correctly, the slowest correct player loses a life. This prevents endless rounds.
* **Winning:** the last player standing wins. After 40 rounds, everyone still in shares the win as a draw.
* **Placings:** later elimination ranks higher. Players eliminated in the same round share a place, and forfeits come last.

### Battle Royale: Distance (2–10 players)
* **Elimination:** each round, the farthest guess is eliminated (configurable 1–3 per round). Missed guesses count as farthest.
* **Ties:** on equal distance, the later guess is eliminated.
* **Everyone misses:** if nobody guesses, nobody is eliminated.
* **Last two:** at least one player always survives a round.
* **Countdown:** after the first guess, everyone else has a short countdown (default 20 s).
* **Winning:** the last player standing wins. Placings work like BR Countries.

## XP, levels and achievements
* **Solo games** give 10 XP plus 1 XP per 250 points, with a 40 XP bonus for the daily. Streaks give 10 XP plus 8 XP per correct answer.
* **Multiplayer games** give 15 XP plus up to 60 XP for rounds played, plus 50 XP for a win or 20 XP for a draw. Forfeiting costs 15 XP.
* **Levels:** reaching level L takes 100·(L−1)^1.6 total XP.
* **Achievements:** there are 20, listed on every profile.
