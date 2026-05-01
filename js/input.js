const TOOL_RADII = {
  obstacle: 14,
  food: 18,
  eraser: 20,
};

export class Input {
  constructor(canvas, sim, renderer) {
    this.canvas = canvas;
    this.sim = sim;
    this.renderer = renderer;
    this.tool = 'nest';
    this.mouseDown = false;

    canvas.addEventListener('mousedown', this.onDown);
    canvas.addEventListener('mousemove', this.onMove);
    window.addEventListener('mouseup', this.onUp);
    canvas.addEventListener('contextmenu', e => e.preventDefault());
  }

  setTool(tool) { this.tool = tool; }

  // Translate a mouse event to world coordinates, accounting for both CSS
  // scaling (canvas displayed at non-native size) and the camera transform.
  toWorld(e) {
    const rect = this.canvas.getBoundingClientRect();
    const sx = (e.clientX - rect.left) * (this.canvas.width / rect.width);
    const sy = (e.clientY - rect.top)  * (this.canvas.height / rect.height);
    const cam = this.renderer.camera;
    return [(sx - cam.x) / cam.zoom, (sy - cam.y) / cam.zoom];
  }

  onDown = (e) => {
    if (e.button !== 0) return;
    this.mouseDown = true;
    const [x, y] = this.toWorld(e);
    this.applyTool(x, y, true);
  }

  onMove = (e) => {
    if (!this.mouseDown) return;
    const [x, y] = this.toWorld(e);
    this.applyTool(x, y, false);
  }

  onUp = () => {
    this.mouseDown = false;
  }

  applyTool(x, y, firstPress) {
    const world = this.sim.world;
    switch (this.tool) {
      case 'nest':
        if (firstPress) world.setNest(x, y);
        break;
      case 'food':
        if (firstPress) world.addFood(x, y);
        break;
      case 'obstacle':
        world.paintObstacleCircle(x, y, TOOL_RADII.obstacle, true);
        this.renderer.markObstaclesDirty();
        break;
      case 'eraser':
        world.eraseAt(x, y, TOOL_RADII.eraser);
        this.renderer.markObstaclesDirty();
        break;
    }
  }
}
