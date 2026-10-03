import { mazes, type Maze } from "./hover-mazes";

export const cellSize = 4;
export const wallHeight = 4.5;
export const tierHeight = 2;
export const barrierHeight = 1.3;
const craftRadius = 1.1;
const stepUp = 0.6;
const revealRadius = 3;

export type PodKind =
  | "spring"
  | "barrier"
  | "cloak"
  | "green"
  | "red"
  | "shield"
  | "eraser"
  | "calm"
  | "thief"
  | "random";
type TrapKind = "fling" | "hold";
export type CraftKind = "player" | "seeker" | "hunter";
export type GameState = "ready" | "playing" | "paused" | "cleared" | "lost";
type Team = "blue" | "red";
type Cell = { column: number; row: number };

export interface Craft {
  boost: number;
  cloak: number;
  fling: number;
  heading: number;
  held: number;
  kind: CraftKind;
  mass: number;
  shield: number;
  slow: number;
  trapCooldown: number;
  vx: number;
  vy: number;
  vz: number;
  x: number;
  y: number;
  z: number;
}

interface Flag {
  owner: Team;
  taken: boolean;
  x: number;
  y: number;
  z: number;
}

interface Pod {
  kind: PodKind;
  respawn: number;
  x: number;
  y: number;
  z: number;
}

interface Trap {
  kind: TrapKind;
  x: number;
  y: number;
  z: number;
}

interface Barrier {
  age: number;
  heading: number;
  x: number;
  y: number;
  z: number;
}

interface Box {
  halfDepth: number;
  halfWidth: number;
  heading: number;
  x: number;
  z: number;
}

export interface Controls {
  barrier: boolean;
  cloak: boolean;
  jump: boolean;
  left: boolean;
  reverse: boolean;
  right: boolean;
  thrust: boolean;
}

interface Pilot {
  craft: Craft;
  field: Int16Array | null;
  goal: number;
  replan: number;
  resting: number;
  reversing: number;
  sees: boolean;
  stuck: number;
}

export const emptyControls = (): Controls => ({
  barrier: false,
  cloak: false,
  jump: false,
  left: false,
  reverse: false,
  right: false,
  thrust: false,
});

const podKinds: Record<string, PodKind> = {
  j: "spring",
  w: "barrier",
  c: "cloak",
  "+": "green",
  "-": "red",
  s: "shield",
  m: "eraser",
  z: "calm",
  t: "thief",
  "?": "random",
};
const trapKinds: Record<string, TrapKind> = { g: "fling", x: "hold" };
const randomPods: readonly PodKind[] = [
  "spring",
  "barrier",
  "cloak",
  "green",
  "red",
  "shield",
  "eraser",
  "calm",
  "thief",
];
const harmful = new Set<PodKind>(["red", "eraser", "thief"]);
const blueFlags = "123456";
const redFlags = "!@$%&*";

const tuning: Record<CraftKind, { thrust: number; top: number }> = {
  player: { thrust: 30, top: 17 },
  seeker: { thrust: 12, top: 6.5 },
  hunter: { thrust: 18, top: 10.5 },
};

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

const wrapAngle = (angle: number) =>
  Math.atan2(Math.sin(angle), Math.cos(angle));

