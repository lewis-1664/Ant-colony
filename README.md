# Ant Colony

Browser-based ant colony simulation. Place a nest, food sources, and walls;
watch ants discover food and form pheromone trails.

## How to run

Double-click `index.html` (or open it in any modern browser). No build step,
no server needed — the JS files load as plain `<script>` tags and attach to
a `window.AntSim` namespace, so this works from `file://` too.

If you'd rather serve over HTTP for any reason:

```
python -m http.server 8000
# then open http://localhost:8000/
```

## Current phase: 1 — MVP sandbox (complete)

Working:
- 1000×800 canvas
- Place nest (one), food sources (many), walls (paint by drag), eraser
- Ants spawn from nest, wander, find food, return, drop, repeat
- Two pheromone grids (home + food), evaporation, deposit-strength decay
- **Two-caste colony:** ~30% scouts (pure explorers — ignore food
  pheromone, deposit nothing while searching, walk near-ballistic
  paths) and ~70% workers (low wander, strong pheromone bias — exploit
  trails). Scouts spawn first so the colony bootstraps with explorers —
  see [SPEC.md](SPEC.md#two-caste-colony-scouts-and-workers)
- **Recruitment:** workers don't spawn until a scout returns with food.
  Once one does, workers march out along the heading the scout came
  from. Recent delivery headings live in a small ring buffer so multiple
  food sources can each get workers when both are productive. If no
  delivery happens for a while (`recruitmentTimeout`, default 1200
  ticks) the channel is declared dead and workers stop spawning until
  scouts re-discover food — see
  [SPEC.md](SPEC.md#recruitment-workers-wait-for-scouts)
- **U-turn on fading trail:** workers on a trail whose pheromone is
  dropping flip 180°, so the colony naturally abandons depleted routes —
  see [SPEC.md](SPEC.md#u-turn-on-weakening-trail)
- **Pheromone diffusion:** both grids get a per-tick blur (5-point
  stencil), modelling chemical diffusion in air. Smooths spikes,
  extends gradient reach, tightens trails — see
  [SPEC.md](SPEC.md#pheromone-model)
- **Snap-to-destination:** within ~32 px of nest/food, ants steer
  directly at the target instead of via pheromone. Stops the "drift past
  destination → phantom trail" failure — see
  [SPEC.md](SPEC.md#snap-to-destination)
- **Mortality:** ants that fail to reach the nest or food within `lifespan`
  ticks die. Keeps the colony from deadlocking on stuck carriers —
  see [SPEC.md](SPEC.md#mortality-ant-lifespan)
- Heatmap toggle (blue = home, red = food, blended where overlapping)
- Ant colour: pink = scouts, gray = workers, yellow = carrying food
- Controls: play/pause, speed (0.25×–8×), max ants, reset
- Stats: food collected, active ants, ants died, ticks elapsed

## What's next

Phase 1 is feature-complete. **Stop here and check in with the user before
starting Phase 2.** Likely next steps:

1. Confirm Phase 1 feels right (trails form within ~30s, parameters feel
   reasonable).
2. Begin Phase 2: parameter sliders, finite food, save/load, zoom/pan.

## Known issues / rough edges

- Ants can occasionally jitter when reflecting in tight obstacle pockets.
- Food in Phase 1 is infinite; finite quantities arrive in Phase 2.
- **Bootstrap variance.** Pure-explorer scouts find food by random walk,
  so the time-to-first-delivery is a coin flip with the food's distance.
  Distant food can occasionally fail to bootstrap within the recruitment
  timeout. Hit reset and try again, or place food closer to the nest.
- **Winner-take-all on multi-source.** Once one trail forms, the first
  scout to find the second source has to do so by random walk too, so
  multi-source discovery is slow. Real colonies show the same pattern.

## File map

- [index.html](index.html) — DOM shell (canvas + control panel)
- [styles.css](styles.css) — layout and panel styles
- [js/main.js](js/main.js) — entry point, sim loop, frame timing
- [js/sim.js](js/sim.js) — Sim class: world + ants + pheromones, tick
- [js/world.js](js/world.js) — World class: nest, food, obstacles, grid
- [js/ant.js](js/ant.js) — Ant data + per-tick behaviour (sense, move, deposit)
- [js/pheromone.js](js/pheromone.js) — PheromoneGrid: deposit, evaporate, sample
- [js/render.js](js/render.js) — Renderer: heatmap, obstacles, food, nest, ants
- [js/input.js](js/input.js) — mouse handling and placement tools
- [js/ui.js](js/ui.js) — control panel wiring, stats updates
- [js/storage.js](js/storage.js) — localStorage save/load (Phase 2 stub)
- [SPEC.md](SPEC.md) — stable design reference

## Recent decisions

- **Scout/worker split.** A single role with one `wander` parameter
  produced too much trail noise — every ant explored, the pheromone
  field never developed a clear gradient, and workers couldn't lock on.
  Splitting into ~20% scouts (high wander, weak pheromone bias) and
  ~80% workers (low wander, strong bias) makes the colony bootstrap
  with explorers and then exploit cleanly with the rest.
- **No ES modules.** Each JS file is an IIFE that attaches its exports to
  `window.AntSim`, loaded by plain `<script>` tags in dependency order.
  ES modules would have been cleaner, but Chrome blocks module imports
  from `file://`, which contradicts the brief's "open `index.html` and
  it Just Works" promise. The file boundaries are still meaningful — the
  namespace just substitutes for `import`/`export`.
- **Cell size 4 px** → 250×200 grid for the 1000×800 canvas. Two
  Float32Arrays = 400 KB total. Evaporation pass is ~50K multiplies, fine
  at 60 Hz.
- **`depositStrength` per ant** decays each tick and resets at food/nest.
  Without it, trails cannot optimise away from a long initial detour.
- **Ant mortality** rather than persistent pheromone emission from nest/
  food. We tried emitting pheromone halos around nest and food to bridge
  the dead zone, but it created sharp pheromone discontinuities and didn't
  match the brief's pure-stigmergy model. Mortality (lost ants die) is the
  cleaner answer: the colony self-prunes failed routes via attrition, and
  fresh ants follow whatever trails currently work.
- **Heatmap renders to an offscreen canvas at grid resolution**, then is
  `drawImage`'d scaled up. Direct pixel writes at canvas resolution would
  be ~5× the work.
- **Obstacles cached to an offscreen canvas**, redrawn only when something
  changes. Stops the per-frame O(cells) scan from being a bottleneck.
- **Camera transform plumbed through every draw**, even with zoom/pan
  disabled in Phase 1. Cheap to add now, expensive to retrofit.
