// World state: grid dimensions, nest, food sources, obstacles.
// Pure data + helpers; no rendering, no per-tick logic.

window.AntSim = window.AntSim || {};
(function (AntSim) {
  'use strict';

  const CELL_SIZE = 4;

  class World {
    constructor(width, height) {
      this.width = width;
      this.height = height;
      this.cols = Math.floor(width / CELL_SIZE);
      this.rows = Math.floor(height / CELL_SIZE);

      // 0 = empty, 1 = wall.
      this.obstacles = new Uint8Array(this.cols * this.rows);

      this.nest = null;       // { x, y, radius }
      this.foodSources = [];  // [{ x, y, radius, amount }]
    }

    obstacleAtGrid(cx, cy) {
      if (cx < 0 || cy < 0 || cx >= this.cols || cy >= this.rows) return true;
      return this.obstacles[cy * this.cols + cx] === 1;
    }

    obstacleAtWorld(x, y) {
      return this.obstacleAtGrid(Math.floor(x / CELL_SIZE), Math.floor(y / CELL_SIZE));
    }

    setObstacle(cx, cy, value) {
      if (cx < 0 || cy < 0 || cx >= this.cols || cy >= this.rows) return;
      this.obstacles[cy * this.cols + cx] = value ? 1 : 0;
    }

    paintObstacleCircle(x, y, radius, value) {
      const cellRadius = radius / CELL_SIZE;
      const r = Math.ceil(cellRadius);
      const cx0 = Math.floor(x / CELL_SIZE);
      const cy0 = Math.floor(y / CELL_SIZE);
      const r2 = cellRadius * cellRadius;
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (dx * dx + dy * dy <= r2) {
            this.setObstacle(cx0 + dx, cy0 + dy, value);
          }
        }
      }
    }

    setNest(x, y, radius) {
      this.nest = { x, y, radius: radius || 14 };
    }

    addFood(x, y, radius, amount) {
      this.foodSources.push({
        x, y,
        radius: radius || 18,
        amount: amount === undefined ? Infinity : amount,
      });
    }

    // Returns the food source containing (x, y) with amount > 0, or null.
    foodAt(x, y) {
      for (const f of this.foodSources) {
        if (f.amount <= 0) continue;
        const dx = x - f.x, dy = y - f.y;
        if (dx * dx + dy * dy <= f.radius * f.radius) return f;
      }
      return null;
    }

    atNest(x, y) {
      if (!this.nest) return false;
      const dx = x - this.nest.x, dy = y - this.nest.y;
      return dx * dx + dy * dy <= this.nest.radius * this.nest.radius;
    }

    // Removes any nest, food, or wall within `radius` of (x, y).
    eraseAt(x, y, radius) {
      const r0 = radius || 18;
      if (this.nest) {
        const dx = x - this.nest.x, dy = y - this.nest.y;
        const r = this.nest.radius + r0;
        if (dx * dx + dy * dy <= r * r) this.nest = null;
      }
      this.foodSources = this.foodSources.filter(f => {
        const dx = x - f.x, dy = y - f.y;
        const r = f.radius + r0;
        return dx * dx + dy * dy > r * r;
      });
      this.paintObstacleCircle(x, y, r0, false);
    }

    reset() {
      this.obstacles.fill(0);
      this.nest = null;
      this.foodSources = [];
    }
  }

  AntSim.CELL_SIZE = CELL_SIZE;
  AntSim.World = World;
})(window.AntSim);
