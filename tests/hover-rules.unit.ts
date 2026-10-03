import assert from "node:assert/strict";
import { test } from "node:test";

import { Arena } from "../src/fixtures/hover-arena.ts";
import {
  cellSize,
  emptyControls,
  frameSteps,
  HoverWorld,
  stealSpeed,
  tierHeight,
  type Craft,
} from "../src/fixtures/hover-world.ts";

const playing = (options: ConstructorParameters<typeof HoverWorld>[0] = {}) => {
  const world = new HoverWorld(options);
  world.state = "playing";
  return world;
};
const drift = (world: HoverWorld, seconds: number) => {
  for (let step = 0; step < seconds * 60; step++)
    world.step(1 / 60, emptyControls());
};
const kind = (world: HoverWorld, wanted: Craft["kind"]) =>
  world.crafts.find((craft) => craft.kind === wanted)!;
const park = (craft: Craft, x: number, z: number) => {
  Object.assign(craft, { x, z, vx: 0, vz: 0, vy: 0 });
};
const cellDistance = (
  a: { x: number; z: number },
  b: { x: number; z: number },
) => (Math.abs(a.x - b.x) + Math.abs(a.z - b.z)) / cellSize;

test("flags land at random per seed, spaced apart and away from their takers", () => {
  const first = new HoverWorld({ seed: 7 }).flags.map((f) => [f.x, f.z]);
  assert.deepEqual(
    new HoverWorld({ seed: 7 }).flags.map((f) => [f.x, f.z]),
    first,
  );
  assert.notDeepEqual(
    new HoverWorld({ seed: 8 }).flags.map((f) => [f.x, f.z]),
    first,
  );
  for (const seed of [1, 2, 3, 4, 5]) {
    const world = new HoverWorld({ seed });
    const blue = world.flags.filter((f) => f.owner === "blue");
    assert.equal(blue.length, 3);
    assert.equal(world.flags.length, 6);
    // Fair by driving distance: a moderate run for the player, a longer
    // one for the slower seekers.
    const drive = (
      from: { x: number; z: number },
      to: { x: number; z: number },
    ) =>
      world.arena.distanceTo(world.arena.indexAt(to))[
        world.arena.indexAt(from)
      ]!;
    const seekers = world.crafts.filter((craft) => craft.kind === "seeker");
    for (const flag of blue) assert.ok(drive(world.player, flag) >= 7);
    for (const flag of world.flags.filter((f) => f.owner === "red"))
      assert.ok(
        Math.min(...seekers.map((seeker) => drive(seeker, flag))) >= 16,
      );
    for (const [index, flag] of world.flags.entries())
      for (const other of world.flags.slice(index + 1))
        assert.ok(cellDistance(flag, other) >= 4);
  }
  assert.equal(new HoverWorld({ round: 6 }).flags.length, 10);
});

test("the player takes a blue flag by touching it and wins with all of them", () => {
  const world = playing();
  const blue = world.flags.filter((f) => f.owner === "blue");
  for (const flag of blue) {
    park(world.player, flag.x, flag.z);
    world.player.y = flag.y;
    world.step(1 / 60, emptyControls());
  }
  assert.equal(world.captured("player"), 3);
  assert.equal(world.state, "cleared");
  assert.ok(world.score >= 300);
});

test("a hard ram knocks a red flag loose from a seeker, and touching it sends it home", () => {
  const world = playing();
  const seeker = kind(world, "seeker");
  const flag = world.flags.find((f) => f.owner === "red")!;
  flag.carrier = seeker;
  park(seeker, 42, 70);
  seeker.y = 0;
  const player = world.player;
  park(player, 42, 72.3);
  player.vz = -(stealSpeed + 6);
  world.step(1 / 60, emptyControls());
  assert.equal(flag.carrier, null);
  assert.equal(flag.loose, true);
  assert.equal(world.steals, 1);
  drift(world, 1.2);
  if (flag.carrier) return assert.fail("the seeker took the loose flag back");
  park(player, flag.x, flag.z);
  player.y = flag.y;
  world.step(1 / 60, emptyControls());
  assert.equal(flag.loose, false);
  assert.deepEqual([flag.x, flag.z], [flag.home.x, flag.home.z]);
});

test("a gentle nudge steals nothing", () => {
  const world = playing();
  const seeker = kind(world, "seeker");
  const flag = world.flags.find((f) => f.owner === "red")!;
  flag.carrier = seeker;
  park(seeker, 42, 70);
  park(world.player, 42, 72.15);
  world.player.vz = -2;
  world.step(1 / 60, emptyControls());
  assert.ok(world.bumps === 0 && Math.abs(world.player.z - 70) < 2.3);
  assert.equal(flag.carrier, seeker);
});

