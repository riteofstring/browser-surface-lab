import { fixtureColor } from "../shared/theme";
import { cellSize, type GameState, type HoverWorld } from "./hover-world";

const mapScale = 5;
const team = { blue: "#2f6de0", red: "#d8342c", green: "#3fae4a" };

// What each event means for the player, with the move it suggests.
const banners: Record<string, string | ((world: HoverWorld) => string)> = {
  "pod:spring": "Spring: A jumps onto ledges and over walls",
  "pod:barrier": "Wall: S drops it behind you",
  "pod:cloak": "Cloak: D hides you from drones",
  "pod:green": "Green light! Ram them now",
  "pod:red": "Red light! Slowed",
  "pod:shield": "Shield: rams and tiles can't touch you",
  "pod:eraser": "Map erased",
  "pod:calm": "Drones slowed",
  "pod:blocked": "Shield blocked it",
  "flag:blue": "Flag!",
  "flag:red": "They took a flag. Ram the blue car to knock it loose",
  steal: "Knocked it loose! Grab your flag",
  rescued: "Flag home",
  knocked: "Rammed! You dropped a flag",
  "returned:mine": "That tile sent a flag home",
  "returned:theirs": "Their flag went home",
  "tile:push": "Whoa!",
  "tile:stop": "Stuck!",
  spotted: (world) =>
    world.inventory.cloak > 0
      ? "Spotted! D to cloak"
      : world.inventory.barrier > 0
        ? "Spotted! S drops a wall behind you"
        : "Spotted!",
};

const pips = (count: number, total: number) =>
  "●".repeat(count) + "○".repeat(Math.max(0, total - count));

const clockText = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;

export const hudMarkup = `<div class="hover-hud" aria-hidden="true">
    <div class="hover-flags">
      <span class="hover-label">Blue</span><span class="hover-pips" data-team="blue"></span>
      <span class="hover-label">Red</span><span class="hover-pips" data-team="red"></span>
    </div>
    <div class="hover-mirror" hidden></div>
    <div class="hover-score"><span class="hover-label">Round <b data-round></b></span><output data-score></output><span data-clock></span></div>
    <div class="hover-items">
      <span><kbd>A</kbd>Spring <b data-item="spring"></b></span>
      <span><kbd>S</kbd>Wall <b data-item="barrier"></b></span>
      <span><kbd>D</kbd>Cloak <b data-item="cloak"></b></span>
    </div>
    <canvas class="hover-map"></canvas>
    <div class="hover-gauges"><div class="hover-speed"><i></i></div><span data-effects></span></div>
    <p class="hover-banner" hidden></p>
  </div>`;

interface Overlay {
  action: string;
  body: string;
  heading: string;
}

export function overlayFor(world: HoverWorld, best: number): Overlay | null {
  const maze = world.arena.maze.look.label;
  const goal = `Grab ${world.flagCount} blue flags before the blue cars take your ${world.flagCount} red ones. Ram a blue car to knock a flag loose; green hunters ram you to do the same.`;
  const copy: Record<Exclude<GameState, "playing">, Overlay> = {
    ready: {
      heading: "HOVER!",
      body: `Round ${world.round + 1} · ${maze}. ${goal}`,
      action: "Start",
    },
    paused: { heading: "Paused", body: "", action: "Resume" },
    cleared: {
      heading: `Round ${world.round + 1} cleared`,
      body: `Score ${world.score} · ${clockText(world.time)}`,
      action: "Next round",
    },
    lost: {
      heading: "Game over",
      body: `The drones took your flags. Score ${world.score}${best > 0 ? ` · best ${best}` : ""}`,
      action: "Play again",
    },
  };
  return world.state === "playing" ? null : copy[world.state];
}

