import { World } from './world.js';
import { PheromoneGrid } from './pheromone.js';
import { Ant, tickAnt } from './ant.js';

// Default tunables. Phase 2 will expose more of these via sliders.
export const DEFAULT_PARAMS = {
  speed: 1.0,           // px per tick
  turnStrength: 0.4,    // rad per tick toward chosen sensor
  wander: 0.18,         // ± rad per tick of random noise
  sensorAngle: 0.5,     // ± rad off-axis for left/right sensors
  sensorDist: 12,       // px ahead for sensor sample
  depositRate: 0.5,     // pheromone deposited per tick (× ant.depositStrength)
  depositDecay: 0.9995, // per-ant strength decay per tick
  evaporation: 0.997,   // per-cell decay per tick (PheromoneGrid uses this)
  spawnInterval: 8,     // ticks between spawns when below maxAnts
  // Lifespan: ticks an ant has before dying. Reset on visiting the nest or
  // a food source — each leg of the round trip has its own time budget.
  // This is the system's selection pressure: carriers that can't find their
  // way home die, searchers that wander too long without finding food die,
  // and the freed slots refill from fresh nest spawns. The colony self-prunes
  // failed routes without any global path-finding logic.
  lifespan: 4500,
};

export class Sim {
  constructor(width, height) {
    this.world = new World(width, height);
    this.pheromones = new PheromoneGrid(this.world.cols, this.world.rows);
    this.ants = [];
    this.params = { ...DEFAULT_PARAMS };
    this.maxAnts = 300;
    this.tickCount = 0;
    this.foodCollected = 0;
    this.antsDied = 0;
    this._spawnAccum = 0;
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
  }

  setMaxAnts(n) {
    this.maxAnts = n;
    if (this.ants.length > n) this.ants.length = n;
  }

  spawnAnt() {
    if (!this.world.nest || this.ants.length >= this.maxAnts) return;
    const a = new Ant(
      this.world.nest.x,
      this.world.nest.y,
      this._rng() * Math.PI * 2,
    );
    a.lifeRemaining = this.params.lifespan;
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
        continue;
      }
      ants[writeIdx++] = ant;
    }
    ants.length = writeIdx;

    this.pheromones.evaporate();
  }
}
