import * as THREE from "three";
import type { Maze } from "./hover-mazes";

type Painter = (context: CanvasRenderingContext2D, size: number) => void;

function texture(size: number, paint: Painter): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  paint(canvas.getContext("2d")!, size);
  const result = new THREE.CanvasTexture(canvas);
  result.colorSpace = THREE.SRGBColorSpace;
  result.wrapS = result.wrapT = THREE.RepeatWrapping;
  result.anisotropy = 4;
  return result;
}

function speckle(
  context: CanvasRenderingContext2D,
  size: number,
  color: string,
  count: number,
  seed: number,
): void {
  context.fillStyle = color;
  let state = seed;
  for (let index = 0; index < count; index++) {
    state = (state * 16807) % 2147483647;
    const x = state % size;
    state = (state * 16807) % 2147483647;
    const y = state % size;
    context.fillRect(x, y, 2, 2);
  }
}

const bricks =
  (base: string, mortar: string, light: string, rows: number): Painter =>
  (context, size) => {
    context.fillStyle = mortar;
    context.fillRect(0, 0, size, size);
    const height = size / rows;
    for (let row = 0; row < rows; row++) {
      const offset = row % 2 ? size / 4 : 0;
      for (let column = -1; column < 3; column++) {
        context.fillStyle = (row + column) % 3 ? base : light;
        context.fillRect(
          column * (size / 2) + offset + 2,
          row * height + 2,
          size / 2 - 4,
          height - 4,
        );
      }
    }
    speckle(context, size, mortar, 260, 7);
  };

const planks =
  (base: string, seam: string): Painter =>
  (context, size) => {
    context.fillStyle = base;
    context.fillRect(0, 0, size, size);
    context.fillStyle = seam;
    for (let row = 0; row < 4; row++) {
      context.fillRect(0, (row * size) / 4, size, 3);
      context.fillRect(
        ((row * 37) % 4) * (size / 4),
        (row * size) / 4,
        3,
        size / 4,
      );
    }
    speckle(context, size, seam, 180, 11);
  };

const flagstones =
  (base: string, seam: string): Painter =>
  (context, size) => {
    context.fillStyle = seam;
    context.fillRect(0, 0, size, size);
    context.fillStyle = base;
    context.fillRect(3, 3, size / 2 - 6, size / 2 - 6);
    context.fillRect(size / 2 + 3, 3, size / 2 - 6, size / 2 - 6);
    context.fillRect(3, size / 2 + 3, size - 6, size / 2 - 6);
    speckle(context, size, seam, 120, 5);
  };

const panels =
  (base: string, seam: string, glow: string): Painter =>
  (context, size) => {
    context.fillStyle = base;
    context.fillRect(0, 0, size, size);
    context.fillStyle = seam;
    context.fillRect(0, size / 2 - 2, size, 4);
    context.fillRect(size / 2 - 2, 0, 4, size);
    context.fillStyle = glow;
    for (let row = 0; row < 6; row++)
      for (let column = 0; column < 6; column++)
        if ((row * 7 + column * 3) % 5 < 2)
          context.fillRect(
            10 + column * (size / 6),
            8 + row * (size / 6),
            size / 12,
            size / 16,
          );
  };

const asphalt =
  (base: string, line: string): Painter =>
  (context, size) => {
    context.fillStyle = base;
    context.fillRect(0, 0, size, size);
    speckle(context, size, line, 90, 3);
    context.fillStyle = line;
    for (let step = 0; step < 4; step++)
      context.fillRect(size / 2 - 3, step * (size / 4) + 8, 6, size / 8);
  };

const grating =
  (base: string, bar: string): Painter =>
  (context, size) => {
    context.fillStyle = base;
    context.fillRect(0, 0, size, size);
    context.fillStyle = bar;
    for (let step = 0; step < size; step += size / 8) {
      context.fillRect(step, 0, 3, size);
      context.fillRect(0, step, size, 3);
    }
  };

const hazard =
  (base: Painter, sign: string): Painter =>
  (context, size) => {
    base(context, size);
    const middle = size / 2;
    context.fillStyle = sign;
    context.beginPath();
    context.arc(middle, middle, size / 5, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = "#1a1a12";
    for (let blade = 0; blade < 3; blade++) {
      const start = (blade * 2 * Math.PI) / 3 - Math.PI / 2 - 0.5;
      context.beginPath();
      context.moveTo(middle, middle);
      context.arc(middle, middle, size / 6, start, start + 1);
      context.fill();
    }
    context.fillStyle = sign;
    context.beginPath();
    context.arc(middle, middle, size / 28, 0, Math.PI * 2);
    context.fill();
  };

const steps =
  (base: string, edge: string): Painter =>
  (context, size) => {
    context.fillStyle = base;
    context.fillRect(0, 0, size, size);
    context.fillStyle = edge;
    for (let step = 0; step < 6; step++)
      context.fillRect(0, (step * size) / 6, size, size / 24);
  };

interface MazeTextures {
  floor: THREE.CanvasTexture;
  ramp: THREE.CanvasTexture;
  sky: THREE.CanvasTexture;
  top: THREE.CanvasTexture;
  wall: THREE.CanvasTexture;
  wallAlternate: THREE.CanvasTexture;
}

/** Procedural surfaces in each maze's palette; no image files. */
export function mazeTextures(maze: Maze): MazeTextures {
  const { look } = maze;
  const [wall, mortar, light] = look.wall;
  const wallPainter: Record<string, Painter> = {
    castle: bricks(wall, mortar, light, 4),
    city: panels(wall, mortar, light),
    sewer: bricks(wall, mortar, light, 6),
  };
  const floorPainter: Record<string, Painter> = {
    castle: planks(look.floor[0], look.floor[1]),
    city: asphalt(look.floor[0], look.floor[1]),
    sewer: flagstones(look.floor[0], look.floor[1]),
  };
  const topPainter: Record<string, Painter> = {
    castle: flagstones(look.top[0], look.top[1]),
    city: grating(look.top[0], look.top[1]),
    sewer: grating(look.top[0], look.top[1]),
  };
  const wallPaint = wallPainter[maze.name]!;
  return {
    wall: texture(128, wallPaint),
    wallAlternate: texture(
      128,
      maze.name === "sewer" ? hazard(wallPaint, look.accent) : wallPaint,
    ),
    floor: texture(128, floorPainter[maze.name]!),
    top: texture(128, topPainter[maze.name]!),
    ramp: texture(64, steps(look.top[0], look.top[1])),
    sky: skyTexture(look.sky),
  };
}

function skyTexture([top, bottom]: [string, string]): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 4;
  canvas.height = 256;
  const context = canvas.getContext("2d")!;
  const gradient = context.createLinearGradient(0, 0, 0, 256);
  gradient.addColorStop(0, top);
  gradient.addColorStop(1, bottom);
  context.fillStyle = gradient;
  context.fillRect(0, 0, 4, 256);
  const result = new THREE.CanvasTexture(canvas);
  result.colorSpace = THREE.SRGBColorSpace;
  return result;
}