/** The Hover!-style heads-up display: flags, mirror, score, items, radar. */
export function createHud(root: HTMLElement) {
  const find = <T extends HTMLElement>(selector: string) =>
    root.querySelector<T>(selector)!;
  const map = find<HTMLCanvasElement>(".hover-map");
  const mapContext = map.getContext("2d")!;
  const mirror = find<HTMLElement>(".hover-mirror");
  const banner = find<HTMLElement>(".hover-banner");
  const speed = find<HTMLElement>(".hover-speed i");
  const fields = {
    blue: find(".hover-pips[data-team=blue]"),
    red: find(".hover-pips[data-team=red]"),
    round: find("[data-round]"),
    score: find("[data-score]"),
    clock: find("[data-clock]"),
    effects: find("[data-effects]"),
  };
  const items = [...root.querySelectorAll<HTMLElement>("[data-item]")].map(
    (element) => ({
      element,
      item: element.dataset.item as keyof HoverWorld["inventory"],
    }),
  );
  const shown = new Map<HTMLElement, string>();
  const setText = (element: HTMLElement, text: string) => {
    if (shown.get(element) === text) return;
    shown.set(element, text);
    element.textContent = text;
  };
  let bannerTime = 0;
  let mirrorStyle: string | null = null;
  // Theme colours, read once per theme: each read draws and reads back a
  // canvas pixel, too slow for every radar redraw.
  let colors: { sunken: string; wall: string; tier: string } | null = null;
  const palette = () =>
    (colors ??= {
      sunken: fixtureColor(root, "surface-sunken"),
      wall: fixtureColor(root, "text-subtle"),
      tier: fixtureColor(root, "border"),
    });

  const effects = (world: HoverWorld) => {
    const player = world.player;
    const active: [string, number][] = [
      ["Boost", player.boost],
      ["Slow", player.slow],
      ["Shield", player.shield],
      ["Cloak", player.cloak],
      ["Calm", world.calm],
      ["Stuck", player.held],
    ];
    return active
      .filter(([, time]) => time > 0)
      .map(([name, time]) => `${name} ${Math.ceil(time)}`)
      .join(" · ");
  };

  // Hover!'s radar shows only what the player has explored.
  const drawTiles = (world: HoverWorld) => {
    const { arena } = world;
    if (map.width !== arena.width * mapScale) {
      map.width = arena.width * mapScale;
      map.height = arena.depth * mapScale;
    }
    mapContext.fillStyle = palette().sunken;
    mapContext.fillRect(0, 0, map.width, map.height);
    const colors: Record<string, string> = {
      "#": palette().wall,
      "=": palette().tier,
    };
    for (let index = 0; index < world.explored.length; index++) {
      const { column, row } = arena.cellOf(index);
      const color = world.explored[index]
        ? colors[arena.tile(column, row)]
        : undefined;
      if (!color) continue;
      mapContext.fillStyle = color;
      mapContext.fillRect(
        column * mapScale,
        row * mapScale,
        mapScale,
        mapScale,
      );
    }
  };

  const drawMarkers = (world: HoverWorld, clock: number) => {
    const { arena } = world;
    const scale = mapScale / cellSize;
    const dot = (x: number, z: number, color: string, size: number) => {
      const cell = arena.cellAt(x, z);
      if (!world.explored[arena.index(cell.column, cell.row)]) return;
      mapContext.fillStyle = color;
      mapContext.fillRect(
        x * scale - size / 2,
        z * scale - size / 2,
        size,
        size,
      );
    };
    for (const flag of world.flags)
      if (!flag.carrier) dot(flag.x, flag.z, team[flag.owner], 4);
    for (const craft of world.crafts.slice(1))
      dot(
        craft.x,
        craft.z,
        craft.kind === "seeker" ? team.blue : team.green,
        3,
      );
    const player = world.player;
    if (player.cloak <= 0 || Math.floor(clock * 6) % 2)
      dot(player.x, player.z, "#ffffff", 5);
  };

  const drawMap = (world: HoverWorld, clock: number) => {
    drawTiles(world);
    drawMarkers(world, clock);
  };

  return {
    themeChanged() {
      colors = null;
    },
    update(world: HoverWorld, clock: number, mirrorBox: Box | null) {
      setText(fields.blue, pips(world.captured("player"), world.flagCount));
      setText(fields.red, pips(world.captured("rival"), world.flagCount));
      setText(fields.round, String(world.round + 1));
      setText(fields.score, String(world.score).padStart(5, "0"));
      setText(fields.clock, clockText(world.time));
      setText(fields.effects, effects(world));
      for (const { element, item } of items)
        setText(element, `×${world.inventory[item]}`);
      const player = world.player;
      speed.style.transform = `scaleX(${Math.min(1, Math.hypot(player.vx, player.vz) / 25)})`;
      if (bannerTime && clock > bannerTime) {
        banner.hidden = true;
        bannerTime = 0;
      }
      // Only touch the frame's style when it moves, to spare a style pass.
      const frameStyle = mirrorBox
        ? `left:${mirrorBox.left}px;top:${mirrorBox.top}px;width:${mirrorBox.width}px;height:${mirrorBox.height}px`
        : "";
      if (frameStyle !== mirrorStyle) {
        mirrorStyle = frameStyle;
        mirror.hidden = mirrorBox === null;
        mirror.style.cssText = frameStyle;
      }
    },
    drawMap,
    announce(event: string, clock: number, world: HoverWorld) {
      const copy = banners[event];
      if (!copy) return;
      banner.textContent = typeof copy === "function" ? copy(world) : copy;
      banner.dataset.tone = event.split(":")[0];
      banner.hidden = false;
      bannerTime = clock + 2.2;
    },
  };
}

interface Box {
  height: number;
  left: number;
  top: number;
  width: number;
}
