# Jukebox songs

Drop your `.mp3` files **in this folder** and commit them — the pub jukebox
picks them up automatically (no list to edit). Each track's name on the
marquee is taken from its filename, e.g. `sweet-home.mp3` → **SWEET HOME**.

- Keep the files reasonably sized — they're bundled into the app, so very large
  files bloat the download.
- Walk up to the cabinet in the pub and pull the trigger to cycle
  off → song 1 → song 2 → … → off. The whole room hears the same track.
- The server syncs the chosen track by its index; it caps at 64 songs.

(Only `.mp3` is wired up. Want `.ogg`/`.m4a` too? Say so and it's a one-liner.)
