export const cellSize = 4;
export const wallHeight = 2.6;
export const barrierHeight = 1.3;
const craftRadius = 1.1;
export const flagsToWin = 3;

const arena = [
  "#####################",
  "#j.....#..E..#.....r#",
  "#.###..#.....#..###.#",
  "#.#.....+.b.-.....#.#",
  "#.#..##.#####.##..#.#",
  "#...c#.........#w...#",
  "##.###.##...##.###.##",
  "#......#..D..#......#",
  "#.r.#..#.....#..#...#",
  "#...#...........#...#",
  "###.##.#.....#.##.###",
  "#...#...........#...#",
  "#...#..#.....#..#.b.#",
  "#......#..D..#......#",
  "##.###.##...##.###.##",
  "#...w#.........#c...#",
  "#.#..##.#####.##..#.#",
  "#.#.....-.r.+.....#.#",
  "#.###..#.....#..###.#",
  "#b.....#..P..#.....j#",
  "#####################",
];

type Team = "player" | "rival";
export type PodKind = "spring" | "barrier" | "cloak" | "speed" | "slow";
export type GameState = "ready" | "playing" | "paused" | "won" | "lost";

export interface Craft {
  airborne: number;
  boost: number;
  cloak: number;
  heading: number;
  kind: "player" | "rival" | "dumbot";
  mass: number;
  slow: number;
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
  z: number;
}

interface Pod {
  kind: PodKind;
  respawn: number;
  x: number;
  z: number;
}

interface Barrier {
  age: number;
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

interface Box {
  halfDepth: number;
  halfWidth: number;
  heading: number;
  x: number;
  z: number;
}

interface Pilot {
  craft: Craft;
  field: Int16Array | null;
  goal: number;
  replan: number;
  resting: number;
  reversing: number;
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

const width = arena[0]!.length;
const depth = arena.length;
if (arena.some((row) => row.length !== width))
  throw new Error("Hover arena rows differ in length");

export const arenaSize = { width, depth };

export const isWall = (column: number, row: number): boolean =>
  arena[row]?.[column] === undefined || arena[row]![column] === "#";

export const wallCells = (): { column: number; row: number }[] => {
  const cells: { column: number; row: number }[] = [];
  for (let row = 0; row < depth; row++)
    for (let column = 0; column < width; column++)
      if (
        isWall(column, row) &&
        [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ].some(([dx, dz]) => {
          const value = arena[row + dz!]?.[column + dx!];
          return value !== undefined && value !== "#";
        })
      )
        cells.push({ column, row });
  return cells;
};

const cellCenter = (column: number, row: number) => ({
  x: (column + 0.5) * cellSize,
  z: (row + 0.5) * cellSize,
});

const cellAt = (x: number, z: number) => ({
  column: Math.floor(x / cellSize),
  row: Math.floor(z / cellSize),
});

const cellIndex = (column: number, row: number) => row * width + column;

function distanceField(goal: number): Int16Array {
  const field = new Int16Array(width * depth).fill(-1);
  const queue = [goal];
  field[goal] = 0;
  for (let head = 0; head < queue.length; head++) {
    const index = queue[head]!;
    const column = index % width;
    const row = Math.floor(index / width);
    for (const [dx, dz] of neighbours) {
      const next = cellIndex(column + dx, row + dz);
      if (isWall(column + dx, row + dz) || field[next] !== -1) continue;
      field[next] = field[index]! + 1;
      queue.push(next);
    }
  }
  return field;
}

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

const wrapAngle = (angle: number) =>
  Math.atan2(Math.sin(angle), Math.cos(angle));

const newCraft = (
  kind: Craft["kind"],
  column: number,
  row: number,
  heading: number,
): Craft => ({
  ...cellCenter(column, row),
  airborne: 0,
  boost: 0,
  cloak: 0,
  heading,
  kind,
  mass: kind === "dumbot" ? 2.2 : 1,
  slow: 0,
  vx: 0,
  vy: 0,
  vz: 0,
  y: 0,
});

function fall(craft: Craft, dt: number): void {
  if (craft.y > 0 || craft.vy > 0) {
    craft.vy -= 28 * dt;
    craft.y = Math.max(0, craft.y + craft.vy * dt);
    if (craft.y === 0) craft.vy = 0;
  }
  craft.airborne = craft.y > 0.05 ? 1 : 0;
}

function limitSpeed(craft: Craft, top: number): void {
  const limit =
    top * (craft.boost > 0 ? 1.55 : 1) * (craft.slow > 0 ? 0.45 : 1);
  const speed = Math.hypot(craft.vx, craft.vz);
  if (speed <= limit) return;
  craft.vx *= limit / speed;
  craft.vz *= limit / speed;
}

const podKinds: Record<string, PodKind> = {
  j: "spring",
  w: "barrier",
  c: "cloak",
  "+": "speed",
  "-": "slow",
};

const tuning = {
  player: { thrust: 30, top: 17 },
  rival: { thrust: 12, top: 6.5 },
  dumbot: { thrust: 17, top: 9.5 },
};

export class HoverWorld {
  readonly crafts: Craft[] = [];
  readonly flags: Flag[] = [];
  readonly pods: Pod[] = [];
  readonly barriers: Barrier[] = [];
  readonly inventory = { spring: 1, barrier: 1, cloak: 1 };
  state: GameState = "ready";
  time = 0;
  steps = 0;
  bumps = 0;
  private pilots: Pilot[] = [];
  private random: () => number;
  private previous = emptyControls();

