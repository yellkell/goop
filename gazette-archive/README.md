# The Gasket Gazette — archive

Every edition of **The Gasket Gazette**, written by Sheriff Cole Ironside (the
tin-star lawman of Gasket, who is — though it galls him to admit it — quite
plainly a Clanker himself). Each issue is filed here as it's published.

- `no-NNN.json` — the raw edition data (headline, subhead, body, mood, byline, dateline).
- `no-NNN.md` — the same edition, readable.

These are saved purely to keep them; the game reads the *live* edition from
Firestore (`newspaper/latest`), which only ever holds the most recent one — so
this folder is the only permanent record.

New editions are archived automatically: `scripts/publish-gazette.mjs` writes the
files when it files an edition, and the `/daily-gazette` task commits them.

Editions 1–4 predate this archive and were overwritten in Firestore, so the
record begins at **No. 5**.
