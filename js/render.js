// Renderer: draws pheromone heatmap, obstacles, food, nest, ants.
// Three offscreen surfaces are used:
//   - pherCanvas: grid-resolution heatmap, drawn every frame and scaled up.
//   - obstacleCanvas: full-resolution wall layer, redrawn only when dirty.

window.AntSim = window.AntSim || {};
(function (AntSim) {
  'use strict';

  const CELL_SIZE = AntSim.CELL_SIZE;

  class Renderer {
    constructor(canvas, sim) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.sim = sim;
      this.showPheromones = true;

      // Camera transform plumbed through every draw, even though Phase 1
      // leaves it at identity. Retrofitting a camera into a renderer that
      // bakes screen coords directly is tedious — so we pay it now.
      this.camera = { x: 0, y: 0, zoom: 1 };

      const w = sim.world;
      this.pherCanvas = document.createElement('canvas');
      this.pherCanvas.width = w.cols;
      this.pherCanvas.height = w.rows;
      this.pherCtx = this.pherCanvas.getContext('2d');
      this.pherImage = this.pherCtx.createImageData(w.cols, w.rows);

      this.obstacleCanvas = document.createElement('canvas');
      this.obstacleCanvas.width = w.width;
      this.obstacleCanvas.height = w.height;
      this.obstacleCtx = this.obstacleCanvas.getContext('2d');
      this.obstaclesDirty = true;
    }

    markObstaclesDirty() { this.obstaclesDirty = true; }

    applyCamera() {
      const c = this.camera;
      this.ctx.setTransform(c.zoom, 0, 0, c.zoom, c.x, c.y);
    }

    resetTransform() {
      this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    }

    draw() {
      const ctx = this.ctx;
      this.resetTransform();
      ctx.fillStyle = '#0d1116';
      ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

      this.applyCamera();
      if (this.showPheromones) this.drawPheromones();
      this.drawObstacles();
      this.drawFood();
      this.drawNest();
      this.drawAnts();
    }

    drawPheromones() {
      const sim = this.sim;
      const home = sim.pheromones.home;
      const food = sim.pheromones.food;
      const max  = sim.pheromones.maxValue;
      const data = this.pherImage.data;
      const n = home.length;
      // home → blue, food → red, blended where both exist. Alpha tracks the
      // stronger of the two so weak trails fade naturally.
      for (let i = 0; i < n; i++) {
        const h = home[i] / max;
        const f = food[i] / max;
        const di = i * 4;
        data[di    ] = Math.min(255, f * 255 * 1.4);
        data[di + 1] = Math.min(255, (h * 0.35 + f * 0.2) * 255);
        data[di + 2] = Math.min(255, h * 255 * 1.4);
        data[di + 3] = Math.min(255, Math.max(h, f) * 255 * 2.4);
      }
      this.pherCtx.putImageData(this.pherImage, 0, 0);
      this.ctx.imageSmoothingEnabled = true;
      this.ctx.drawImage(this.pherCanvas, 0, 0, sim.world.width, sim.world.height);
    }

    drawObstacles() {
      if (this.obstaclesDirty) {
        const c = this.obstacleCtx;
        const world = this.sim.world;
        c.clearRect(0, 0, this.obstacleCanvas.width, this.obstacleCanvas.height);
        c.fillStyle = '#3b3530';
        const C = CELL_SIZE;
        const cols = world.cols, rows = world.rows;
        const obs = world.obstacles;
        for (let cy = 0; cy < rows; cy++) {
          for (let cx = 0; cx < cols; cx++) {
            if (obs[cy * cols + cx]) c.fillRect(cx * C, cy * C, C, C);
          }
        }
        this.obstaclesDirty = false;
      }
      this.ctx.drawImage(this.obstacleCanvas, 0, 0);
    }

    drawFood() {
      const ctx = this.ctx;
      for (const f of this.sim.world.foodSources) {
        ctx.fillStyle = '#3da35d';
        ctx.beginPath();
        ctx.arc(f.x, f.y, f.radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#7be495';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    }

    drawNest() {
      const nest = this.sim.world.nest;
      if (!nest) return;
      const ctx = this.ctx;
      ctx.fillStyle = '#7a4a26';
      ctx.beginPath();
      ctx.arc(nest.x, nest.y, nest.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#c08550';
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    drawAnts() {
      const ctx = this.ctx;
      const ants = this.sim.ants;
      // Three passes for layering. Workers searching = pale gray, scouts
      // searching = pink (so it's obvious which ants are exploring), and
      // any carrier (regardless of caste) = vivid yellow on top.
      ctx.fillStyle = '#cfd6dc';
      for (let i = 0; i < ants.length; i++) {
        const a = ants[i];
        if (a.hasFood || a.role === 'scout') continue;
        ctx.beginPath();
        ctx.arc(a.x, a.y, 1.6, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = '#e98ab8';
      for (let i = 0; i < ants.length; i++) {
        const a = ants[i];
        if (a.hasFood || a.role !== 'scout') continue;
        ctx.beginPath();
        ctx.arc(a.x, a.y, 1.7, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = '#f5d061';
      for (let i = 0; i < ants.length; i++) {
        const a = ants[i];
        if (!a.hasFood) continue;
        ctx.beginPath();
        ctx.arc(a.x, a.y, 1.9, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  AntSim.Renderer = Renderer;
})(window.AntSim);
