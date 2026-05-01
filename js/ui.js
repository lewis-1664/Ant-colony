// Wires DOM controls (buttons, sliders, stats) to the sim and loop.

const SPEED_VALUES = [0.25, 0.5, 1, 2, 4, 8];
const SPEED_DEFAULT_INDEX = 2;

export class UI {
  constructor(sim, input, renderer, loop) {
    this.sim = sim;
    this.input = input;
    this.renderer = renderer;
    this.loop = loop;

    this.bindTools();
    this.bindSimControls();
    this.bindDisplayControls();
  }

  bindTools() {
    const buttons = document.querySelectorAll('[data-tool]');
    const setActive = (tool) => {
      this.input.setTool(tool);
      buttons.forEach(b => b.classList.toggle('active', b.dataset.tool === tool));
    };
    buttons.forEach(b => b.addEventListener('click', () => setActive(b.dataset.tool)));
    setActive('nest');
  }

  bindSimControls() {
    const playPause = document.getElementById('play-pause');
    playPause.addEventListener('click', () => {
      this.loop.paused = !this.loop.paused;
      playPause.textContent = this.loop.paused ? 'Play' : 'Pause';
    });

    const speed = document.getElementById('speed');
    const speedLabel = document.getElementById('speed-label');
    speed.min = 0;
    speed.max = SPEED_VALUES.length - 1;
    speed.step = 1;
    speed.value = SPEED_DEFAULT_INDEX;
    const setSpeed = () => {
      const v = SPEED_VALUES[parseInt(speed.value, 10)];
      this.loop.speedMultiplier = v;
      speedLabel.textContent = `${v}×`;
    };
    speed.addEventListener('input', setSpeed);
    setSpeed();

    const ants = document.getElementById('ants');
    const antsLabel = document.getElementById('ants-label');
    const setMax = () => {
      const n = parseInt(ants.value, 10);
      this.sim.setMaxAnts(n);
      antsLabel.textContent = String(n);
    };
    ants.addEventListener('input', setMax);
    setMax();

    document.getElementById('reset').addEventListener('click', () => {
      this.sim.reset();
      this.renderer.markObstaclesDirty();
    });
  }

  bindDisplayControls() {
    const cb = document.getElementById('show-pheromones');
    cb.addEventListener('change', () => {
      this.renderer.showPheromones = cb.checked;
    });
  }

  updateStats() {
    document.getElementById('stat-food').textContent = this.sim.foodCollected;
    document.getElementById('stat-ants').textContent = this.sim.ants.length;
    document.getElementById('stat-died').textContent = this.sim.antsDied;
    document.getElementById('stat-ticks').textContent = this.sim.tickCount;
  }
}
