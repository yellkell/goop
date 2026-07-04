# The Gasket Gazette

A daily, AI-written in-world newspaper. **Sheriff Cole Ironside** — a tin-star
lawman of the frontier town of **Gasket**, who despises the metal "Clankers"
(the players) wrecking his peace, and who is secretly a Clanker himself in
furious denial — reads the ladder each day and files an editorial. It lands in
the lobby behind a small round paper button above the right-hand panel; the
button wears a **red notification dot** until you've read the latest edition.

## How it fits together

```
 scheduled Claude task (daily)
   └─ /daily-gazette  (.claude/commands/daily-gazette.md)
        1. node scripts/ladder-brief.mjs    → reads Firestore `players`,
           diffs `newspaper/_snapshot`, prints a JSON "wire report"
           (climbers + busiest only — never who fell; the paper won't punch down)
        2. Claude writes the editorial in Sheriff Cole Ironside's voice
        3. node scripts/publish-gazette.mjs → writes `newspaper/latest`
           (edition bumped, publish timestamp) + rolls `_snapshot` forward

 game client (lobby)
   └─ src/net/gazette.ts   reads `newspaper/latest`, tracks unread vs a
                           localStorage "seen edition"
   └─ src/menu/menu.ts     the round paper button (red dot) + the front page
   └─ src/systems/MenuSystem.ts  opens/closes it, marks read, refreshes
```

Because delivery is a **live Firestore doc** (not a committed file), a new
edition appears the next time a player lands in the lobby — no rebuild/redeploy
— which is what lets the button show the "new edition" dot.

## Firestore data

- `newspaper/latest` — the live edition the game reads:
  `{ edition, dateline, headline, subhead, body, byline, mood, publishedAt }`.
- `newspaper/_snapshot` — internal generator state: the ladder standings as of
  the last published edition, used to compute "what changed" for the next one.

### Required security rules

Two collections must be reachable from the scheduled task:

```
// The scheduled task reads the ladder to write the editorial.
match /players/{doc} {
  allow read: if true;
}
// The edition the game reads + the generator's snapshot state.
match /newspaper/{doc} {
  allow read, write: if true;
}
```

(Hackathon-grade, matching the existing `lobbies` / `arcadeRooms` rules —
tighten with App Check before a big public release.)

> **Heads up:** as of writing, a plain unauthenticated read of `players`
> returns `permission-denied` from outside the deployed client, so the
> `players` read rule above isn't open yet — add it (or the wire-report step
> will fail with that error). The Firebase web API key in the scripts is a
> public identifier, not a secret (the same one shipped in
> `src/net/firebaseConfig.ts`); access is governed entirely by these rules.

## Setting up the daily schedule

The article generation is meant to run as a **Claude scheduled task** (Claude
Code on the web). This repo ships everything the task needs; you wire the
schedule itself in the Claude Code web app:

1. Create a scheduled session/trigger on this repository (branch
   `claude/fire-fight-ui-gameplay-1zrr9b`, or wherever this lands).
2. Set it to run roughly once a day.
3. Set the prompt to: **`/daily-gazette`**
4. Make sure the environment's **network policy allows outbound HTTPS to
   Firebase/Google APIs** (the scripts read and write Firestore).

That's it — each run reads the ladder, writes the day's edition, and the dot
lights up for every player.

## Running it by hand

```
node scripts/ladder-brief.mjs            # see today's wire report
# ...write /tmp/gazette.json in Cole's voice...
node scripts/publish-gazette.mjs /tmp/gazette.json
```
