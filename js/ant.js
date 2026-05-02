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
      // Last pheromone reading and the cell index it came from. Used by the
      // worker U-turn rule to detect a sharply fading trail.
      this.lastSample = 0;
      this.lastSampleCell = -1;
      // Ticks of life remaining. Reset to full when the ant reaches the nest
      // or a food source. When it hits zero, the ant dies and is removed from
      // the colony, taking any food it was carrying with it. Sim.spawnAnt
      // assigns the configured lifespan; default 1 keeps an unspawned Ant
      // from accidentally outliving its tick.
      this.lifeRemaining = 1;
    }
  }

  // True if a step to (nx, ny) would land outside the canvas or in a wall.
  function canStep(world, nx, ny) {
    return (
      nx >= 1 && ny >= 1 &&
      nx < world.width - 1 && ny < world.height - 1 &&
      !world.obstacleAtWorld(nx, ny)
    );
  }

  // True if the cell at (x + cos*d, y + sin*d) for the given heading is a
  // wall or out of bounds — used by wall-avoidance vision.
  function wallAhead(world, x, y, heading, dist) {
    const tx = x + Math.cos(heading) * dist;
    const ty = y + Math.sin(heading) * dist;
    return (
      tx < 1 || ty < 1 ||
      tx >= world.width - 1 || ty >= world.height - 1 ||
      world.obstacleAtWorld(tx, ty)
    );
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

  // Returns true if the ant is within snapDist of a relevant target and the
  // heading has been overridden to aim straight at it. Carriers snap to the
  // nest; searchers snap to the nearest food source. Stops the "drift past
  // destination → phantom trail" failure mode where ants on a tight
  // gradient miss the trigger radius and lay deposits past the target.
  function snapToDestination(ant, world, snapDist) {
    const r2 = snapDist * snapDist;
    if (ant.hasFood) {
      if (!world.nest) return false;
      const dx = world.nest.x - ant.x, dy = world.nest.y - ant.y;
      if (dx * dx + dy * dy < r2) {
        ant.heading = Math.atan2(dy, dx);
        return true;
      }
    } else {
      for (const f of world.foodSources) {
        if (f.amount <= 0) continue;
        const dx = f.x - ant.x, dy = f.y - ant.y;
        if (dx * dx + dy * dy < r2) {
          ant.heading = Math.atan2(dy, dx);
          return true;
        }
      }
    }
    return false;
  }

  // One-tick update for a single ant.
  // Returns 'delivered' on food drop-off, 'died' when lifespan expires, else undefined.
  function tickAnt(ant, world, pher, p, rng) {
    // Role-specific behaviour: scouts wander with weak pheromone bias,
    // workers stick close to existing trails.
    const isScout = ant.role === 'scout';
    const turnStrength = isScout ? p.scoutTurnStrength : p.workerTurnStrength;
    const wander       = isScout ? p.scoutWander       : p.workerWander;

    // 0. U-turn rule (workers only). When a worker arrives in a new cell
    //    whose pheromone reading is sharply lower than the previous cell's,
    //    flip 180° — the trail is fading and continuing forward likely
    //    leads to a dead end. Scouts skip this so they can traverse low-
    //    pheromone regions while exploring. The check is gated on a
    //    threshold so freshly-spawned ants in empty regions don't twitch.
    if (!isScout) {
      const cx0 = Math.floor(ant.x / CELL_SIZE);
      const cy0 = Math.floor(ant.y / CELL_SIZE);
      const cellIdx = cy0 * pher.cols + cx0;
      if (cellIdx !== ant.lastSampleCell) {
        const here = ant.hasFood ? pher.sampleHome(cx0, cy0) : pher.sampleFood(cx0, cy0);
        if (
          ant.lastSampleCell >= 0 &&
          ant.lastSample > p.fadeUTurnThreshold &&
          here < ant.lastSample * (1 - p.fadeUTurnRatio)
        ) {
          ant.heading += Math.PI;
        }
        ant.lastSample = here;
        ant.lastSampleCell = cellIdx;
      }
    }

    // 1. Snap-to-destination overrides pheromone steering when very close
    //    to the relevant target. Otherwise, three-sensor read with role-
    //    specific sensor distance, angle, and turn strength. Scouts have
    //    a longer reach (sensorDist), wider fan (sensorAngle), and wider
    //    snap radius — they're the long-sighted explorers — but weaker
    //    turnStrength so they keep exploring rather than locking onto a
    //    trail. Both roles follow pheromone, which is how scouts pick up
    //    established trails to re-route around new obstacles.
    const snapDist = isScout ? p.scoutSnapDist : p.snapDist;
    const sensorAngle = isScout ? p.scoutSensorAngle : p.sensorAngle;
    const sensorDist = isScout ? p.scoutSensorDist : p.sensorDist;
    if (snapToDestination(ant, world, snapDist)) {
      ant.heading += (rng() * 2 - 1) * wander * 0.25;
    } else {
      const left  = sense(ant, pher, -sensorAngle, sensorDist);
      const fwd   = sense(ant, pher,  0,           sensorDist);
      const right = sense(ant, pher,  sensorAngle, sensorDist);

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
    }

    // 2a. Wall-avoidance vision. Probe the forward arc and steer away from
    //     walls *before* colliding. Ants without this rule run into
    //     corners and burn ticks bouncing off random reflections; with it
    //     they slide smoothly along walls.
    {
      const wd = p.wallSenseDist;
      const wa = p.wallSenseAngle;
      const fa = ant.heading;
      const fAhead = wallAhead(world, ant.x, ant.y, fa, wd);
      if (fAhead) {
        const lAhead = wallAhead(world, ant.x, ant.y, fa - wa, wd);
        const rAhead = wallAhead(world, ant.x, ant.y, fa + wa, wd);
        if (!lAhead && rAhead)        ant.heading -= p.wallAvoidTurn;
        else if (lAhead && !rAhead)   ant.heading += p.wallAvoidTurn;
        else if (!lAhead && !rAhead)  ant.heading += (rng() < 0.5 ? -1 : 1) * p.wallAvoidTurn;
        // else flanked — fall through to collision logic below.
      }
    }

    // 2b. Try to move. If blocked, try gentle deflections first (slide
    //     along the wall) before resorting to large random turns. This
    //     keeps ants from getting stuck oscillating at convex corners.
    const speed = p.speed;
    let nx = ant.x + Math.cos(ant.heading) * speed;
    let ny = ant.y + Math.sin(ant.heading) * speed;

    if (!canStep(world, nx, ny)) {
      const deflections = [
        Math.PI / 6, -Math.PI / 6,
        Math.PI / 4, -Math.PI / 4,
        Math.PI / 3, -Math.PI / 3,
        Math.PI / 2, -Math.PI / 2,
        2 * Math.PI / 3, -2 * Math.PI / 3,
      ];
      let resolved = false;
      for (let i = 0; i < deflections.length; i++) {
        const h = ant.heading + deflections[i];
        const tx = ant.x + Math.cos(h) * speed;
        const ty = ant.y + Math.sin(h) * speed;
        if (canStep(world, tx, ty)) {
          ant.heading = h;
          nx = tx; ny = ty;
          resolved = true;
          break;
        }
      }
      if (!resolved) {
        // Truly cornered — flip and skip the move this tick.
        ant.heading += Math.PI;
        return;
      }
    }

    ant.x = nx;
    ant.y = ny;

    if (ant.heading < 0) ant.heading += TWO_PI;
    else if (ant.heading >= TWO_PI) ant.heading -= TWO_PI;

    // 3. Deposit on the *opposite* grid from the one we follow.
    //    Searching scouts deposit home but at scoutDepositMul (default 30%)
    //    so their many radial paths blend into a faint halo rather than a
    //    sharp starburst that would confuse the first carrier. Carrying
    //    scouts deposit food at full strength — the food trail back from
    //    food is what workers will lock onto.
    ant.depositStrength *= p.depositDecay;
    if (ant.depositStrength < 0.01) ant.depositStrength = 0.01;
    const cx = Math.floor(ant.x / CELL_SIZE);
    const cy = Math.floor(ant.y / CELL_SIZE);
    const baseAmount = p.depositRate * ant.depositStrength;
    if (ant.hasFood) {
      pher.depositFood(cx, cy, baseAmount);
    } else {
      const mul = isScout ? p.scoutDepositMul : 1.0;
      pher.depositHome(cx, cy, baseAmount * mul);
    }

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