  constructor(seed = 1995) {
    this.random = mulberry32(seed);
    arena.forEach((line, row) =>
      [...line].forEach((value, column) => {
        const center = cellCenter(column, row);
        if (value === "P")
          this.crafts.unshift(newCraft("player", column, row, 0));
        else if (value === "E")
          this.crafts.push(newCraft("rival", column, row, Math.PI));
        else if (value === "D")
          this.crafts.push(
            newCraft("dumbot", column, row, row < depth / 2 ? Math.PI : 0),
          );
        else if (value === "r")
          this.flags.push({ owner: "rival", taken: false, ...center });
        else if (value === "b")
          this.flags.push({ owner: "player", taken: false, ...center });
        else if (podKinds[value])
          this.pods.push({ kind: podKinds[value]!, respawn: 0, ...center });
      }),
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
        stuck: 0,
      }));
  }

  get player(): Craft {
    return this.crafts[0]!;
  }

  captured(team: Team): number {
    const target: Team = team === "player" ? "rival" : "player";
    return this.flags.filter((flag) => flag.owner === target && flag.taken)
      .length;
  }

  score(): number {
    const flags = this.captured("player") * 250;
    return this.state === "won"
      ? flags + Math.max(0, Math.round((240 - this.time) * 10))
      : flags;
  }

  step(dt: number, controls: Controls): void {
    if (this.state !== "playing") return;
    this.steps += 1;
    this.time += dt;
    this.useItems(controls);
    this.drive(this.player, controls, dt);
    for (const pilot of this.pilots)
      this.drive(pilot.craft, this.fly(pilot, dt), dt);
    for (const craft of this.crafts) this.move(craft, dt);
    this.collideCrafts();
    for (const barrier of this.barriers) barrier.age += dt;
    while (this.barriers[0] && this.barriers[0].age > 12) this.barriers.shift();
    this.collect(dt);
    if (this.captured("player") >= flagsToWin) this.state = "won";
    else if (this.captured("rival") >= flagsToWin) this.state = "lost";
  }

