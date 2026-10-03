import type { Maze } from "./hover-mazes.ts";

export const cellSize = 4;
export const tierHeight = 2;
/** Height a hovercraft can drive up without a ramp. */
export const stepUp = 0.6;

export type Cell = { column: number; row: number };
export type Point = { x: number; y: number; z: number };
type Team = "blue" | "red";

const neighbours = [
  ["E", 1, 0],
  ["W", -1, 0],
  ["S", 0, 1],
  ["N", 0, -1],
] as const;
type Side = (typeof neighbours)[number][0];
const opposite: Record<Side, Side> = { E: "W", W: "E", S: "N", N: "S" };

const rampEdges: Record<string, Partial<Record<Side, number>>> = {
  ">": { W: 0, E: tierHeight },
  "<": { E: 0, W: tierHeight },
  v: { N: 0, S: tierHeight },
  "^": { S: 0, N: tierHeight },
};

export function mulberry32(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

/** The maze's solid geometry: tiles, heights and the moves between cells. */
export class Arena {
  readonly maze: Maze;
  readonly width: number;
  readonly depth: number;
  private readonly forward: number[][];
  private readonly backward: number[][];

  constructor(maze: Maze) {
    this.maze = maze;
    this.width = maze.tiles[0]!.length;
    this.depth = maze.tiles.length;
    this.forward = Array.from({ length: this.width * this.depth }, () => []);
    this.backward = Array.from({ length: this.width * this.depth }, () => []);
    for (let row = 0; row < this.depth; row++)
      for (let column = 0; column < this.width; column++)
        this.link(column, row);
  }

  tile(column: number, row: number): string {
    return this.maze.tiles[row]?.[column] ?? "#";
  }

  index(column: number, row: number): number {
    return row * this.width + column;
  }

  cellOf(index: number): Cell {
    return { column: index % this.width, row: Math.floor(index / this.width) };
  }

  cellAt(x: number, z: number): Cell {
    return { column: Math.floor(x / cellSize), row: Math.floor(z / cellSize) };
  }

  indexAt(point: { x: number; z: number }): number {
    const { column, row } = this.cellAt(point.x, point.z);
    return this.index(column, row);
  }

  center(column: number, row: number): Point {
    return {
      x: (column + 0.5) * cellSize,
      y: this.tile(column, row) === "=" ? tierHeight : 0,
      z: (row + 0.5) * cellSize,
    };
  }

  isWall(column: number, row: number): boolean {
    return this.tile(column, row) === "#";
  }

  /** Floor height under a point; ramps rise across their cell. */
  heightAt(x: number, z: number): number {
    const { column, row } = this.cellAt(x, z);
    const tile = this.tile(column, row);
    if (tile === "=") return tierHeight;
    const u = x / cellSize - column;
    const v = z / cellSize - row;
    const along: Record<string, number> = { ">": u, "<": 1 - u, v, "^": 1 - v };
    const part = along[tile];
    return part === undefined ? 0 : Math.max(0, Math.min(1, part)) * tierHeight;
  }

  private edge(column: number, row: number, side: Side): number | null {
    const tile = this.tile(column, row);
    if (tile === "#") return null;
    if (tile === "=") return tierHeight;
    if (tile === ".") return 0;
    return rampEdges[tile]?.[side] ?? null;
  }

  private link(column: number, row: number): void {
    for (const [side, dx, dz] of neighbours) {
      const from = this.edge(column, row, side);
      const to = this.edge(column + dx, row + dz, opposite[side]);
      if (from === null || to === null || to > from + stepUp) continue;
      const a = this.index(column, row);
      const b = this.index(column + dx, row + dz);
      this.forward[a]!.push(b);
      this.backward[b]!.push(a);
    }
  }

  next(index: number): readonly number[] {
    return this.forward[index] ?? [];
  }

  /** Steps from every cell to `goal` along moves a hovercraft can make,
   * avoiding `blocked` cells such as dropped walls. */
  distanceTo(
    goal: number,
    blocked: ReadonlySet<number> = new Set(),
  ): Int16Array {
    const field = new Int16Array(this.width * this.depth).fill(-1);
    const queue = [goal];
    field[goal] = 0;
    for (let head = 0; head < queue.length; head++) {
      const index = queue[head]!;
      for (const previous of this.backward[index]!) {
        if (field[previous] !== -1 || blocked.has(previous)) continue;
        field[previous] = field[index]! + 1;
        queue.push(previous);
      }
    }
    return field;
  }

  /** Whether walls leave a straight line of sight between two points. */
  clearLine(a: { x: number; z: number }, b: { x: number; z: number }): boolean {
    const samples = Math.ceil(
      Math.hypot(b.x - a.x, b.z - a.z) / (cellSize / 3),
    );
    for (let step = 1; step < samples; step++) {
      const t = step / samples;
      const { column, row } = this.cellAt(
        a.x + (b.x - a.x) * t,
        a.z + (b.z - a.z) * t,
      );
      if (this.isWall(column, row)) return false;
    }
    return true;
  }
}

/**
 * Picks flag stands at random, as the original did, but fairly: by driving
 * distance, blue stands sit a moderate run from the player and red stands a
 * longer run from the slower seekers, and stands keep apart from each other.
 */
export function placeFlags(
  arena: Arena,
  count: number,
  random: () => number,
  avoid: { player: Cell; seekers: Cell[] },
): { blue: Point[]; red: Point[] } {
  const free: Cell[] = [];
  arena.maze.things.forEach((line, row) =>
    [...line].forEach((thing, column) => {
      const tile = arena.tile(column, row);
      if (thing === "." && (tile === "." || tile === "="))
        free.push({ column, row });
    }),
  );
  for (let index = free.length - 1; index > 0; index--) {
    const other = Math.floor(random() * (index + 1));
    [free[index], free[other]] = [free[other]!, free[index]!];
  }
  const fieldFrom = (cells: Cell[]) => {
    const fields = cells.map((cell) =>
      arena.distanceTo(arena.index(cell.column, cell.row)),
    );
    return (cell: Cell) =>
      Math.min(
        ...fields.map((field) => field[arena.index(cell.column, cell.row)]!),
      );
  };
  const taken: { cell: Cell; team: Team }[] = [];
  const gap = (a: Cell, b: Cell) =>
    Math.abs(a.column - b.column) + Math.abs(a.row - b.row);
  // A team's own stands spread out so taking one never hands over the next.
  const apart = (cell: Cell, team: Team, spread: number) =>
    taken.every(
      (other) => gap(cell, other.cell) >= (other.team === team ? spread : 4),
    );
  const pick = (
    team: Team,
    distance: (cell: Cell) => number,
    low: number,
    high: number,
  ) => {
    const chosen: Point[] = [];
    // Short of room, stands may lie farther out, then closer together, but
    // never nearer the team that wants them.
    for (const [widen, spread] of [
      [0, 7],
      [8, 7],
      [16, 5],
      [99, 4],
    ] as const)
      for (const cell of free) {
        if (chosen.length === count) return chosen;
        const steps = distance(cell);
        if (steps < low || steps > high + widen) continue;
        if (!apart(cell, team, spread)) continue;
        taken.push({ cell, team });
        chosen.push(arena.center(cell.column, cell.row));
      }
    return chosen;
  };
  return {
    blue: pick("blue", fieldFrom([avoid.player]), 7, 16),
    red: pick("red", fieldFrom(avoid.seekers), 16, 30),
  };
}
