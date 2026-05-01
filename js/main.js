// Entry point. Set up the canvas, sim, and frame loop.

(function (AntSim) {
  'use strict';

  const { Sim, Renderer, Input, UI } = AntSim;

  const canvas = document.getElementById('canvas');
  const sim = new Sim(canvas.width, canvas.height);
  const renderer = new Renderer(canvas, sim);

  // Loop state — separated from Sim so pause/speed live in the render layer
  // and don't leak into simulation logic.
  const loop = {
    paused: false,
    speedMultiplier: 1,
    _carry: 0,
  };

  const input = new Input(canvas, sim, renderer);
  const ui = new UI(sim, input, renderer, loop);

  // Expose for debugging from devtools / preview eval. No production cost.
  window.__antsim = { sim, renderer, input, loop, ui };

  const TICK_HZ = 60;
  const TICK_MS = 1000 / TICK_HZ;
  const MAX_TICKS_PER_FRAME = 240; // safety: cap catch-up after a long pause

  let last = performance.now();
  function frame(now) {
    // Clamp huge gaps (tab switched away). Without this, switching back to the
    // tab would dump thousands of accumulated ticks into a single frame.
    const dt = Math.min(now - last, 100);
    last = now;

    if (!loop.paused) {
      loop._carry += (dt / TICK_MS) * loop.speedMultiplier;
      let toRun = Math.floor(loop._carry);
      loop._carry -= toRun;
      if (toRun > MAX_TICKS_PER_FRAME) toRun = MAX_TICKS_PER_FRAME;
      for (let i = 0; i < toRun; i++) sim.tick();
    }

    renderer.draw();
    ui.updateStats();
    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
})(window.AntSim);
