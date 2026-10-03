import {
  Arena,
  cellSize,
  mulberry32,
  placeFlags,
  stepUp,
  tierHeight,
  type Cell,
  type Point,
} from "./hover-arena.ts";
import { mazes } from "./hover-mazes.ts";

export { cellSize, tierHeight };
export const wallHeight = 4.5;
export const barrierHeight = 1.3;
const craftRadius = 1.1;
const revealRadius = 3;
/** Closing speed at which a ram knocks a carried flag loose. */
export const stealSpeed = 7;
const sightCells = 7;

export type PodKind =
  | "spring"
  | "barrier"
  | "cloak"
  | "green"
  | "red"
  | "shield"
  | "eraser"
  | "calm"
  | "random";
type TileKind = "push" | "stop" | "return";
export type CraftKind = "player" | "seeker" | "hunter";
export type GameState = "ready" | "playing" | "paused" | "cleared" | "lost";
type Team = "blue" | "red";

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
  tileCooldown: number;
  vx: number;
  vy: number;
  vz: number;
  x: number;
  y: number;
  z: number;
}

/** A flag stands on its stand, rides on the craft that took it, or lies loose
 * where a ram or a tile knocked it. */
interface Flag {
  carrier: Craft | null;
  home: Point;
  loose: boolean;
  owner: Team;
  settle: number;
  x: number;
  y: number;
  z: number;
}

interface Pod extends Point {
  kind: PodKind;
  respawn: number;
}

interface Tile extends Point {
  dx: number;
  dz: number;
  kind: TileKind;
}

interface Barrier extends Point {
  age: number;
  heading: number;
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
  fieldVersion: number;
  fleeing: number;
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
  "?": "random",
};
const tileKinds: Record<string, [TileKind, number, number]> = {
  u: ["push", 0, -1],
  d: ["push", 0, 1],
  l: ["push", -1, 0],
  r: ["push", 1, 0],
  x: ["stop", 0, 0],
  f: ["return", 0, 0],
};
const randomPods: readonly PodKind[] = [
  "spring",
  "barrier",
  "cloak",
  "green",
  "red",
  "shield",
  "eraser",
  "calm",
];
/** Power-downs, which a shield turns away. */
const harmful = new Set<PodKind>(["red", "eraser"]);

const tuning: Record<CraftKind, { thrust: number; top: number }> = {
  player: { thrust: 30, top: 17 },
  seeker: { thrust: 12, top: 6.5 },
  hunter: { thrust: 18, top: 10.5 },
};

const wrapAngle = (angle: number) =>
  Math.atan2(Math.sin(angle), Math.cos(angle));

const newCraft = (arena: Arena, kind: CraftKind, cell: Cell): Craft => ({
  ...arena.center(cell.column, cell.row),
  boost: 0,
  cloak: 0,
  fling: 0,
  heading: kind === "player" ? 0 : Math.PI,
  held: 0,
  kind,
  mass: kind === "hunter" ? 2.2 : 1,
  shield: 0,
  slow: 0,
  tileCooldown: 0,
  vx: 0,
  vy: 0,
  vz: 0,
});

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

function limitSpeed(craft: Craft, top: number): void {
  const limit = top * (craft.boost > 0 ? 1.5 : 1) * (craft.slow > 0 ? 0.45 : 1);
  const speed = Math.hypot(craft.vx, craft.vz);
  if (speed <= limit) return;
  craft.vx *= limit / speed;
  craft.vz *= limit / speed;
}

function tick(craft: Craft, dt: number): void {
  craft.boost = Math.max(0, craft.boost - dt);
  craft.slow = Math.max(0, craft.slow - dt);
  craft.cloak = Math.max(0, craft.cloak - dt);
  craft.shield = Math.max(0, craft.shield - dt);
  craft.held = Math.max(0, craft.held - dt);
  craft.fling = Math.max(0, craft.fling - dt);
  craft.tileCooldown = Math.max(0, craft.tileCooldown - dt);
}

/** Cells a dropped wall covers, for drones planning around it. */
function barrierCells(arena: Arena, barrier: Barrier): number[] {
  const cells = new Set<number>();
  for (const along of [-2, -1, 0, 1, 2]) {
    const x = barrier.x + Math.cos(barrier.heading) * along;
    const z = barrier.z + Math.sin(barrier.heading) * along;
    cells.add(arena.indexAt({ x, z }));
  }
  return [...cells];
}

