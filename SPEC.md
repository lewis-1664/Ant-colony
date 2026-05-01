# Ant Colony Simulation — Spec

The stable design reference. Update only when design decisions change.
Day-to-day project state lives in [README.md](README.md).

## Project overview

A browser-based ant colony sandbox. The user places a nest, food sources, and
obstacles on a canvas, and watches ants discover food and form pheromone
trails between food and nest. Sandbox toy first; optional game-like
challenges layer in later.

The defining mechanic is **stigmergy via pheromone trails**: ants deposit
"home" pheromone while wandering and "food" pheromone while carrying food
back. Other ants probabilistically follow these trails. Pheromones evaporate
over time. Shortest-path behaviour emerges without any ant having global
knowledge.

## Tech stack

- Vanilla JS, HTML, CSS. No frameworks, no build step, no npm dependencies.
- Single `<canvas>` element for rendering.
- `localStorage` for save/load.
- Plain `<script>` tags loaded in dependency order; each file attaches its
  exports to `window.AntSim`. We *don't* use ES modules — Chrome blocks
  module imports from `file://` URLs, which would break the brief's "open
  index.html and it Just Works" promise.
- Everything runs client-side; opening `index.html` directly Just Works
  in every browser.

## Architecture decisions (load-bearing — change with care)

1. **Pheromones as 2D grids, not particles.** Two `Float32Array`s sized to
   the world grid. Deposit = add to a cell; evaporation = single multiply
   pass per tick. This is the only way to scale to thousands of ants.

2. **Decouple sim tick from render frame.** Simulation runs at a fixed
   logical timestep (60 Hz target). Render via `requestAnimationFrame`.
   The speed slider changes how many sim ticks run per render frame
   (0.25×–8×). Pause stops sim ticks but keeps rendering.

3. **Ant sensing via three sample points.** Each ant samples the relevant
   pheromone grid at three points (front-left, front, front-right). The ant
   biases its turn toward the strongest reading. Wander randomness keeps
   ants from getting stuck in local maxima.

4. **Layered draw order:** pheromone heatmap (via offscreen canvas at grid
   resolution, scaled up) → obstacles (cached offscreen, redrawn on change)
   → food → nest → ants.

5. **World vs screen coordinates.** All draws go through a camera transform
   (`translate` then `scale`), even though Phase 1 leaves zoom/pan disabled.
   Retrofitting this is a pain — keep it plumbed through.

6. **File boundaries (one IIFE per file, all hang off `window.AntSim`):**
   - `main.js` — entry point, owns the loop
   - `sim.js` — sim state and tick logic
   - `ant.js` — ant behaviour
   - `pheromone.js` — grid management (deposit, evaporate, sample)
   - `world.js` — nest, food, obstacles, coordinate helpers
   - `render.js` — all drawing
   - `input.js` — mouse/keyboard handling, placement tools
   - `ui.js` — control panel, sliders, stats
   - `storage.js` — save/load (Phase 2)
   - Load order in `index.html` follows the dependency graph — leaves
     (pheromone, world) before consumers (ant, sim, render) before main.

## Pheromone model

Two grids: `home` and `food`. Cell size **4 px** (1000×800 canvas → 250×200
grid).

- **Searching ant** (no food) deposits **home**, follows **food**.
- **Returning ant** (carrying food) deposits **food**, follows **home**.

Each ant carries a `depositStrength` that decays each tick toward zero and
resets to `1.0` when it touches a food source or the nest. Multiplying
deposit by this strength biases trails toward shorter routes — an ant that
finds food via a long detour leaves a fainter food trail than one that took
a direct path. Over many trips, evaporation prunes the long routes. This is
the load-bearing detail: without it, trails cannot optimise away from a long
initial scout path.

Evaporation is a global multiply (e.g. `0.997` per tick). Cell values are
clamped to a max to keep the heatmap colour range stable.

## Two-caste colony (scouts and workers)

Every ant is one of two roles, fixed at spawn:

- **Scout** — large `wander`, weak pheromone-following bias. Explores
  widely; cheap to "waste" since the colony has spare ones.
- **Worker** — small `wander`, strong pheromone-following bias. Sticks
  tight to existing trails and exploits them.

`scoutFraction` of `maxAnts` are scouts; the rest are workers. Scouts
spawn first up to quota, so the colony bootstraps with explorers before
exploiters arrive. Without this split, every ant wanders randomly, the
pheromone field is dominated by noise, and workers can't lock onto
trails because there is no clear gradient to lock onto. With the split,
scouts paint a faint exploratory trail; once any of them finds food and
returns, workers latch onto the food trail and reinforce it sharply.

Both roles can become carriers — picking up food is a state change, not
a role change. A scout carrying food still has high `wander`; many die
before delivering, but their food deposits help bootstrap the trail for
the workers behind them.

## Mortality (ant lifespan)

Each ant has a `lifeRemaining` counter (default `lifespan = 3000` ticks).
It decreases every tick and resets when the ant visits the nest or a food
source. When it hits zero, the ant dies — the colony loses any food it was
carrying, and its slot frees for a fresh spawn from the nest.

This is the system's selection pressure. Without it, every simulation
collapses into the same failure mode: a few scouts find food, become
carriers, but can't navigate back through evaporating home trails; over
time **all** ants are stuck carrying food, no one is laying home pheromone
to maintain the trail, and the colony deadlocks. With mortality, failed
ants are pruned and replaced by fresh searchers that can follow whatever
trails currently exist — the colony self-prunes routes that don't work.

The two-leg reset (nest *or* food) gives each leg of the round trip its own
budget rather than forcing one journey to fit in `lifespan` ticks. This
makes bootstrapping more reliable: the very first scout has `lifespan`
ticks to find food, and once they pick up they get a fresh budget to find
home.

## Phased plan

### Phase 1 — MVP sandbox

Goal: ants find food, form trails, return food to nest.

- Fixed 1000×800 canvas
- Click-to-place tools: nest (one only), food, obstacle, eraser
- Ants spawn from the nest at a paced interval up to a max
- Two pheromone grids with evaporation; deposit-strength decay
- Wander, follow trails, pick up food, return to nest, drop, repeat
- Obstacles block ants
- **Mortality:** lost ants die after `lifespan` ticks without visiting the
  nest or food, freeing slots for fresh spawns
- Controls: play/pause, speed slider (0.25×–8×), max-ant slider, reset
- Stats: food collected, active ants, ants died, ticks elapsed
- "Show pheromones" toggle (blue home, red food)

**Done when:** placing a nest and food causes a visible trail to form
within ~30 seconds, and the trail shifts when the food moves.

### Phase 2 — Parameter play and persistence

- Sliders: evaporation, deposit strength, ant speed, wander, sensor angle,
  sensor distance
- Multiple food sources with finite quantities (visual depletion, removal)
- Save/load named layouts via `localStorage`
- Expanded stats: average trip time, trail efficiency, food/min
- Zoom and pan (mouse wheel + drag)
- Optional: larger world (e.g. 2000×2000)

### Phase 3 — Game-like layer (optional, opt-in)

- Scenario mode (timed challenges, maze layouts)
- Nest growth: spawns more ants as food accumulates; visible size
- Ant roles: workers, scouts (longer sensors, weaker following), soldiers
- Predators that wander and eat lone ants
- Day/night cycle
- Stretch: rival colony

## Performance targets

- 60 fps with ~500 ants in Phase 1.
- Profile before optimising. Hot paths: pheromone evaporation pass, ant
  tick loop, heatmap rendering.