  private useItems(controls: Controls): void {
    const player = this.player;
    const uses: [
      keyof HoverWorld["inventory"],
      keyof Controls,
      () => boolean,
    ][] = [
      [
        "spring",
        "jump",
        () => {
          if (player.y > 0.01) return false;
          player.vy = 11.5;
          return true;
        },
      ],
      [
        "barrier",
        "barrier",
        () => {
          this.barriers.push({
            age: 0,
            heading: player.heading,
            x: player.x - Math.sin(player.heading) * 2.8,
            z: player.z + Math.cos(player.heading) * 2.8,
          });
          if (this.barriers.length > 3) this.barriers.shift();
          return true;
        },
      ],
      [
        "cloak",
        "cloak",
        () => {
          player.cloak = 6;
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
      )
        this.inventory[item] -= 1;
    this.previous = { ...controls };
  }

  private drive(craft: Craft, controls: Controls, dt: number): void {
    const { thrust, top } = tuning[craft.kind];
    const turn = (controls.right ? 1 : 0) - (controls.left ? 1 : 0);
    craft.heading = wrapAngle(craft.heading + turn * 2.7 * dt);
    const forwardX = Math.sin(craft.heading);
    const forwardZ = -Math.cos(craft.heading);
    const power = craft.airborne > 0 ? 0.25 : 1;
    const push =
      ((controls.thrust ? 1 : 0) - (controls.reverse ? 0.6 : 0)) *
      thrust *
      power;
    craft.vx += forwardX * push * dt;
    craft.vz += forwardZ * push * dt;
    const along = craft.vx * forwardX + craft.vz * forwardZ;
    const sideX = craft.vx - along * forwardX;
    const sideZ = craft.vz - along * forwardZ;
    const grip = Math.exp(-(craft.airborne > 0 ? 0.3 : 2.4) * dt);
    const drag = Math.exp(-0.75 * dt);
    craft.vx = (along * forwardX + sideX * grip) * drag;
    craft.vz = (along * forwardZ + sideZ * grip) * drag;
    limitSpeed(craft, top);
    craft.boost = Math.max(0, craft.boost - dt);
    craft.slow = Math.max(0, craft.slow - dt);
    craft.cloak = Math.max(0, craft.cloak - dt);
  }

  private move(craft: Craft, dt: number): void {
    craft.x += craft.vx * dt;
    craft.z += craft.vz * dt;
    fall(craft, dt);
    const { column, row } = cellAt(craft.x, craft.z);
    for (let dz = -1; dz <= 1; dz++)
      for (let dx = -1; dx <= 1; dx++)
        if (isWall(column + dx, row + dz))
          this.pushOut(craft, {
            x: (column + dx + 0.5) * cellSize,
            z: (row + dz + 0.5) * cellSize,
            halfWidth: cellSize / 2,
            halfDepth: cellSize / 2,
            heading: 0,
          });
    if (craft.y < barrierHeight)
      for (const barrier of this.barriers)
        this.pushOut(craft, {
          x: barrier.x,
          z: barrier.z,
          halfWidth: 2.3,
          halfDepth: 0.35,
          heading: barrier.heading,
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
    const depthIn = craftRadius - distance;
    craft.x += worldX * depthIn;
    craft.z += worldZ * depthIn;
    const into = craft.vx * worldX + craft.vz * worldZ;
    if (into < 0) {
      craft.vx -= 1.6 * into * worldX;
      craft.vz -= 1.6 * into * worldZ;
      if (into < -6 && craft.kind === "player") this.bumps += 1;
    }
  }

  private collideCrafts(): void {
    for (let first = 0; first < this.crafts.length; first++)
      for (let second = first + 1; second < this.crafts.length; second++)
        this.bump(this.crafts[first]!, this.crafts[second]!);
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
    const total = a.mass + b.mass;
    const overlap = reach - distance;
    a.x -= nx * overlap * (b.mass / total);
    a.z -= nz * overlap * (b.mass / total);
    b.x += nx * overlap * (a.mass / total);
    b.z += nz * overlap * (a.mass / total);
    const closing = (a.vx - b.vx) * nx + (a.vz - b.vz) * nz;
    if (closing <= 0) return;
    if (closing > 3) this.recordBump(a, b);
    const impulse = (1.8 * closing) / total;
    a.vx -= impulse * b.mass * nx;
    a.vz -= impulse * b.mass * nz;
    b.vx += impulse * a.mass * nx;
    b.vz += impulse * a.mass * nz;
  }

  private recordBump(a: Craft, b: Craft): void {
    if (a.kind !== "player" && b.kind !== "player") return;
    this.bumps += 1;
    const bot = [a, b].find((craft) => craft.kind === "dumbot");
    const pilot = this.pilots.find((candidate) => candidate.craft === bot);
    if (pilot) pilot.reversing = 0.9;
  }

  private collect(dt: number): void {
    for (const craft of this.crafts) {
      if (craft.kind === "dumbot" || craft.y > 1.5) continue;
      this.takeFlags(craft);
      for (const pod of this.pods) this.takePod(craft, pod);
    }
    for (const pod of this.pods)
      if (pod.respawn > 0) pod.respawn = Math.max(0, pod.respawn - dt);
  }

  private takeFlags(craft: Craft): void {
    const team: Team = craft.kind === "player" ? "player" : "rival";
    for (const flag of this.flags) {
      if (flag.taken || flag.owner === team) continue;
      if (Math.hypot(flag.x - craft.x, flag.z - craft.z) >= 1.9) continue;
      flag.taken = true;
      const pilot = this.pilots.find((candidate) => candidate.craft === craft);
      if (pilot) pilot.resting = 3;
    }
  }

  private takePod(craft: Craft, pod: Pod): void {
    if (pod.respawn > 0) return;
    if (Math.hypot(pod.x - craft.x, pod.z - craft.z) >= 1.9) return;
    if (pod.kind === "speed") craft.boost = 4;
    else if (pod.kind === "slow") craft.slow = 3;
    else if (craft.kind === "player") this.inventory[pod.kind] += 1;
    else return;
    pod.respawn = 15;
  }

  private fly(pilot: Pilot, dt: number): Controls {
    if (pilot.resting > 0) {
      pilot.resting -= dt;
      return emptyControls();
    }
    this.plan(pilot, dt);
    const { craft } = pilot;
    const target = waypoint(pilot.field!, pilot.goal, cellAt(craft.x, craft.z));
    const wanted = Math.atan2(target.x - craft.x, -(target.z - craft.z));
    const error = wrapAngle(wanted - craft.heading);
    return steerToward(pilot, error, dt);
  }

  private plan(pilot: Pilot, dt: number): void {
    pilot.replan -= dt;
    if (pilot.replan > 0 && pilot.field !== null) return;
    pilot.replan = 0.4 + this.random() * 0.2;
    const goal = this.goalFor(pilot);
    if (goal === pilot.goal && pilot.field !== null) return;
    pilot.goal = goal;
    pilot.field = distanceField(goal);
  }

  private playerCell(): number {
    const { column, row } = cellAt(this.player.x, this.player.z);
    return cellIndex(column, row);
  }

  private goalFor(pilot: Pilot): number {
    const { craft } = pilot;
    const here = cellAt(craft.x, craft.z);
    if (craft.kind === "rival") return this.nearestFlag(here);
    const player = this.player;
    if (
      player.cloak <= 0 &&
      Math.hypot(player.x - craft.x, player.z - craft.z) < cellSize * 5
    )
      return this.playerCell();
    if (
      pilot.goal >= 0 &&
      pilot.field?.[cellIndex(here.column, here.row)] !== 0
    )
      return pilot.goal;
    return this.randomFloor();
  }

  private nearestFlag(here: { column: number; row: number }): number {
    let nearest = cellIndex(here.column, here.row);
    let nearestDistance = Infinity;
    for (const flag of this.flags) {
      if (flag.taken || flag.owner !== "player") continue;
      const cell = cellAt(flag.x, flag.z);
      const distance =
        Math.abs(cell.column - here.column) + Math.abs(cell.row - here.row);
      if (distance >= nearestDistance) continue;
      nearestDistance = distance;
      nearest = cellIndex(cell.column, cell.row);
    }
    return nearest;
  }

  private randomFloor(): number {
    for (;;) {
      const column = 1 + Math.floor(this.random() * (width - 2));
      const row = 1 + Math.floor(this.random() * (depth - 2));
      if (!isWall(column, row)) return cellIndex(column, row);
    }
  }
}

const neighbours = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;

function downhill(
  field: Int16Array,
  cursor: { column: number; row: number },
  best: number,
): { column: number; row: number; value: number } | null {
  let next: { column: number; row: number; value: number } | null = null;
  for (const [dx, dz] of neighbours) {
    const column = cursor.column + dx;
    const row = cursor.row + dz;
    const value = field[cellIndex(column, row)];
    if (value === undefined || value < 0 || isWall(column, row)) continue;
    if (best >= 0 && value >= best) continue;
    best = value;
    next = { column, row, value };
  }
  return next;
}

function waypoint(
  field: Int16Array,
  goal: number,
  here: { column: number; row: number },
): { x: number; z: number } {
  let target = cellCenter(here.column, here.row);
  let best = field[cellIndex(here.column, here.row)] ?? -1;
  let cursor = here;
  for (let look = 0; look < 2; look++) {
    const next = downhill(field, cursor, best);
    if (!next) break;
    best = next.value;
    cursor = next;
    target = cellCenter(next.column, next.row);
  }
  return best === 0 && goal >= 0
    ? cellCenter(goal % width, Math.floor(goal / width))
    : target;
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
