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

- **Worker searching** (no food) deposits **home** at full strength,
  follows **food**.
- **Any carrier** (carrying food) deposits **food** at full strength,
  follows **home**.
- **Scout searching** deposits **home at `scoutDepositMul` × full
  strength** (default 30%). Scouts ignore food pheromone while
  searching — see the scout caste section below for why.

Each ant carries a `depositStrength` that decays each tick toward zero and
resets to `1.0` when it touches a food source or the nest. Multiplying
deposit by this strength biases trails toward shorter routes — an ant that
finds food via a long detour leaves a fainter food trail than one that took
a direct path. Over many trips, evaporation prunes the long routes. This is
the load-bearing detail: without it, trails cannot optimise away from a long
initial scout path.

Evaporation is a global multiply (e.g. `0.997` per tick). Cell values are
clamped to a max to keep the heatmap colour range stable.

Each tick the grids are also **diffused** — every interior cell becomes a
weighted average of itself and its four neighbours (5-point stencil).
This models the physical diffusion of pheromone in air. It smooths
spikes from passing ants, lets the gradient reach further than per-ant
deposits alone could, and produces visibly tighter trails (deliveries
roughly double on the canonical test versus no diffusion).

## Two-caste colony (scouts and workers)

Every ant is one of two roles, fixed at spawn:

