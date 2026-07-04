# GOOP

Passthrough XR boxing against a man-sized blob of living gel.

It oozes into your actual room as an amorphous glob, pulls itself up into a
boxer's silhouette to throw telegraphed straights at your head, and slumps
back into a puddle between combos. Punch it hard enough and you knock
**lumps** clean out of it — they fly, splat on your floor, quiver, then crawl
home and are absorbed back into the body. Put its health to zero before the
bell and the whole creature collapses into a doormat.

Built on Meta's **Immersive Web SDK** (`@iwsdk/core`) + Three.js, targeting
Quest 3 / 3S in the Quest Browser. Songs, the ring announcer, countdown and
verdict art are harvested from FIRE FIGHT (same repo lineage).

## The creature (the whole point)

- `src/creature/sim.ts` — a verlet blob soup: ~22 core blobs chase pose
  anchors on underdamped springs; lumps/drips/dents come and go around them.
  One signed-distance field is shared by physics, gameplay and pixels.
- `src/creature/poses.ts` — the body plan: the same 22 blobs packed into a
  restless GLOB dome, stretched into the BOXER guard, or flattened into the
  KO PUDDLE. Morphing is a per-anchor lerp; the smooth-min surface makes it
  read as gel pouring itself into a man.
- `src/creature/gelMaterial.ts` — a bounded raymarched SDF drawn in one box:
  polynomial smooth-min over all blobs, fresnel + procedural env reflection,
  Beer–Lambert absorption from a soft view-ray thickness estimate, an inner
  "nucleus" glow, analytic speculars, agitation-driven surface roil, and
  gl_FragDepth from the real hit point so fists and eyes sort INTO the goo.
- `src/creature/GelCreature.ts` — ties it together, throws the punches,
  places the surface-riding eyes, makes the body noises.

## Run it

```bash
npm install
npm run dev        # desktop WebXR emulator (WASD + mouse) or Quest Browser
```

- **`/` (index.html)** — the game: Enter the Ring → passthrough session.
  Punch the goop three times (or press A) to start the bout.
- **`/dev.html`** — the flat-screen creature workbench: orbit, click to
  punch, keys 1/2 glob/boxer, 3 punch, 4 auto-spar, 5 KO. No headset needed.

```bash
npm run build      # typecheck + production bundle
node scripts/shot.mjs [outDir] [scene ...]   # headless creature screenshots
```

## Hosting (GitHub Pages)

The repo ships a Pages workflow (`.github/workflows/deploy.yml`). One-time
setup: **Settings → Pages → Build and deployment → Source: "GitHub
Actions"**. It deploys on every push to `main` (or run it manually from the
Actions tab on any branch via *Run workflow*). The game lands at
`https://<owner>.github.io/goop/` — HTTPS, which WebXR requires — and the
flat-screen creature workbench at `https://<owner>.github.io/goop/dev.html`.

## Perf notes (Quest 3)

The raymarch is the budget. Knobs in `src/config.ts` (`GEL_LOOK.maxSteps`,
blob counts via `CREATURE.maxLumps`/`maxDents`) and the march is bounded by
the live blob AABB, so cost scales with how much screen the creature covers.
