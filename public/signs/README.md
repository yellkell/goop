# Pub signs

Drop the bar sign PNG here as exactly:

    public/signs/iron-balls-bar.png

It's mounted on the back-bar wall in the pub. Until the file exists the game
shows a procedural neon "IRON BALLS" fallback (see src/pub/signs.ts), so the
build never breaks if it's missing. Transparent PNGs work as-is. After adding
it: `npm run build` then `firebase deploy --only hosting`.