- **Scout** — long-sighted, wide-eyed, weakly-steered explorer. Sensor
  fan is `scoutSensorAngle` (~0.85 rad ≈ ±49°, vs workers' ±29°) at
  `scoutSensorDist` (~22 px, ~2× workers'), so scouts cover a much
  wider arc and pick up faint trails before walking past them.
  Their snap-to-food radius is also wider (`scoutSnapDist` ~60 px vs
  workers' 32) so they don't sail past a food source unnoticed.
  `scoutTurnStrength` (~0.18) is weaker so they keep exploring rather
  than locking onto a trail. Default `scoutWander` is small (~0.08
  rad/tick) so each scout walks near-ballistically and covers distance.
- **Worker** — short-sighted, strongly-steered exploiter. Small
  `wander`, strong pheromone bias. Sticks tight to existing trails.

`scoutFraction` of `maxAnts` are scouts; the rest are workers. Scouts
spawn first up to quota, so the colony bootstraps with explorers before
exploiters arrive. Without this split, every ant wanders randomly, the
pheromone field is dominated by noise, and workers can't lock onto
trails because there is no clear gradient to lock onto. With the split,
scouts paint a faint exploratory trail; once any of them finds food and
returns, workers latch onto the food trail and reinforce it sharply.

Both roles can become carriers — picking up food is a state change, not
a role change. A scout carrying food gets to use sensor steering again
to home in, but its low `wander` means it tracks fairly straight back
along its outbound path.

**Why fewer, louder scouts:** with too many scouts, their many radial
outbound paths overwhelm the home field with noise and the first
carrier to return gets confused by spurious gradient peaks. With too
few, discovery rate drops and bootstrap fails. The current default
(15% scouts, 80% deposit strength) is the sweet spot: a single scout's
outbound path is clear enough to retrace as a carrier, and there are
enough scouts that some reach distant food within their lifespan.

**Why scouts follow food pheromone too (weakly):** earlier we tried
scouts that ignored food pheromone entirely. That avoided chase-loops
on first discovery, but it also meant scouts couldn't navigate
established trails — important when a wall is placed mid-trail and
foragers can't find their way around it because they don't explore.
Scouts now use sensor steering with weak `turnStrength` so they pick
up established trails (and re-route around new obstacles) but mostly
keep wandering rather than locking on.

**Cost: bootstrap variance.** Scouts still find food by approximate
random walk during bootstrap, and the first scout carrier has to
retrace its own faint outbound trail. Most runs succeed (single source
canonical: ~2 of 3 runs deliver 1000+ in 12k ticks, with very low
death counts when they do); some bootstrap fails. Hit Reset and try
again.

## Recruitment (workers wait for scouts)

Workers don't spawn until a scout has actually returned to the nest with
food. While the colony is still searching, only scouts spawn — up to
`scoutFraction × maxAnts`. The first successful delivery flips a
`foodFound` flag and stamps an `outgoingHeading` taken from the
delivering ant's post-flip heading (the direction it just came from,
i.e. roughly toward food).

After that, every worker spawn uses `outgoingHeading` plus a small
jitter, so workers march out toward the active trail instead of
wandering in random directions hoping to find it. This produces the
signature "column marching out" look once a trail is established and
sharply reduces early-colony noise: in the canonical test, deaths drop
roughly 50% over 12k ticks compared with workers-spawn-immediately,
because workers only enter the world once there's something for them
to follow.

A scout returning empty-handed refreshes its own life but doesn't flip
`foodFound` — only deliveries count.

Recent delivery headings are kept in a small ring buffer
(`recruitMemory`, 8 entries). Each worker spawn picks one heading
uniformly at random.

When a delivery comes in, the heading is checked against the buffer.
If it differs from every existing entry by more than
`recruitNewDirThreshold` (~0.8 rad, ~46°) it's flagged as a "new
direction" and replaces one entry from the *most-represented cluster*
in the buffer.

Trimming when the buffer overflows also removes from the most-
represented cluster (rather than FIFO). Without this, a rare 3rd-
source delivery that took a slot would be pushed off the buffer in
~8 high-rate deliveries from the dominant clusters before the next
3rd-source delivery could arrive — minority directions never built
representation. Trimming from the dominant cluster instead lets
minority clusters survive as long as they keep delivering, even at
much lower rates than the dominant ones. With this rule a new
direction starts at 2/8 = 25% representation immediately, and 3+
food sources can each hold their slots in the buffer.

With this rule, multiple food sources can both be exploited as long as
both produce deliveries. Bootstrapping a *second* source (when scouts
have to discover it past an existing trail) is still variance-prone,
but once discovered both trails get worker traffic.

**Worker re-launching at the nest.** When a worker delivers, it doesn't
just bump off the nest rim and head back the same way it came. Instead
it's snapped to the nest centre and given a fresh heading sampled from
the recruitment buffer (with the usual jitter) — the same as a brand-
new spawn. Visually this looks like the ant going *into* the nest and
then heading back out; mechanically it means returning foragers rotate
through whatever food trails are currently being reinforced. With two
active sources whose headings are both in the buffer, a worker just
back from source A has a roughly 50/50 chance of being sent to source
B next trip. Without this, every worker sticks to the source it first
walked to, and a colony with two active trails never rebalances.

Scouts keep their post-flip heading on delivery — they're explorers,
not foragers, so going back toward the source they discovered (and
maybe wandering off it on the way) is the right behaviour for them.

**Recruitment timeout.** A `_ticksSinceDelivery` counter resets to 0
on each delivery and increments otherwise. If it crosses
`recruitmentTimeout` (default 1200), the food channel is declared dead:
`foodFound` flips back to false and the heading buffer is cleared.
Worker spawning halts until a scout re-discovers food. Without this,
workers kept spawning into evaporated trails when carriers were unable
to deliver (e.g. food source removed, or a wall placed across the
trail) and died uselessly.

**Known limitation: winner-take-all on multi-source.** Once one trail
forms, the first scout to discover the second source still has to do
so by random walk (scouts ignore food pheromone). Discovery does
happen but is slow — colonies often specialise on one source. Real
ants behave the same way.

## U-turn on weakening trail

Workers track the pheromone reading at each cell they visit. When a
worker arrives in a new cell whose reading is sharply lower than the
previous cell's (`fadeUTurnRatio`, e.g. 40% drop on a trail above
`fadeUTurnThreshold`), it flips heading 180° — the trail is fading and
continuing forward likely leads to a dead end. Real ants do this when
food depletes; in our sim it shows up as fewer workers wasting their
lives drifting off-trail.

Scouts skip the rule. They must be free to traverse low-pheromone
regions while exploring.

## Scout trail-end behaviour

Scouts on a trail use the same sensor steering as workers, but with a
crucial exception: when the **forward** sensor reads below
`scoutTrailEndThreshold` (≈0.5), the side gradient is ignored and the
scout pushes forward on wander only. Without this, a scout reaching a
trail's end (e.g. because a new wall blocks it) gets pulled back along
the strong gradient behind them — they never explore past the dead end
to find a route around. With it, scouts walk *into* the dead end, hit
the wall, and let wall-vision and the smarter collision response slide
them along the wall edge until they find a way around.

Combined with workers' fade-U-turn rule, the colony partitions roles
neatly: workers stay on healthy trails or abandon failing ones,
scouts press past trail ends and discover re-routes.

## Snap-to-destination

When an ant is within `snapDist` (~32 px) of its current target — nest
for carriers, food for searchers — pheromone-based steering is bypassed
and heading is set directly at the target. Wander still applies, scaled
down so the ant doesn't oscillate.

This stops the "drift past destination" failure mode: an ant on a tight
gradient often missed the trigger radius by a few pixels, deposited
pheromone past the target, and the deposit became a phantom trail
extension that other ants then reinforced. With snap, ants reliably
enter the target's trigger radius even when their heading was sweeping
slightly off-axis.

It is a small departure from pure stigmergy near targets, but it matches
biology — real ants visually orient to nest entrances at close range.
The benefit is large: in the canonical test (nest at 250x400, food at
800x400) deliveries went from ~150 to ~600 over 12k ticks, with mortality
roughly halved.

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

## Wall-avoidance vision and corner sliding

Each tick, before attempting a move, ants probe a short forward arc
(`wallSenseDist`, default 8 px; `wallSenseAngle`, default ±0.45 rad)
for walls or canvas boundaries. If the forward sample is blocked but a
side sample is open, heading is nudged toward the open side
(`wallAvoidTurn` ≈ 0.5 rad). This is the "vision" component — ants see
walls slightly ahead and steer.

Scouts use a longer-range, wider-arc version (`scoutWallSenseDist`
≈ 20 px ≈ 2.5× workers, `scoutWallSenseAngle` ≈ ±0.75 rad). They're
the long-sighted exploration caste, so they need to see walls earlier
to turn smoothly during exploration rather than bumping off them and
losing ticks to collision recovery. Workers stay on established trails
and don't need the same look-ahead.

Despite vision, collisions still happen at sharp corners. The collision
fallback now tries a sequence of small deflections (±π/6, ±π/4, ±π/3,
±π/2, ±2π/3) before giving up and flipping 180°. Small turns succeed
first, so the ant slides along the wall edge instead of bouncing
randomly in the corner pocket. This eliminated the "ants pile up at
the inside of a wall corner" bug.

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
