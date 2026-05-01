// Ant data + per-tick behaviour: sense, move, deposit, state-transition, age.

window.AntSim = window.AntSim || {};
(function (AntSim) {
  'use strict';

  const CELL_SIZE = AntSim.CELL_SIZE;
  const TWO_PI = Math.PI * 2;

  class Ant {
    constructor(x, y, heading) {
      this.x = x;
      this.y = y;
      this.heading = heading;
      this.hasFood = false;
      // 'scout' = high wander + weak pheromone bias (explorer);
      // 'worker' = low wander + strong pheromone bias (exploiter).
      // Sim.spawnAnt assigns the role; this default is just a safety net.
      this.role = 'worker';
      // Decays each tick toward zero, resets to 1 when the ant touches food
      // or nest. Multiplied into deposit, so ants reaching their goal quickly
      // leave stronger trails than ants that wandered far. This is what makes
      // shortest-path emergent — without it, trails cannot optimise away from
      // a long initial scout path.
      this.depositStrength = 1.0;
      // Ticks of life remaining. Reset to full when the ant reaches the nest
      // or a food source. When it hits zero, the ant dies and is removed from
      // the colony, taking any food it was carrying with it. Sim.spawnAnt
      // assigns the configured lifespan; default 1 keeps an unspawned Ant
      // from accidentally outliving its tick.
      this.lifeRemaining = 1;
    }
  }

  // Sample the pheromone grid the ant should *follow* (opposite of what it deposits)
  // at a sensor point ahead-and-offset of the ant's heading.
  function sense(ant, pher, angleOffset, dist) {
    const a = ant.heading + angleOffset;
    const sx = ant.x + Math.cos(a) * dist;
    const sy = ant.y + Math.sin(a) * dist;
    const cx = Math.floor(sx / CELL_SIZE);
    const cy = Math.floor(sy / CELL_SIZE);
    return ant.hasFood ? pher.sampleHome(cx, cy) : pher.sampleFood(cx, cy);
  }

  // One-tick update for a single ant.
  // Returns 'delivered' on food drop-off, 'died' when lifespan expires, else undefined.
  function tickAnt(ant, world, pher, p, rng) {
    // Role-specific behaviour: scouts wander with weak pheromone bias,
    // workers stick close to existing trails.
    const isScout = ant.role === 'scout';
    const turnStrength = isScout ? p.scoutTurnStrength : p.workerTurnStrength;
    const wander       = isScout ? p.scoutWander       : p.workerWander;

    // 1. Three-sensor read. Strongest sample steers the turn; equal/none → wander only.
    const left  = sense(ant, pher, -p.sensorAngle, p.sensorDist);
    const fwd   = sense(ant, pher,  0,             p.sensorDist);
    const right = sense(ant, pher,  p.sensorAngle, p.sensorDist);

    if (fwd >= left && fwd >= right) {
      // already heading toward strongest — only wander
    } else if (left > right) {
      ant.heading -= turnStrength;
    } else if (right > left) {
      ant.heading += turnStrength;
    } else {
      ant.heading += (rng() < 0.5 ? -1 : 1) * turnStrength;
    }
    ant.heading += (rng() * 2 - 1) * wander;

    // 2. Try to move. If blocked, attempt up to 8 random deflections; if all
    //    fail, flip and skip move (rare — only happens when sealed in walls).
    const speed = p.speed;
    let nx = ant.x + Math.cos(ant.heading) * speed;
    let ny = ant.y + Math.sin(ant.heading) * speed;

    if (
      nx < 1 || ny < 1 ||
      nx >= world.width - 1 || ny >= world.height - 1 ||
      world.obstacleAtWorld(nx, ny)
    ) {
      let found = false;
      for (let i = 0; i < 8; i++) {
        const turn = (rng() * Math.PI) + Math.PI / 2;
        const sign = rng() < 0.5 ? -1 : 1;
        ant.heading += sign * turn;
        nx = ant.x + Math.cos(ant.heading) * speed;
        ny = ant.y + Math.sin(ant.heading) * speed;
        if (
          nx >= 1 && ny >= 1 &&
          nx < world.width - 1 && ny < world.height - 1 &&
          !world.obstacleAtWorld(nx, ny)
        ) { found = true; break; }
      }
      if (!found) {
        ant.heading += Math.PI;
        return;
      }
    }

    ant.x = nx;
    ant.y = ny;

    if (ant.heading < 0) ant.heading += TWO_PI;
    else if (ant.heading >= TWO_PI) ant.heading -= TWO_PI;

    // 3. Deposit on the *opposite* grid from the one we follow.
    ant.depositStrength *= p.depositDecay;
    if (ant.depositStrength < 0.01) ant.depositStrength = 0.01;
    const cx = Math.floor(ant.x / CELL_SIZE);
    const cy = Math.floor(ant.y / CELL_SIZE);
    const amount = p.depositRate * ant.depositStrength;
    if (ant.hasFood) pher.depositFood(cx, cy, amount);
    else             pher.depositHome(cx, cy, amount);

    // 4. State transitions and lifespan.
    // Reaching the nest or food refreshes the ant's life — each leg of the
    // round trip has its own budget. Carriers that can't find their way home
    // die; searchers that wander too long without finding food also die.
    // Either way, failed ants free their slot for a fresh spawn from the nest.
    let result;
    if (world.atNest(ant.x, ant.y)) {
      ant.lifeRemaining = p.lifespan;
      if (ant.hasFood) {
        ant.hasFood = false;
        ant.heading += Math.PI;
        ant.depositStrength = 1.0;
        result = 'delivered';
      }
    } else if (!ant.hasFood) {
      const f = world.foodAt(ant.x, ant.y);
      if (f) {
        f.amount -= 1;
        ant.hasFood = true;
        ant.heading += Math.PI;
        ant.depositStrength = 1.0;
        ant.lifeRemaining = p.lifespan;
      }
    }

    ant.lifeRemaining--;
    if (ant.lifeRemaining <= 0) return 'died';
    return result;
  }

  AntSim.Ant = Ant;
  AntSim.tickAnt = tickAnt;
})(window.AntSim);