function mulberry32(seed: number) {
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
  readonly width: number;
  readonly depth: number;
  private readonly forward: number[][];
  private readonly backward: number[][];

  readonly maze: Maze;

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

  center(column: number, row: number) {
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

  /** Steps from every cell to `goal`, following moves a hovercraft can make. */
  distanceTo(goal: number): Int16Array {
    const field = new Int16Array(this.width * this.depth).fill(-1);
    const queue = [goal];
    field[goal] = 0;
    for (let head = 0; head < queue.length; head++) {
      const index = queue[head]!;
      for (const previous of this.backward[index]!) {
        if (field[previous] !== -1) continue;
        field[previous] = field[index]! + 1;
        queue.push(previous);
      }
    }
    return field;
  }

  /** Whether walls leave a straight line of sight between two points. */
  clearLine(ax: number, az: number, bx: number, bz: number): boolean {
    const samples = Math.ceil(Math.hypot(bx - ax, bz - az) / (cellSize / 3));
    for (let step = 1; step < samples; step++) {
      const t = step / samples;
      const { column, row } = this.cellAt(
        ax + (bx - ax) * t,
        az + (bz - az) * t,
      );
      if (this.isWall(column, row)) return false;
    }
    return true;
  }
}

const newCraft = (
  arena: Arena,
  kind: CraftKind,
  column: number,
  row: number,
): Craft => ({
  ...arena.center(column, row),
  boost: 0,
  cloak: 0,
  fling: 0,
  heading: kind === "player" ? 0 : Math.PI,
  held: 0,
  kind,
  mass: kind === "hunter" ? 2.2 : 1,
  shield: 0,
  slow: 0,
  trapCooldown: 0,
  vx: 0,
  vy: 0,
  vz: 0,
});

function limitSpeed(craft: Craft, top: number): void {
  const limit = top * (craft.boost > 0 ? 1.5 : 1) * (craft.slow > 0 ? 0.45 : 1);
  const speed = Math.hypot(craft.vx, craft.vz);
  if (speed <= limit) return;
  craft.vx *= limit / speed;
  craft.vz *= limit / speed;
}

const steering = (controls: Controls) =>
  (controls.right ? 1 : 0) - (controls.left ? 1 : 0);

const throttle = (controls: Controls) =>
  (controls.thrust ? 1 : 0) - (controls.reverse ? 0.6 : 0);

/** Hovercraft slide: little grip sideways, less still in the air. */
function glide(craft: Craft, airborne: boolean, dt: number): void {
  const forwardX = Math.sin(craft.heading);
  const forwardZ = -Math.cos(craft.heading);
  const along = craft.vx * forwardX + craft.vz * forwardZ;
  const sideX = craft.vx - along * forwardX;
  const sideZ = craft.vz - along * forwardZ;
  const grip = Math.exp(-(airborne ? 0.3 : 2.4) * dt);
  const drag = Math.exp(-(craft.held > 0 ? 6 : 0.75) * dt);
  craft.vx = (along * forwardX + sideX * grip) * drag;
  craft.vz = (along * forwardZ + sideZ * grip) * drag;
}

function tick(craft: Craft, dt: number): void {
  craft.boost = Math.max(0, craft.boost - dt);
  craft.slow = Math.max(0, craft.slow - dt);
  craft.cloak = Math.max(0, craft.cloak - dt);
  craft.shield = Math.max(0, craft.shield - dt);
  craft.held = Math.max(0, craft.held - dt);
  craft.fling = Math.max(0, craft.fling - dt);
  craft.trapCooldown = Math.max(0, craft.trapCooldown - dt);
}

/** Flags, drones, pods and traps for one round in one maze. */
export class HoverWorld {
  readonly arena: Arena;
  readonly crafts: Craft[] = [];
  readonly flags: Flag[] = [];
  readonly pods: Pod[] = [];
  readonly traps: Trap[] = [];
  readonly barriers: Barrier[] = [];
  readonly inventory = { spring: 0, barrier: 0, cloak: 0 };
  readonly explored: Uint8Array;
  readonly events: string[] = [];
  readonly flagCount: number;
  state: GameState = "ready";
  time = 0;
  steps = 0;
  bumps = 0;
  calm = 0;
  score: number;
  private pilots: Pilot[] = [];
  private random: () => number;
  private previous = emptyControls();
  private lastCell = -1;

  readonly round: number;

  constructor(round = 0, score = 0, seed = 1995) {
    this.round = round;
    this.score = score;
    this.arena = new Arena(mazes[round % mazes.length]!);
    this.explored = new Uint8Array(this.arena.width * this.arena.depth);
    this.random = mulberry32(seed + round);
    this.flagCount = Math.min(6, 3 + Math.floor(round / 3));
    const counts = {
      E: Math.min(3, 1 + Math.floor(round / 2)),
      G: Math.min(3, 1 + Math.floor((round + 1) / 2)),
    };
    this.arena.maze.things.forEach((line, row) =>
      [...line].forEach((thing, column) =>
        this.place(thing, column, row, counts),
      ),
    );
    this.pilots = this.crafts
      .filter((craft) => craft.kind !== "player")
      .map((craft) => ({
        craft,
        field: null,
        goal: -1,
        replan: 0,
        resting: 0,
        reversing: 0,
        sees: false,
        stuck: 0,
      }));
    this.reveal();
  }

  private place(
    thing: string,
    column: number,
    row: number,
    counts: { E: number; G: number },
  ): void {
    const at = this.arena.center(column, row);
    if (thing === "P")
      this.crafts.unshift(newCraft(this.arena, "player", column, row));
    else if ((thing === "E" || thing === "G") && counts[thing] > 0) {
      counts[thing] -= 1;
      this.crafts.push(
        newCraft(this.arena, thing === "E" ? "seeker" : "hunter", column, row),
      );
    } else this.placeItem(thing, at);
  }

  private placeItem(
    thing: string,
    at: { x: number; y: number; z: number },
  ): void {
    const flag = (owner: Team, order: string) => {
      const rank = order.indexOf(thing);
      if (rank >= 0 && rank < this.flagCount)
        this.flags.push({ owner, taken: false, ...at });
    };
    flag("blue", blueFlags);
    flag("red", redFlags);
    const pod = podKinds[thing];
    if (pod) this.pods.push({ kind: pod, respawn: 0, ...at });
    const trap = trapKinds[thing];
    if (trap) this.traps.push({ kind: trap, ...at });
  }

  get player(): Craft {
    return this.crafts[0]!;
  }

  /** Blue flags the player holds, or red flags the drones hold. */
  captured(team: "player" | "rival"): number {
    const owner: Team = team === "player" ? "blue" : "red";
    return this.flags.filter((flag) => flag.owner === owner && flag.taken)
      .length;
  }

  step(dt: number, controls: Controls): void {
    if (this.state !== "playing") return;
    this.steps += 1;
    this.time += dt;
    this.calm = Math.max(0, this.calm - dt);
    this.useItems(controls);
    this.drive(this.player, controls, dt);
    for (const pilot of this.pilots)
      this.drive(pilot.craft, this.fly(pilot, dt), dt);
    for (const craft of this.crafts) this.move(craft, dt);
    this.collideCrafts();
    for (const barrier of this.barriers) barrier.age += dt;
    while (this.barriers[0] && this.barriers[0].age > 15) this.barriers.shift();
    for (const craft of this.crafts) this.touchTraps(craft);
    this.collect(dt);
    this.reveal();
    this.finish();
  }

  private finish(): void {
    if (this.captured("player") >= this.flagCount) {
      const home = this.flags.filter((f) => f.owner === "red" && !f.taken);
      this.score +=
        home.length * 250 + Math.max(0, Math.round(180 - this.time)) * 5;
      this.state = "cleared";
      this.events.push("cleared");
    } else if (this.captured("rival") >= this.flagCount) {
      this.state = "lost";
      this.events.push("lost");
    }
  }

  private reveal(): void {
    const { column, row } = this.arena.cellAt(this.player.x, this.player.z);
    const here = this.arena.index(column, row);
    if (here === this.lastCell) return;
    this.lastCell = here;
    for (let dz = -revealRadius; dz <= revealRadius; dz++)
      for (let dx = -revealRadius; dx <= revealRadius; dx++) {
        const c = column + dx;
        const r = row + dz;
        if (c < 0 || r < 0 || c >= this.arena.width || r >= this.arena.depth)
          continue;
        if (dx * dx + dz * dz <= revealRadius * revealRadius + 1)
          this.explored[this.arena.index(c, r)] = 1;
      }
  }

  private useItems(controls: Controls): void {
    const player = this.player;
    const uses: [
      keyof HoverWorld["inventory"],
      keyof Controls,
      () => boolean,
    ][] = [
      ["spring", "jump", () => this.jump(player)],
      ["barrier", "barrier", () => this.dropBarrier(player)],
      [
        "cloak",
        "cloak",
        () => {
          player.cloak = 8;
          return true;
        },
      ],
    ];
    for (const [item, control, spend] of uses)
      if (
        controls[control] &&
        !this.previous[control] &&
        this.inventory[item] > 0 &&
        spend()
      ) {
        this.inventory[item] -= 1;
        this.events.push(`use:${item}`);
      }
    this.previous = { ...controls };
  }

  private jump(craft: Craft): boolean {
    if (craft.y > this.arena.heightAt(craft.x, craft.z) + 0.05) return false;
    craft.vy = 12.5;
    return true;
  }

  private dropBarrier(craft: Craft): boolean {
    this.barriers.push({
      age: 0,
      heading: craft.heading,
      x: craft.x - Math.sin(craft.heading) * 2.8,
      y: craft.y,
      z: craft.z + Math.cos(craft.heading) * 2.8,
    });
    if (this.barriers.length > 3) this.barriers.shift();
    return true;
  }

  private drive(craft: Craft, controls: Controls, dt: number): void {
    tick(craft, dt);
    if (craft.fling > 0) return;
    const { thrust, top } = tuning[craft.kind];
    craft.heading = wrapAngle(craft.heading + steering(controls) * 2.7 * dt);
    const airborne = craft.y > this.arena.heightAt(craft.x, craft.z) + 0.05;
    const power = craft.held > 0 ? 0 : airborne ? 0.25 : 1;
    const push = throttle(controls) * thrust * power;
    craft.vx += Math.sin(craft.heading) * push * dt;
    craft.vz -= Math.cos(craft.heading) * push * dt;
    glide(craft, airborne, dt);
    const calmed = craft.kind !== "player" && this.calm > 0 ? 0.5 : 1;
    limitSpeed(craft, top * calmed);
  }

  private move(craft: Craft, dt: number): void {
    craft.x += craft.vx * dt;
    craft.z += craft.vz * dt;
    this.fall(craft, dt);
    const { column, row } = this.arena.cellAt(craft.x, craft.z);
    for (let dz = -1; dz <= 1; dz++)
      for (let dx = -1; dx <= 1; dx++)
        this.blockCell(craft, column + dx, row + dz);
    for (const barrier of this.barriers)
      if (craft.y < barrier.y + barrierHeight && craft.y > barrier.y - 1)
        this.pushOut(craft, {
          x: barrier.x,
          z: barrier.z,
          halfWidth: 2.3,
          halfDepth: 0.35,
          heading: barrier.heading,
        });
  }

  private fall(craft: Craft, dt: number): void {
    const ground = this.arena.heightAt(craft.x, craft.z);
    const grounded = craft.vy <= 0 && craft.y <= ground + 0.35;
    if (grounded) {
      craft.y = ground;
      craft.vy = 0;
      return;
    }
    craft.vy -= 28 * dt;
    craft.y = Math.max(ground, craft.y + craft.vy * dt);
    if (craft.y === ground) craft.vy = 0;
  }

  private blockCell(craft: Craft, column: number, row: number): void {
    const halfCell = cellSize / 2;
    const centerX = (column + 0.5) * cellSize;
    const centerZ = (row + 0.5) * cellSize;
    const nearX = Math.max(
      centerX - halfCell,
      Math.min(centerX + halfCell, craft.x),
    );
    const nearZ = Math.max(
      centerZ - halfCell,
      Math.min(centerZ + halfCell, craft.z),
    );
    const solid =
      this.arena.isWall(column, row) ||
      this.arena.heightAt(
        Math.min(
          Math.max(nearX, column * cellSize + 0.01),
          (column + 1) * cellSize - 0.01,
        ),
        Math.min(
          Math.max(nearZ, row * cellSize + 0.01),
          (row + 1) * cellSize - 0.01,
        ),
      ) >
        craft.y + stepUp;
    if (!solid) return;
    this.pushOut(craft, {
      x: centerX,
      z: centerZ,
      halfWidth: halfCell,
      halfDepth: halfCell,
      heading: 0,
    });
  }

  private pushOut(craft: Craft, box: Box): void {
    const { x: centerX, z: centerZ, halfWidth, halfDepth, heading } = box;
    const cos = Math.cos(heading);
    const sin = Math.sin(heading);
    const relativeX = craft.x - centerX;
    const relativeZ = craft.z - centerZ;
    const localX = relativeX * cos + relativeZ * sin;
    const localZ = -relativeX * sin + relativeZ * cos;
    const nearestX = Math.max(-halfWidth, Math.min(halfWidth, localX));
    const nearestZ = Math.max(-halfDepth, Math.min(halfDepth, localZ));
    let normalX = localX - nearestX;
    let normalZ = localZ - nearestZ;
    let distance = Math.hypot(normalX, normalZ);
    if (distance >= craftRadius) return;
    if (distance < 1e-6) {
      const pushX = halfWidth - Math.abs(localX);
      const pushZ = halfDepth - Math.abs(localZ);
      if (pushX < pushZ) [normalX, normalZ] = [Math.sign(localX) || 1, 0];
      else [normalX, normalZ] = [0, Math.sign(localZ) || 1];
      distance = -Math.min(pushX, pushZ);
    } else {
      normalX /= distance;
      normalZ /= distance;
    }
    const worldX = normalX * cos - normalZ * sin;
    const worldZ = normalX * sin + normalZ * cos;
    craft.x += worldX * (craftRadius - distance);
    craft.z += worldZ * (craftRadius - distance);
    const into = craft.vx * worldX + craft.vz * worldZ;
    if (into >= 0) return;
    craft.vx -= 1.6 * into * worldX;
    craft.vz -= 1.6 * into * worldZ;
  }

  private collideCrafts(): void {
    for (let first = 0; first < this.crafts.length; first++)
      for (let second = first + 1; second < this.crafts.length; second++)
        this.bump(this.crafts[first]!, this.crafts[second]!);
  }

  private massOf(craft: Craft): number {
    return craft.kind === "player" && craft.shield > 0 ? 50 : craft.mass;
  }

  private bump(a: Craft, b: Craft): void {
    if (Math.abs(a.y - b.y) > 1.2) return;
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const distance = Math.hypot(dx, dz);
    const reach = craftRadius * 2;
    if (distance >= reach || distance < 1e-6) return;
    const nx = dx / distance;
    const nz = dz / distance;
    const massA = this.massOf(a);
    const massB = this.massOf(b);
    const total = massA + massB;
    const overlap = reach - distance;
    a.x -= nx * overlap * (massB / total);
    a.z -= nz * overlap * (massB / total);
    b.x += nx * overlap * (massA / total);
    b.z += nz * overlap * (massA / total);
    const closing = (a.vx - b.vx) * nx + (a.vz - b.vz) * nz;
    if (closing <= 0) return;
    if (closing > 3) this.recordBump(a, b);
    const impulse = (1.8 * closing) / total;
    a.vx -= impulse * massB * nx;
    a.vz -= impulse * massB * nz;
    b.vx += impulse * massA * nx;
    b.vz += impulse * massA * nz;
  }

  private recordBump(a: Craft, b: Craft): void {
    if (a.kind !== "player" && b.kind !== "player") return;
    this.bumps += 1;
    this.events.push("bump");
    const hunter = [a, b].find((craft) => craft.kind === "hunter");
    const pilot = this.pilots.find((candidate) => candidate.craft === hunter);
    if (pilot) pilot.reversing = 0.9;
  }

  private touchTraps(craft: Craft): void {
    if (craft.trapCooldown > 0) return;
    if (craft.kind === "player" && craft.shield > 0) return;
    for (const trap of this.traps) {
      if (Math.abs(craft.y - trap.y) > 0.4) continue;
      if (Math.hypot(trap.x - craft.x, trap.z - craft.z) >= 1.6) continue;
      craft.trapCooldown = 2;
      if (trap.kind === "hold") {
        craft.held = 3;
        craft.vx = craft.vz = 0;
      } else {
        const angle = this.random() * Math.PI * 2;
        craft.vx = Math.sin(angle) * 30;
        craft.vz = -Math.cos(angle) * 30;
        craft.fling = 0.7;
      }
      if (craft.kind === "player") this.events.push(`trap:${trap.kind}`);
    }
  }

  private collect(dt: number): void {
    for (const craft of this.crafts) {
      if (craft.kind === "hunter") continue;
      this.takeFlags(craft);
      if (craft.kind === "player")
        for (const pod of this.pods) this.takePod(craft, pod);
    }
    for (const pod of this.pods)
      if (pod.respawn > 0) pod.respawn = Math.max(0, pod.respawn - dt);
  }

  private near(craft: Craft, thing: { x: number; y: number; z: number }) {
    return (
      Math.abs(craft.y - thing.y) < 1.4 &&
      Math.hypot(thing.x - craft.x, thing.z - craft.z) < 1.9
    );
  }

  private takeFlags(craft: Craft): void {
    const wanted: Team = craft.kind === "player" ? "blue" : "red";
    for (const flag of this.flags) {
      if (flag.taken || flag.owner !== wanted || !this.near(craft, flag))
        continue;
      flag.taken = true;
      if (craft.kind === "player") this.score += 100;
      this.events.push(`flag:${flag.owner}`);
      const pilot = this.pilots.find((candidate) => candidate.craft === craft);
      if (pilot) pilot.resting = 3;
    }
  }

  private takePod(craft: Craft, pod: Pod): void {
    if (pod.respawn > 0 || !this.near(craft, pod)) return;
    pod.respawn = 25;
    const kind =
      pod.kind === "random"
        ? randomPods[Math.floor(this.random() * randomPods.length)]!
        : pod.kind;
    if (harmful.has(kind) && craft.shield > 0) {
      this.events.push("pod:blocked");
      return;
    }
    this.applyPod(craft, kind);
    this.events.push(`pod:${kind}`);
  }

  private applyPod(craft: Craft, kind: PodKind): void {
    const effects: Partial<Record<PodKind, () => void>> = {
      green: () => (craft.boost = 6),
      red: () => (craft.slow = 5),
      shield: () => (craft.shield = 10),
      eraser: () => {
        this.explored.fill(0);
        this.lastCell = -1;
      },
      calm: () => (this.calm = 8),
      thief: () => {
        const flag = this.flags.find((f) => f.owner === "blue" && f.taken);
        if (flag) flag.taken = false;
      },
    };
    const effect = effects[kind];
    if (effect) effect();
    else if (kind in this.inventory) {
      const item = kind as keyof HoverWorld["inventory"];
      this.inventory[item] = Math.min(9, this.inventory[item] + 1);
    }
  }

  private fly(pilot: Pilot, dt: number): Controls {
    if (pilot.resting > 0) {
      pilot.resting -= dt;
      return emptyControls();
    }
    this.watch(pilot);
    this.plan(pilot, dt);
    const { craft } = pilot;
    const target = this.waypoint(pilot);
    const wanted = Math.atan2(target.x - craft.x, -(target.z - craft.z));
    return steerToward(pilot, wrapAngle(wanted - craft.heading), dt);
  }

  /** Hunters notice an uncloaked player in plain sight, with a ping. */
  private watch(pilot: Pilot): void {
    if (pilot.craft.kind !== "hunter") return;
    const { craft } = pilot;
    const player = this.player;
    const sees =
      player.cloak <= 0 &&
      Math.hypot(player.x - craft.x, player.z - craft.z) < cellSize * 7 &&
      this.arena.clearLine(craft.x, craft.z, player.x, player.z);
    if (sees && !pilot.sees) {
      this.events.push("spotted");
      pilot.replan = 0;
    }
    pilot.sees = sees;
  }

  private plan(pilot: Pilot, dt: number): void {
    pilot.replan -= dt;
    if (pilot.replan > 0 && pilot.field !== null) return;
    pilot.replan = 0.4 + this.random() * 0.2;
    const goal = this.goalFor(pilot);
    if (goal === pilot.goal && pilot.field !== null) return;
    pilot.goal = goal;
    pilot.field = this.arena.distanceTo(goal);
  }

  private cellIndexOf(thing: { x: number; z: number }): number {
    const { column, row } = this.arena.cellAt(thing.x, thing.z);
    return this.arena.index(column, row);
  }

  private goalFor(pilot: Pilot): number {
    const { craft } = pilot;
    if (craft.kind === "seeker") return this.nearestFlag(craft, "red");
    if (pilot.sees) return this.cellIndexOf(this.player);
    const here = this.cellIndexOf(craft);
    if (pilot.goal >= 0 && pilot.field?.[here] !== 0) return pilot.goal;
    return this.guardPost();
  }

  private nearestFlag(craft: Craft, owner: Team): number {
    let nearest = this.cellIndexOf(craft);
    let nearestDistance = Infinity;
    for (const flag of this.flags) {
      if (flag.taken || flag.owner !== owner) continue;
      const distance = Math.hypot(flag.x - craft.x, flag.z - craft.z);
      if (distance >= nearestDistance) continue;
      nearestDistance = distance;
      nearest = this.cellIndexOf(flag);
    }
    return nearest;
  }

  /** Hunters defend: they patrol near the blue flags still in play. */
  private guardPost(): number {
    const posts = this.flags.filter((f) => f.owner === "blue" && !f.taken);
    const post = posts[Math.floor(this.random() * posts.length)];
    const center = post
      ? this.arena.cellAt(post.x, post.z)
      : this.arena.cellAt(this.player.x, this.player.z);
    for (let attempt = 0; attempt < 20; attempt++) {
      const column = center.column + Math.floor(this.random() * 7) - 3;
      const row = center.row + Math.floor(this.random() * 7) - 3;
      if (!this.arena.isWall(column, row) && column > 0 && row > 0)
        return this.arena.index(column, row);
    }
    return this.arena.index(center.column, center.row);
  }

  private waypoint(pilot: Pilot): { x: number; z: number } {
    const field = pilot.field!;
    let cursor = this.cellIndexOf(pilot.craft);
    let best = field[cursor] ?? -1;
    for (let look = 0; look < 2; look++) {
      const next = this.arena
        .next(cursor)
        .find(
          (candidate) => field[candidate]! >= 0 && field[candidate]! < best,
        );
      if (next === undefined) break;
      best = field[next]!;
      cursor = next;
    }
    const cell = this.arena.cellOf(best === 0 ? pilot.goal : cursor);
    return this.arena.center(cell.column, cell.row);
  }
}

function steerToward(pilot: Pilot, error: number, dt: number): Controls {
  const { craft } = pilot;
  const controls = emptyControls();
  pilot.stuck = Math.hypot(craft.vx, craft.vz) < 1.2 ? pilot.stuck + dt : 0;
  if (pilot.stuck > 1.2) {
    pilot.stuck = 0;
    pilot.reversing = 0.6;
  }
  if (pilot.reversing > 0) {
    pilot.reversing -= dt;
    controls.reverse = true;
    controls.left = error > 0;
    controls.right = error <= 0;
    return controls;
  }
  controls.left = error < -0.08;
  controls.right = error > 0.08;
  controls.thrust = Math.abs(error) < 1.1;
  return controls;
}