/** Splits one drawn frame's time into equal physics steps of at most 1/60 s,
 * so every frame moves the world by exactly the time it shows (a fixed step
 * would leave some frames unmoved: half of them at 120 Hz). Long stalls are
 * capped so the game slows rather than jumps. */
export function frameSteps(seconds: number): number[] {
  const clamped = Math.min(Math.max(seconds, 0), 0.1);
  if (clamped === 0) return [];
  const count = Math.ceil(clamped * 60 - 1e-9);
  return Array.from({ length: count }, () => clamped / count);
}

interface WorldOptions {
  round?: number;
  score?: number;
  seed?: number;
}

/** Flags, drones, pods and tiles for one round in one maze. */
export class HoverWorld {
  readonly arena: Arena;
  readonly round: number;
  readonly seed: number;
  readonly crafts: Craft[] = [];
  readonly flags: Flag[] = [];
  readonly pods: Pod[] = [];
  readonly tiles: Tile[] = [];
  readonly barriers: Barrier[] = [];
  readonly inventory = { spring: 0, barrier: 0, cloak: 0 };
  readonly explored: Uint8Array;
  readonly events: string[] = [];
  readonly flagCount: number;
  state: GameState = "ready";
  time = 0;
  steps = 0;
  bumps = 0;
  steals = 0;
  calm = 0;
  score: number;
  private pilots: Pilot[] = [];
  private random: () => number;
  private previous = emptyControls();
  private lastCell = -1;
  private blocked = new Set<number>();
  private blockedVersion = 0;

  constructor({ round = 0, score = 0, seed = 1995 }: WorldOptions = {}) {
    this.round = round;
    this.score = score;
    this.seed = seed;
    this.arena = new Arena(mazes[round % mazes.length]!);
    this.explored = new Uint8Array(this.arena.width * this.arena.depth);
    this.random = mulberry32(seed * 31 + round);
    this.flagCount = Math.min(6, 3 + Math.floor(round / 3));
    const counts = {
      E: Math.min(3, 1 + Math.floor(round / 3)),
      G: Math.min(3, 1 + Math.floor((round + 1) / 2)),
    };
    const seekers: Cell[] = [];
    let player: Cell = { column: 1, row: 1 };
    this.arena.maze.things.forEach((line, row) =>
      [...line].forEach((thing, column) => {
        const cell = { column, row };
        if (thing === "P") player = cell;
        if (thing === "E" && counts.E > 0) seekers.push(cell);
        this.place(thing, cell, counts);
      }),
    );
    const stands = placeFlags(this.arena, this.flagCount, this.random, {
      player,
      seekers,
    });
    for (const [owner, points] of Object.entries(stands) as [Team, Point[]][])
      for (const point of points)
        this.flags.push({
          carrier: null,
          home: { ...point },
          loose: false,
          owner,
          settle: 0,
          ...point,
        });
    this.pilots = this.crafts
      .filter((craft) => craft.kind !== "player")
      .map((craft) => ({
        craft,
        field: null,
        fieldVersion: -1,
        fleeing: 0,
        goal: -1,
        replan: 0,
        resting: 0,
        reversing: 0,
        sees: false,
        stuck: 0,
      }));
    this.reveal();
  }

  private place(thing: string, cell: Cell, counts: { E: number; G: number }) {
    if (thing === "P") {
      this.crafts.unshift(newCraft(this.arena, "player", cell));
      return;
    }
    if ((thing === "E" || thing === "G") && counts[thing] > 0) {
      counts[thing] -= 1;
      this.crafts.push(
        newCraft(this.arena, thing === "E" ? "seeker" : "hunter", cell),
      );
      return;
    }
    const at = this.arena.center(cell.column, cell.row);
    const pod = podKinds[thing];
    if (pod) this.pods.push({ kind: pod, respawn: 0, ...at });
    const tile = tileKinds[thing];
    if (tile)
      this.tiles.push({ kind: tile[0], dx: tile[1], dz: tile[2], ...at });
  }

  get player(): Craft {
    return this.crafts[0]!;
  }

