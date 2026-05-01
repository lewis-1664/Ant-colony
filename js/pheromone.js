// Two scalar fields on a regular grid: home + food pheromones.
// Ants deposit into one and follow the other (depending on state).
// Evaporation is a single multiply pass per tick — O(cells), independent of ant count.

window.AntSim = window.AntSim || {};
(function (AntSim) {
  'use strict';

  class PheromoneGrid {
    constructor(cols, rows) {
      this.cols = cols;
      this.rows = rows;
      this.home = new Float32Array(cols * rows);
      this.food = new Float32Array(cols * rows);
      this.evaporation = 0.997;
      this.maxValue = 8;
    }

    inBounds(cx, cy) {
      return cx >= 0 && cy >= 0 && cx < this.cols && cy < this.rows;
    }

    depositHome(cx, cy, amount) {
      if (!this.inBounds(cx, cy)) return;
      const i = cy * this.cols + cx;
      const v = this.home[i] + amount;
      this.home[i] = v > this.maxValue ? this.maxValue : v;
    }

    depositFood(cx, cy, amount) {
      if (!this.inBounds(cx, cy)) return;
      const i = cy * this.cols + cx;
      const v = this.food[i] + amount;
      this.food[i] = v > this.maxValue ? this.maxValue : v;
    }

    // Sample one cell. Returns 0 outside bounds (so ants are repelled from edges).
    sampleHome(cx, cy) {
      if (!this.inBounds(cx, cy)) return 0;
      return this.home[cy * this.cols + cx];
    }

    sampleFood(cx, cy) {
      if (!this.inBounds(cx, cy)) return 0;
      return this.food[cy * this.cols + cx];
    }

    evaporate() {
      const e = this.evaporation;
      const home = this.home, food = this.food;
      const n = home.length;
      for (let i = 0; i < n; i++) {
        home[i] *= e;
        food[i] *= e;
      }
    }

    clear() {
      this.home.fill(0);
      this.food.fill(0);
    }
  }

  AntSim.PheromoneGrid = PheromoneGrid;
})(window.AntSim);