test("a hunter's ram knocks a blue flag off the player unless the shield is up", () => {
  for (const shield of [0, 5]) {
    const world = playing();
    const hunter = kind(world, "hunter");
    const flag = world.flags.find((f) => f.owner === "blue")!;
    flag.carrier = world.player;
    park(world.player, 42, 70);
    world.player.shield = shield;
    park(hunter, 42, 72.3);
    hunter.vz = -(stealSpeed + 6);
    world.step(1 / 60, emptyControls());
    assert.equal(flag.carrier === null, shield === 0);
  }
});

test("a flag-return tile sends the carried flag back to its stand", () => {
  const world = playing();
  const tile = world.tiles.find((t) => t.kind === "return")!;
  const flag = world.flags.find((f) => f.owner === "blue")!;
  flag.carrier = world.player;
  park(world.player, tile.x, tile.z);
  world.player.y = tile.y;
  world.step(1 / 60, emptyControls());
  assert.equal(flag.carrier, null);
  assert.deepEqual([flag.x, flag.z], [flag.home.x, flag.home.z]);
  assert.ok(world.events.includes("returned:mine"));
});

test("arrow tiles push the way they point and swirls hold", () => {
  const world = playing();
  const arrow = world.tiles.find((t) => t.kind === "push")!;
  park(world.player, arrow.x, arrow.z);
  world.player.y = arrow.y;
  world.step(1 / 60, emptyControls());
  const along = world.player.vx * arrow.dx + world.player.vz * arrow.dz;
  assert.ok(along > 20);
  const swirl = world.tiles.find((t) => t.kind === "stop")!;
  world.player.tileCooldown = 0;
  park(world.player, swirl.x, swirl.z);
  world.player.y = swirl.y;
  world.step(1 / 60, emptyControls());
  assert.ok(world.player.held > 2);
});

test("a dropped wall makes drones plan the long way round", () => {
  const arena = new Arena(new HoverWorld().arena.maze);
  const goal = arena.index(10, 4);
  const from = arena.index(10, 1);
  const open = arena.distanceTo(goal)[from]!;
  const walled = arena.distanceTo(
    goal,
    new Set([arena.index(10, 2), arena.index(10, 3)]),
  )[from]!;
  assert.ok(open > 0);
  assert.ok(walled > open);
});

test("hunters spot an uncloaked player in plain sight, but not a cloaked one", () => {
  for (const cloak of [0, 5]) {
    const world = playing();
    const hunter = kind(world, "hunter");
    const player = world.player;
    park(hunter, player.x, player.z - cellSize * 2);
    player.cloak = cloak;
    world.step(1 / 60, emptyControls());
    assert.equal(world.events.includes("spotted"), cloak === 0);
  }
});

test("a spring lifts the player onto a ledge it cannot drive up", () => {
  const climb = (spring: boolean) => {
    const world = playing();
    // Just south of the castle's north-west tower, facing it.
    assert.equal(world.arena.tile(2, 2), "=");
    const player = world.player;
    park(player, 2.5 * cellSize, 3.5 * cellSize);
    player.y = 0;
    player.heading = 0;
    world.inventory.spring = 1;
    world.step(1 / 60, { ...emptyControls(), jump: spring, thrust: true });
    for (let step = 0; step < 90; step++)
      world.step(1 / 60, { ...emptyControls(), thrust: true });
    return world.player.y;
  };
  assert.equal(climb(false), 0);
  assert.equal(climb(true), tierHeight);
});

test("the drones win once they carry all the red flags", () => {
  const world = playing();
  const seeker = kind(world, "seeker");
  for (const flag of world.flags.filter((f) => f.owner === "red"))
    flag.carrier = seeker;
  world.step(1 / 60, emptyControls());
  assert.equal(world.state, "lost");
});

test("every drawn frame moves the world by exactly its own time", () => {
  for (const hz of [60, 120, 144, 30]) {
    const slices = frameSteps(1 / hz);
    assert.ok(slices.length >= 1, `${hz} Hz frames must not stand still`);
    assert.ok(Math.abs(slices.reduce((a, b) => a + b, 0) - 1 / hz) < 1e-9);
    for (const slice of slices) assert.ok(slice <= 1 / 60 + 1e-9);
  }
  assert.deepEqual(frameSteps(0), []);
  // A long stall advances at most a tenth of a second.
  const stall = frameSteps(1).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(stall - 0.1) < 1e-9);
});

test("a car moves the same distance whatever the frame rate", () => {
  const travel = (hz: number) => {
    const world = playing();
    const thrust = { ...emptyControls(), thrust: true };
    for (let frame = 0; frame < hz; frame++)
      for (const slice of frameSteps(1 / hz)) world.step(slice, thrust);
    return world.player.z;
  };
  const at60 = travel(60);
  assert.ok(Math.abs(travel(120) - at60) < 0.5);
  assert.ok(Math.abs(travel(144) - at60) < 0.5);
});