  carried(craft: Craft): Flag[] {
    return this.flags.filter((flag) => flag.carrier === craft);
  }

  /** Blue flags the player carries, or red flags the drones carry. */
  captured(team: "player" | "rival"): number {
    const owner: Team = team === "player" ? "blue" : "red";
    return this.flags.filter((flag) => flag.owner === owner && flag.carrier)
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
    this.ageBarriers(dt);
    for (const craft of this.crafts) this.touchTiles(craft);
    this.collect(dt);
    this.carry();
    this.reveal();
    this.finish();
  }

  private finish(): void {
    if (this.captured("player") >= this.flagCount) {
      const home = this.flags.filter((f) => f.owner === "red" && !f.carrier);
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
        const inside =
          c >= 0 && r >= 0 && c < this.arena.width && r < this.arena.depth;
        if (inside && dx * dx + dz * dz <= revealRadius * revealRadius + 1)
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
    this.rebuildBlocked();
    return true;
  }

  private ageBarriers(dt: number): void {
    for (const barrier of this.barriers) barrier.age += dt;
    let expired = false;
    while (this.barriers[0] && this.barriers[0].age > 15) {
      this.barriers.shift();
      expired = true;
    }
    if (expired) this.rebuildBlocked();
  }

  private rebuildBlocked(): void {
    this.blocked = new Set(
      this.barriers.flatMap((barrier) => barrierCells(this.arena, barrier)),
    );
    this.blockedVersion += 1;
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
    limitSpeed(craft, top * calmed * this.pace(craft));
  }

  /** Seekers start slow and quicken each round. */
  private pace(craft: Craft): number {
    return craft.kind === "seeker"
      ? Math.min(1.15, 0.62 + this.round * 0.07)
      : 1;
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
    if (craft.vy <= 0 && craft.y <= ground + 0.35) {
      craft.y = ground;
      craft.vy = 0;
      return;
    }
    craft.vy -= 28 * dt;
    craft.y = Math.max(ground, craft.y + craft.vy * dt);
    if (craft.y === ground) craft.vy = 0;
  }

  private blockCell(craft: Craft, column: number, row: number): void {
    const half = cellSize / 2;
    const centerX = (column + 0.5) * cellSize;
    const centerZ = (row + 0.5) * cellSize;
    const nearX = Math.min(
      Math.max(craft.x, column * cellSize + 0.01),
      (column + 1) * cellSize - 0.01,
    );
    const nearZ = Math.min(
      Math.max(craft.z, row * cellSize + 0.01),
      (row + 1) * cellSize - 0.01,
    );
    const solid =
      this.arena.isWall(column, row) ||
      this.arena.heightAt(nearX, nearZ) > craft.y + stepUp;
    if (!solid) return;
    this.pushOut(craft, {
      x: centerX,
      z: centerZ,
      halfWidth: half,
      halfDepth: half,
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
    if (closing > 3) this.ram(a, b, closing);
    const impulse = (1.8 * closing) / total;
    a.vx -= impulse * massB * nx;
    a.vz -= impulse * massB * nz;
    b.vx += impulse * massA * nx;
    b.vz += impulse * massA * nz;
  }

  /**
   * Rams are how flags change hands: a hard enough hit on a seeker knocks
   * one of your red flags loose, and a hunter's hard hit on you knocks one of
   * its blue flags loose, unless your shield is up.
   */
  private ram(a: Craft, b: Craft, closing: number): void {
    const player = a.kind === "player" ? a : b.kind === "player" ? b : null;
    if (!player) return;
    const other = player === a ? b : a;
    this.bumps += 1;
    this.events.push("bump");
    const pilot = this.pilots.find((candidate) => candidate.craft === other);
    // A hunter that lands a hit backs off before it comes again.
    if (other.kind === "hunter" && pilot) {
      pilot.reversing = 0.9;
      pilot.resting = 1.6;
    }
    if (closing >= stealSpeed) this.steal(player, other);
  }

  private steal(player: Craft, other: Craft): void {
    if (other.kind === "seeker" && this.knockLoose(other)) {
      this.steals += 1;
      this.events.push("steal");
    } else if (
      other.kind === "hunter" &&
      player.shield <= 0 &&
      this.knockLoose(player)
    )
      this.events.push("knocked");
  }

  /** Drops the carrier's latest flag beside it; true if it had one. */
  private knockLoose(carrier: Craft): boolean {
    const flag = this.carried(carrier).at(-1);
    if (!flag) return false;
    const angle = this.random() * Math.PI * 2;
    const x = carrier.x + Math.sin(angle) * 2.4;
    const z = carrier.z - Math.cos(angle) * 2.4;
    const cell = this.arena.cellAt(x, z);
    const open = !this.arena.isWall(cell.column, cell.row);
    flag.carrier = null;
    flag.loose = true;
    flag.settle = 1;
    flag.x = open ? x : carrier.x;
    flag.z = open ? z : carrier.z;
    flag.y = this.arena.heightAt(flag.x, flag.z);
    return true;
  }

  private sendHome(flag: Flag): void {
    flag.carrier = null;
    flag.loose = false;
    Object.assign(flag, flag.home);
  }

  private touchTiles(craft: Craft): void {
    if (craft.tileCooldown > 0) return;
    if (craft.kind === "player" && craft.shield > 0) return;
    for (const tile of this.tiles) {
      if (Math.abs(craft.y - tile.y) > 0.4) continue;
      if (Math.hypot(tile.x - craft.x, tile.z - craft.z) >= 1.6) continue;
      this.applyTile(craft, tile);
      // The cooldown starts once the tile's own effect is over, so a craft
      // can drive off a swirl before it catches it again.
      craft.tileCooldown = Math.max(craft.held, craft.fling) + 1.5;
    }
  }

  private applyTile(craft: Craft, tile: Tile): void {
    const mine = craft.kind === "player";
    if (tile.kind === "stop") {
      craft.held = 3;
      craft.vx = craft.vz = 0;
    } else if (tile.kind === "push") {
      craft.vx = tile.dx * 30;
      craft.vz = tile.dz * 30;
      craft.fling = 0.6;
    } else {
      const flag = this.carried(craft).at(-1);
      if (!flag) return;
      this.sendHome(flag);
      this.events.push(mine ? "returned:mine" : "returned:theirs");
      return;
    }
    if (mine) this.events.push(`tile:${tile.kind}`);
  }

  private collect(dt: number): void {
    for (const craft of this.crafts) {
      if (craft.kind === "hunter") continue;
      for (const flag of this.flags) this.touchFlag(craft, flag);
      if (craft.kind === "player")
        for (const pod of this.pods) this.takePod(craft, pod);
    }
    for (const pod of this.pods)
      if (pod.respawn > 0) pod.respawn = Math.max(0, pod.respawn - dt);
    for (const flag of this.flags) flag.settle = Math.max(0, flag.settle - dt);
  }

  private near(craft: Craft, thing: Point, reach = 1.9): boolean {
    return (
      Math.abs(craft.y - thing.y) < 1.4 &&
      Math.hypot(thing.x - craft.x, thing.z - craft.z) < reach
    );
  }

  /** The player takes blue flags and returns loose red ones; seekers take
   * red flags from their stands or the floor. */
  private touchFlag(craft: Craft, flag: Flag): void {
    if (flag.carrier || flag.settle > 0 || !this.near(craft, flag)) return;
    const player = craft.kind === "player";
    if (player && flag.owner === "red") this.rescue(flag);
    else if (flag.owner === (player ? "blue" : "red")) this.take(craft, flag);
  }

  private rescue(flag: Flag): void {
    if (!flag.loose) return;
    this.sendHome(flag);
    this.events.push("rescued");
    this.score += 50;
  }

  private take(craft: Craft, flag: Flag): void {
    flag.carrier = craft;
    flag.loose = false;
    if (craft.kind === "player") this.score += 100;
    this.events.push(`flag:${flag.owner}`);
    const pilot = this.pilots.find((candidate) => candidate.craft === craft);
    if (pilot) pilot.resting = Math.max(1.5, 4 - this.round * 0.3);
  }

  /** Carried flags ride on their craft. */
  private carry(): void {
    for (const flag of this.flags) {
      if (!flag.carrier) continue;
      flag.x = flag.carrier.x;
      flag.y = flag.carrier.y;
      flag.z = flag.carrier.z;
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

  /** Drones notice an uncloaked player in plain sight; hunters ping. */
  private watch(pilot: Pilot): void {
    const { craft } = pilot;
    const player = this.player;
    const sees =
      player.cloak <= 0 &&
      Math.hypot(player.x - craft.x, player.z - craft.z) <
        cellSize * sightCells &&
      this.arena.clearLine(craft, player);
    if (sees && !pilot.sees) {
      if (craft.kind === "hunter") this.events.push("spotted");
      pilot.replan = 0;
    }
    pilot.sees = sees;
  }

  private plan(pilot: Pilot, dt: number): void {
    pilot.replan -= dt;
    pilot.fleeing = Math.max(0, pilot.fleeing - dt);
    const stale =
      pilot.field === null || pilot.fieldVersion !== this.blockedVersion;
    if (pilot.replan > 0 && !stale) return;
    pilot.replan = 0.4 + this.random() * 0.2;
    const goal = this.goalFor(pilot);
    if (goal === pilot.goal && !stale) return;
    pilot.goal = goal;
    pilot.field = this.arena.distanceTo(goal, this.blocked);
    pilot.fieldVersion = this.blockedVersion;
  }

  private goalFor(pilot: Pilot): number {
    const { craft } = pilot;
    if (craft.kind === "seeker") return this.seekerGoal(pilot);
    if (pilot.sees) return this.arena.indexAt(this.player);
    const here = this.arena.indexAt(craft);
    if (pilot.goal >= 0 && pilot.field?.[here] !== 0) return pilot.goal;
    return this.guardPost();
  }

  /** Seekers fetch red flags, and flee with the ones they carry once they
   * see the player coming; a cloak lets the player close in. */
  private seekerGoal(pilot: Pilot): number {
    const { craft } = pilot;
    if (pilot.fleeing > 0) return pilot.goal;
    const close =
      Math.hypot(this.player.x - craft.x, this.player.z - craft.z) <
      cellSize * 4;
    if (pilot.sees && close && this.carried(craft).length > 0) {
      pilot.fleeing = 2.5;
      return this.escape(craft);
    }
    return this.nearestRedFlag(craft);
  }

  private escape(craft: Craft): number {
    const player = this.player;
    let best = this.arena.indexAt(craft);
    let bestDistance = -1;
    for (let attempt = 0; attempt < 8; attempt++) {
      const candidate = this.randomFloorNear(
        this.arena.cellAt(craft.x, craft.z),
        5,
      );
      const point = this.arena.cellOf(candidate);
      const distance = Math.hypot(
        (point.column + 0.5) * cellSize - player.x,
        (point.row + 0.5) * cellSize - player.z,
      );
      if (distance <= bestDistance) continue;
      bestDistance = distance;
      best = candidate;
    }
    return best;
  }

  private nearestRedFlag(craft: Craft): number {
    let nearest = this.arena.indexAt(craft);
    let nearestDistance = Infinity;
    for (const flag of this.flags) {
      if (flag.carrier || flag.owner !== "red") continue;
      const distance = Math.hypot(flag.x - craft.x, flag.z - craft.z);
      if (distance >= nearestDistance) continue;
      nearestDistance = distance;
      nearest = this.arena.indexAt(flag);
    }
    return nearest;
  }

  /** Hunters defend: they patrol near the blue flags still on their stands. */
  private guardPost(): number {
    const posts = this.flags.filter((f) => f.owner === "blue" && !f.carrier);
    const post = posts[Math.floor(this.random() * posts.length)] ?? this.player;
    return this.randomFloorNear(this.arena.cellAt(post.x, post.z), 3);
  }

  private randomFloorNear(center: Cell, spread: number): number {
    for (let attempt = 0; attempt < 20; attempt++) {
      const column =
        center.column + Math.floor(this.random() * (spread * 2 + 1)) - spread;
      const row =
        center.row + Math.floor(this.random() * (spread * 2 + 1)) - spread;
      if (!this.arena.isWall(column, row)) return this.arena.index(column, row);
    }
    return this.arena.index(center.column, center.row);
  }

  private waypoint(pilot: Pilot): { x: number; z: number } {
    const field = pilot.field!;
    let cursor = this.arena.indexAt(pilot.craft);
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
