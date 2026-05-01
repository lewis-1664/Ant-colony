// Simulation state and tick logic: world + ants + pheromones, all owned together.

window.AntSim = window.AntSim || {};
(function (AntSim) {
  'use strict';

  const { World, PheromoneGrid, Ant, tickAnt } = AntSim;

  // Default tunables. Phase 2 will expose more of these via sliders.
  const DEFAULT_PARAMS = {
    speed: 1.0,           // px per tick
    sensorAngle: 0.5,     // ± rad off-axis for left/right sensors
    sensorDist: 12,       // px ahead for sensor sample
    depositRate: 0.5,     // pheromone deposited per tick (× ant.depositStrength)
    depositDecay: 0.9995, // per-ant strength decay per tick
    evaporation: 0.997,   // per-cell decay per tick (PheromoneGrid uses this)
    spawnInterval: 8,     // ticks between spawns when below maxAnts
    // Two-caste colony: scouts wander widely with weak pheromone bias to
    // explore and discover food; workers stay tight on existing trails to
    // exploit them. Scouts spawn first (up to scoutFraction × maxAnts), so
    // the colony bootstraps with explorers before exploiters flood in.
    // Without this split, every ant wanders randomly and the pheromone
    // field is dominated by noise — workers can't lock onto trails because
    // there's no clear gradient to lock onto.
    scoutFraction: 0.20,
    scoutWander: 0.32,        // rad per tick — large random heading noise
    scoutTurnStrength: 0.18,  // rad per tick toward strongest sensor (weak)
    workerWander: 0.08,       // rad per tick — small noise, stays on heading
    workerTurnStrength: 0.55, // rad per tick toward strongest sensor (strong)
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
      // Scouts spawn first up to quota, then workers. Counts are tracked
      // incrementally; decrements happen in tick() when an ant dies.
      const wantScouts = Math.floor(this.maxAnts * this.params.scoutFraction);
      const isScout = this._scoutCount < wantScouts;
      const a = new Ant(
        this.world.nest.x,
        this.world.nest.y,
        this._rng() * Math.PI * 2,
      );
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
        if (r === 'delivered') this.foodCollected++;
        if (r === 'died') {
          this.antsDied++;
          if (ant.role === 'scout') this._scoutCount--;
          continue;
        }
        ants[writeIdx++] = ant;
      }
      ants.length = writeIdx;

      this.pheromones.evaporate();
    }
  }

  AntSim.DEFAULT_PARAMS = DEFAULT_PARAMS;
  AntSim.Sim = Sim;
})(window.AntSim);
