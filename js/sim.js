// Simulation state and tick logic: world + ants + pheromones, all owned together.

window.AntSim = window.AntSim || {};
(function (AntSim) {
  'use strict';

  const { World, PheromoneGrid, Ant, tickAnt } = AntSim;

  // Smallest unsigned angular distance between two headings (radians).
  function angularDist(a, b) {
    let d = Math.abs(a - b) % (Math.PI * 2);
    if (d > Math.PI) d = Math.PI * 2 - d;
    return d;
  }

  // Index of an entry in the most-represented cluster. Each entry's "cluster"
  // is the set of buffer entries within `threshold` of it; we return the
  // first entry whose cluster has the highest count. Used both to pick the
  // entry to replace on a new-direction arrival, and to pick the entry to
  // trim when the buffer overflows.
  function mostCommonClusterIdx(buf, threshold) {
    let bestCount = -1;
    let bestIdx = 0;
    for (let i = 0; i < buf.length; i++) {
      let count = 0;
      for (let j = 0; j < buf.length; j++) {
        if (angularDist(buf[i], buf[j]) <= threshold) count++;
      }
      if (count > bestCount) { bestCount = count; bestIdx = i; }
    }
    return bestIdx;
  }

  // Default tunables. Phase 2 will expose more of these via sliders.
  const DEFAULT_PARAMS = {
    speed: 1.0,           // px per tick
    sensorAngle: 0.5,     // ± rad off-axis for left/right sensors
    sensorDist: 12,       // px ahead for sensor sample
    depositRate: 0.5,     // pheromone deposited per tick (× ant.depositStrength)
    depositDecay: 0.9995, // per-ant strength decay per tick
    evaporation: 0.997,   // per-cell decay per tick (PheromoneGrid uses this)
    diffusionRate: 0.06,  // per-tick blur applied to both pheromone grids;
                          // models physical diffusion in air, smooths
                          // spikes and extends gradient reach
    spawnInterval: 8,     // ticks between spawns when below maxAnts
    // Two-caste colony: scouts wander widely with weak pheromone bias to
    // explore and discover food; workers stay tight on existing trails to
    // exploit them. Scouts spawn first (up to scoutFraction × maxAnts), so
    // the colony bootstraps with explorers before exploiters flood in.
    // Without this split, every ant wanders randomly and the pheromone
    // field is dominated by noise — workers can't lock onto trails because
    // there's no clear gradient to lock onto.
    // Scout caste: a small number of long-sighted explorers. Scouts now
    // follow food pheromone (so they can pick up established trails and
    // navigate around new obstacles when foragers can't), but with weak
    // turnStrength so they keep exploring rather than locking onto a
    // single trail. Their sensor reach is longer than workers' so they
    // detect food and trails from further away. Fewer of them than
    // before (15% vs 30%) so the home field doesn't become a starburst,
    // and their deposits are stronger so the few they make are clear.
    scoutFraction: 0.15,
    scoutWander: 0.08,        // rad per tick — small noise, near-ballistic.
                              // With only 15% scouts, each one needs to
                              // cover real distance during bootstrap, so
                              // their walks must stay roughly straight.
    scoutTurnStrength: 0.18,  // rad per tick toward strongest sensor (weak,
                              // for both searching and carrying)
    scoutSensorDist: 22,      // px ahead — longer than workers' so scouts
                              // detect food and trails from greater distance
    scoutDepositMul: 0.8,     // scouts deposit at 80% strength. With fewer
                              // scouts the field is no longer a starburst,
                              // so their deposits can be louder — this
                              // makes the trail laid by the first carrier
                              // clear enough to retrace.
    scoutSensorAngle: 0.85,   // ± rad off-axis for left/right sensors
                              // (wider fan than workers — scouts cover a
                              // wider arc so they're less likely to walk
                              // past a faint trail without noticing it)
    scoutSnapDist: 60,        // px — wider snap-to-food radius for scouts.
                              // Workers only snap within 32 px, but scouts
                              // are scanning for food and need to "see" it
                              // from further so they don't walk straight
                              // past sources during exploration.
    scoutTrailEndThreshold: 0.5,  // pheromone level — when a searching
                                  // scout's *forward* sensor reads below
                                  // this, the trail is ending or blocked.
                                  // Scouts ignore the side gradient and
                                  // push forward instead of being pulled
                                  // back along the established trail —
                                  // they explore past the dead end so they
                                  // can route around new walls.
    workerWander: 0.08,       // rad per tick — small noise, stays on heading
    workerTurnStrength: 0.55, // rad per tick toward strongest sensor (strong)
    // Snap-to-destination: when an ant is within snapDist of its current
    // target (nest for carriers, food for searchers), heading is steered
    // directly at the target instead of via the pheromone gradient. Without
    // this, ants on a tight gradient often drift past the destination by a
    // few pixels, deposit pheromone past it, and create a phantom trail
    // extension that other ants then reinforce.
    snapDist: 32,
    // Recruitment: workers don't spawn until a scout returns to the nest
    // with food. When that happens, the colony "knows" food exists and in
    // roughly which direction. Subsequent worker spawns leave heading along
    // that direction (with a small jitter), so they head straight onto the
    // existing trail instead of wandering to find it. Without this, workers
    // pile into the colony immediately, wander aimlessly because there's no
    // trail yet to follow, and add noise that scouts have to overcome.
    workerSpawnSpread: 0.5,   // ± rad jitter on worker outgoing heading
    recruitMemory: 8,         // ring-buffer size of recent delivery headings.
                              // With multiple food sources, workers spawn
                              // along a randomly-chosen recent heading, so
                              // both trails get reinforced.
    recruitNewDirThreshold: 0.8,  // rad — a delivery whose heading is more
                                  // than this far from every existing entry
                                  // is treated as a "new direction" and
                                  // overwrites half the buffer with itself,
                                  // so it gets immediate worker
                                  // representation instead of being
                                  // outvoted by an established trail.
    // Recruitment timeout: if no delivery happens in this many ticks the
    // food channel is declared dead. foodFound flips back to false and
    // worker spawning halts until a scout re-discovers food. Without this
    // workers keep spawning into a evaporated trail and die uselessly.
    recruitmentTimeout: 1200,
    // Wall-avoidance "vision": ants probe their forward arc each tick and
    // steer away from walls before they collide. Three sample points (left
    // / forward / right) at wallSenseDist; if forward is blocked, turn
    // toward whichever side is open. Without this ants run into wall
    // corners and rely on the random-deflection reflection logic, which
    // gets them stuck looping in tight pockets.
    //
    // Scouts get a longer-range and wider-arc version because they're the
    // long-sighted exploration caste — without it they bump off walls a
    // lot during exploration, wasting ticks on collision recovery.
    wallSenseDist: 8,         // px ahead — slightly more than one cell
    wallSenseAngle: 0.45,     // ± rad off-axis for left/right wall sensors
    wallAvoidTurn: 0.5,       // rad per tick steering away from a sensed wall
    scoutWallSenseDist: 20,   // ~2.5× workers' range
    scoutWallSenseAngle: 0.75,// wider arc — catches walls slightly to the side
    // U-turn: workers on a fading trail flip 180° so they don't march into
    // oblivion. Triggered when the pheromone reading at the ant's current
    // cell is sharply lower than at its previous cell (a real-ant
    // behaviour). Scouts skip this — they must be free to traverse low-
    // pheromone regions while exploring.
    fadeUTurnThreshold: 1.0,  // only U-turn if recent reading was at least this
    fadeUTurnRatio: 0.4,      // U-turn if current reading dropped this fraction
    // Lifespan: ticks an ant has before dying. Reset on visiting the nest or
    // a food source — each leg of the round trip has its own time budget.
    // This is the system's selection pressure: carriers that can't find their
    // way home die, searchers that wander too long without finding food die,
    // and the freed slots refill from fresh nest spawns. The colony self-prunes
    // failed routes without any global path-finding logic.
    lifespan: 4500,
  };

  class Sim {
    constructor(width, height) {
      this.world = new World(width, height);
      this.pheromones = new PheromoneGrid(this.world.cols, this.world.rows);
      this.ants = [];
      this.params = Object.assign({}, DEFAULT_PARAMS);
      this.maxAnts = 300;
      this.tickCount = 0;
      this.foodCollected = 0;
      this.antsDied = 0;
      // Recruitment state: workers spawn only after `foodFound` flips true
      // (set on the first successful delivery). `_recentHeadings` is a
      // ring buffer of headings captured from recent deliveries; worker
      // spawns pick one uniformly so multiple food sources each get
      // workers heading toward them. `_ticksSinceDelivery` is reset to 0
      // on each delivery and counts up otherwise — when it crosses
      // `recruitmentTimeout`, the channel is declared dead.
      this.foodFound = false;
      this._recentHeadings = [];
      this._ticksSinceDelivery = 0;
      this._spawnAccum = 0;
      this._scoutCount = 0;
      this._rng = Math.random;
    }

    reset() {
      this.world.reset();
      this.pheromones.clear();
      this.ants.length = 0;
      this.tickCount = 0;
      this.foodCollected = 0;
      this.antsDied = 0;
      this.foodFound = false;
      this._recentHeadings.length = 0;
      this._ticksSinceDelivery = 0;
      this._spawnAccum = 0;
      this._scoutCount = 0;
    }

    setMaxAnts(n) {
      this.maxAnts = n;
      if (this.ants.length > n) {
        this.ants.length = n;
        // Recount scouts after truncation so spawn quotas stay correct.
        let s = 0;
        for (const a of this.ants) if (a.role === 'scout') s++;
        this._scoutCount = s;
      }
    }

    spawnAnt() {
      if (!this.world.nest || this.ants.length >= this.maxAnts) return;
      const wantScouts = Math.floor(this.maxAnts * this.params.scoutFraction);
      const isScout = this._scoutCount < wantScouts;
      // Recruitment gate: workers don't spawn until a scout has actually
      // returned with food. Until then we keep filling the scout slot.
      if (!isScout && !this.foodFound) return;

      let heading;
      if (isScout) {
        heading = this._rng() * Math.PI * 2;
      } else {
        // Workers march out along a randomly-chosen recent delivery
        // heading. With one food source the buffer fills with headings
        // pointing roughly the same way; with two or more sources, each
        // bearing gets sampled in proportion to how often it produces
        // deliveries, so multiple trails are reinforced.
        const spread = this.params.workerSpawnSpread;
        const buf = this._recentHeadings;
        const base = buf[Math.floor(this._rng() * buf.length)];
        heading = base + (this._rng() - 0.5) * 2 * spread;
      }

      const a = new Ant(this.world.nest.x, this.world.nest.y, heading);
      a.role = isScout ? 'scout' : 'worker';
      a.lifeRemaining = this.params.lifespan;
      if (isScout) this._scoutCount++;
      this.ants.push(a);
    }

    tick() {
      this.tickCount++;
      this.pheromones.evaporation = this.params.evaporation;

      if (this.world.nest) {
        this._spawnAccum++;
        if (this._spawnAccum >= this.params.spawnInterval) {
          this._spawnAccum = 0;
          this.spawnAnt();
        }
      }

      const ants = this.ants;
      let writeIdx = 0;
      // Single pass: tick each ant, count deliveries, compact survivors.
      // In-place compaction avoids a separate filter allocation per tick.
      for (let i = 0; i < ants.length; i++) {
        const ant = ants[i];
        const r = tickAnt(ant, this.world, this.pheromones, this.params, this._rng);
        if (r === 'delivered') {
          this.foodCollected++;
          // Capture recruitment state. ant.heading after a successful drop
          // has been flipped 180°, so it now points outward — the direction
          // the ant originally came from, which is roughly toward food.
          this.foodFound = true;
          this._ticksSinceDelivery = 0;
          const buf = this._recentHeadings;
          // If this delivery's heading is far from every existing entry,
          // treat it as a "new direction" (i.e. a different food source or
          // a re-routed trail) and overwrite half the buffer with it. This
          // gives the new direction immediate worker representation
          // instead of letting the established trail outvote it 7-to-1.
          const threshold = this.params.recruitNewDirThreshold;
          let isNewDir = buf.length > 0;
          for (let k = 0; k < buf.length; k++) {
            if (angularDist(buf[k], ant.heading) <= threshold) {
              isNewDir = false;
              break;
            }
          }
          if (isNewDir) {
            // Replace one entry from the *most-represented* cluster
            // currently in the buffer. Earlier we replaced half the
            // buffer, but that wiped out a third established direction
            // when a new one arrived. Now a new direction takes a single
            // slot from whichever cluster has the most entries.
            buf[mostCommonClusterIdx(buf, threshold)] = ant.heading;
          }
          buf.push(ant.heading);
          // When trimming, remove from the most-represented cluster too,
          // not by FIFO. With FIFO, a rare 3rd-source delivery would be
          // pushed off the buffer within ~8 high-rate deliveries from
          // dominant clusters, so the new direction never builds
          // representation. Removing from the dominant cluster instead
          // lets minority clusters survive — 3+ food sources can each
          // hold their slot in the buffer as long as they keep delivering.
          if (buf.length > this.params.recruitMemory) {
            const idx = mostCommonClusterIdx(buf, threshold);
            buf.splice(idx, 1);
          }

          // Returning foragers go *into* the nest and are re-launched
          // along a freshly-sampled recruited heading — same behaviour
          // as a fresh spawn from the nest. Without this, a worker's
          // post-flip heading sends it straight back to the same food
          // source it just came from, so a colony with two active
          // trails never rebalances. With it, every delivery cycle is
          // a fresh chance to be sent to whichever source is currently
          // dominating recruitment. Scouts keep their post-flip heading
          // (they go back to wherever they discovered food).
          if (ant.role === 'worker' && buf.length > 0) {
            // Snap to nest centre for the "ant goes into the nest"
            // visual instead of bumping off the rim.
            ant.x = this.world.nest.x;
            ant.y = this.world.nest.y;
            const base = buf[Math.floor(this._rng() * buf.length)];
            const spread = this.params.workerSpawnSpread;
            ant.heading = base + (this._rng() - 0.5) * 2 * spread;
          }
        }
        if (r === 'died') {
          this.antsDied++;
          if (ant.role === 'scout') this._scoutCount--;
          continue;
        }
        ants[writeIdx++] = ant;
      }
      ants.length = writeIdx;

      this.pheromones.evaporate();
      this.pheromones.diffuse(this.params.diffusionRate);

      // Recruitment timeout: if it's been too long since the last delivery,
      // the food channel is dead — clear the recruitment state so workers
      // stop spawning until scouts re-discover food. Without this we keep
      // sending workers into an evaporated trail.
      if (this.foodFound) {
        this._ticksSinceDelivery++;
        if (this._ticksSinceDelivery > this.params.recruitmentTimeout) {
          this.foodFound = false;
          this._recentHeadings.length = 0;
          this._ticksSinceDelivery = 0;
        }
      }
    }
  }

  AntSim.DEFAULT_PARAMS = DEFAULT_PARAMS;
  AntSim.Sim = Sim;
})(window.AntSim);
