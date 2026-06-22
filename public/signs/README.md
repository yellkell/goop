# Pub signs

Drop the pub sign PNG here as exactly:

    public/signs/iron-balls-pub.png

It's mounted on the back-bar wall (and over the fight hall) in the pub. Until
the file exists the game shows a procedural neon "IRON BALLS" fallback (see
src/pub/signs.ts), so the build never breaks if it's missing. `buildSign`
letterbox-fits the art to its real aspect ratio, so any shape works without
squashing; transparent PNGs work as-is. After changing it: `npm run build`
then `firebase deploy --only hosting`.
