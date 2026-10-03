import type { FixtureHandle, FixtureMountOptions } from "./contract";
import { createFixtureLifecycle } from "./lifecycle";
import { fixtureColor, observeFixtureTheme } from "../shared/theme";
import { createHoverRenderer, type HoverRenderer } from "./hover-render";
import {
  arenaSize,
  cellSize,
  emptyControls,
  flagsToWin,
  HoverWorld,
  isWall,
  type Controls,
  type GameState,
} from "./hover-world";
import "./hover.css";

const step = 1 / 60;
const mapScale = 5;

const driveKeys: Record<string, keyof Controls> = {
  ArrowUp: "thrust",
  ArrowDown: "reverse",
  ArrowLeft: "left",
  ArrowRight: "right",
};
const itemKeys: Record<string, keyof Controls> = {
  a: "jump",
  " ": "jump",
  s: "barrier",
  d: "cloak",
};

const touchButtons: [keyof Controls, string, string][] = [
  ["left", "◀", "Turn left"],
  ["thrust", "▲", "Thrust"],
  ["reverse", "▼", "Reverse"],
  ["right", "▶", "Turn right"],
  ["jump", "A", "Jump"],
  ["barrier", "S", "Drop a wall"],
  ["cloak", "D", "Cloak"],
];

const overlays: Record<
  Exclude<GameState, "playing">,
  { heading: string; body: string; action: string }
> = {
  ready: {
    heading: "HOVER!",
    body: `Grab ${flagsToWin} flags in your rival's colour before its hovercraft takes yours.`,
    action: "Start",
  },
  paused: { heading: "Paused", body: "", action: "Resume" },
  won: { heading: "You win!", body: "", action: "Play again" },
  lost: {
    heading: "Out-flagged",
    body: "The rival took your flags.",
    action: "Try again",
  },
};

const pips = (count: number) =>
  "●".repeat(count) + "○".repeat(Math.max(0, flagsToWin - count));

const clockText = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;

export function createHoverFixture(
  container: HTMLElement,
  options: FixtureMountOptions = {},
): FixtureHandle {
  const root = document.createElement("section");
  container.replaceChildren(root);
  root.className = "surface hover";
  root.tabIndex = 0;
  root.setAttribute(
    "aria-label",
    "Hover! Arrow keys drive, A or Space jumps, S drops a wall, D cloaks, Enter starts or pauses.",
  );
  root.innerHTML = `<div class="hover-viewport"></div>
  <div class="hover-hud" aria-hidden="true">
    <div class="hover-score">
      <span class="hover-label">You</span><span class="hover-pips" data-team="player"></span>
      <span class="hover-label">Rival</span><span class="hover-pips" data-team="rival"></span>
    </div>
    <output class="hover-clock"></output>
    <div class="hover-items">
      <span><kbd>A</kbd>Jump <b data-item="spring"></b></span>
      <span><kbd>S</kbd>Wall <b data-item="barrier"></b></span>
      <span><kbd>D</kbd>Cloak <b data-item="cloak"></b></span>
    </div>
    <canvas class="hover-map" width="${arenaSize.width * mapScale}" height="${arenaSize.depth * mapScale}"></canvas>
  </div>
  <div class="hover-overlay">
    <h2></h2><p class="hover-message"></p>
    <button type="button" class="hover-action"></button>
    <p class="hover-help">Arrows drive · A/Space jump · S wall · D cloak · Enter pause</p>
  </div>
  <div class="hover-touch">${touchButtons
    .map(
      ([control, symbol, label]) =>
        `<button type="button" data-control="${control}" aria-label="${label}">${symbol}</button>`,
    )
    .join("")}</div>
  <div class="hover-error" hidden><p role="alert"></p><button type="button">Retry graphics</button></div>`;
  const viewport = root.querySelector<HTMLElement>(".hover-viewport")!;
  const overlay = root.querySelector<HTMLElement>(".hover-overlay")!;
  const heading = overlay.querySelector("h2")!;
  const message = overlay.querySelector<HTMLElement>(".hover-message")!;
  const action = overlay.querySelector<HTMLButtonElement>(".hover-action")!;
  const clock = root.querySelector<HTMLOutputElement>(".hover-clock")!;
  const map = root.querySelector<HTMLCanvasElement>(".hover-map")!;
  const mapContext = map.getContext("2d")!;
  const playerPips = root.querySelector<HTMLElement>('[data-team="player"]')!;
  const rivalPips = root.querySelector<HTMLElement>('[data-team="rival"]')!;
  const items = {
    spring: root.querySelector<HTMLElement>('[data-item="spring"]')!,
    barrier: root.querySelector<HTMLElement>('[data-item="barrier"]')!,
    cloak: root.querySelector<HTMLElement>('[data-item="cloak"]')!,
  };
  const error = root.querySelector<HTMLElement>(".hover-error")!;
  const retry = error.querySelector("button")!;
  const mapBase = document.createElement("canvas");
  mapBase.width = map.width;
  mapBase.height = map.height;

  let world = new HoverWorld();
  let controls = emptyControls();
  let view: HoverRenderer | null = null;
  let running = false;
  let supported = true;
  let animationFrame = 0;
  let previous = 0;
  let accumulator = 0;
  let elapsed = 0;
  let frames = 0;
  let contextLosses = 0;
  let mapAge = Infinity;
  let shownState: GameState | null = null;
  const hudText = new Map<HTMLElement, string>();
  const setText = (element: HTMLElement, text: string) => {
    if (hudText.get(element) === text) return;
    hudText.set(element, text);
    element.textContent = text;
  };

  const fail = (text: string) => {
    supported = false;
    stopLoop();
    error.hidden = false;
    error.querySelector("p")!.textContent = text;
  };

  const drawMapBase = () => {
    const context = mapBase.getContext("2d")!;
    context.clearRect(0, 0, mapBase.width, mapBase.height);
    context.fillStyle = fixtureColor(root, "surface-sunken");
    context.fillRect(0, 0, mapBase.width, mapBase.height);
    context.fillStyle = fixtureColor(root, "border");
    for (let row = 0; row < arenaSize.depth; row++)
      for (let column = 0; column < arenaSize.width; column++)
        if (isWall(column, row))
          context.fillRect(column * mapScale, row * mapScale, mapScale, mapScale);
  };

  const drawMap = () => {
    mapContext.drawImage(mapBase, 0, 0);
    const scale = mapScale / cellSize;
    const dot = (x: number, z: number, name: Parameters<typeof fixtureColor>[1], size: number) => {
      mapContext.fillStyle = fixtureColor(root, name);
      mapContext.fillRect(x * scale - size / 2, z * scale - size / 2, size, size);
    };
    for (const flag of world.flags)
      if (!flag.taken)
        dot(flag.x, flag.z, flag.owner === "rival" ? "accent-alt" : "accent", 4);
    for (const craft of world.crafts)
      if (craft.kind !== "player" || craft.cloak <= 0 || Math.floor(elapsed * 6) % 2)
        dot(
          craft.x,
          craft.z,
          craft.kind === "player"
            ? "text-strong"
            : craft.kind === "rival"
              ? "accent-alt"
              : "text-muted",
          craft.kind === "dumbot" ? 3 : 5,
        );
  };

  const updateHud = () => {
    setText(playerPips, pips(world.captured("player")));
    setText(rivalPips, pips(world.captured("rival")));
    setText(clock, clockText(world.time));
    setText(items.spring, `×${world.inventory.spring}`);
    setText(items.barrier, `×${world.inventory.barrier}`);
    setText(items.cloak, `×${world.inventory.cloak}`);
    if (shownState === world.state) return;
    shownState = world.state;
    root.dataset.state = world.state;
    if (world.state === "playing") {
      overlay.hidden = true;
      return;
    }
    const copy = overlays[world.state];
    overlay.hidden = false;
    heading.textContent = copy.heading;
    message.textContent =
      world.state === "won"
        ? `Score ${world.score()} · ${clockText(world.time)}`
        : copy.body;
    action.textContent = copy.action;
  };

  const present = (dt: number) => {
    if (!view?.render(dt, elapsed)) return;
    viewport.dataset.frames = String(++frames);
  };

  const paint = () => {
    updateHud();
    drawMap();
    if (!view || !supported) return;
    if (running) {
      view.acquire();
      present(0);
      return;
    }
    view.acquire();
    present(0);
    view.release();
  };

  function stopLoop() {
    cancelAnimationFrame(animationFrame);
    animationFrame = 0;
    previous = 0;
  }

  const frame = (timestamp: number) => {
    animationFrame = 0;
    if (!running || !supported || world.state !== "playing") return;
    const dt = previous ? Math.min(0.05, Math.max(0, (timestamp - previous) / 1000)) : 0;
    previous = timestamp;
    accumulator = Math.min(accumulator + dt, step * 4);
    while (accumulator >= step) {
      world.step(step, controls);
      accumulator -= step;
    }
    elapsed += dt;
    mapAge += dt;
    present(dt);
    updateHud();
    if (mapAge >= 0.1) {
      mapAge = 0;
      drawMap();
    }
    if (world.state === "playing")
      animationFrame = requestAnimationFrame(frame);
    else paint();
  };

  const loop = () => {
    if (!animationFrame && running && supported && world.state === "playing")
      animationFrame = requestAnimationFrame(frame);
  };

  const play = () => {
    if (!supported) return;
    if (world.state === "won" || world.state === "lost") {
      world = new HoverWorld();
      view?.dispose();
      view = null;
      initialize();
    }
    if (world.state === "ready" || world.state === "paused") {
      world.state = "playing";
      if (shownState === "ready") view?.snapCamera();
    }
    root.focus({ preventScroll: true });
    updateHud();
    loop();
  };

  const hold = () => {
    if (world.state !== "playing") return;
    world.state = "paused";
    stopLoop();
    controls = emptyControls();
    paint();
  };

  const initialize = () => {
    view?.dispose();
    view = null;
    error.hidden = true;
    supported = true;
    try {
      view = createHoverRenderer(world, viewport, root, () => {
        contextLosses += 1;
        fail("Graphics context lost. Retry to keep playing.");
      });
      view.resize(viewport.clientWidth, viewport.clientHeight);
      shownState = null;
      paint();
    } catch (failure) {
      fail(failure instanceof Error ? failure.message : "Graphics are unavailable");
    }
  };

  const setControl = (name: keyof Controls, value: boolean) => {
    if (controls[name] === value) return;
    controls = { ...controls, [name]: value };
  };

  const keyHandler = (down: boolean) => (event: KeyboardEvent) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
    if (down && (key === "Enter" || key === "p")) {
      if (event.target instanceof HTMLButtonElement && key === "Enter") return;
      event.preventDefault();
      if (world.state === "playing") hold();
      else play();
      return;
    }
    if (down && key === "Escape") {
      hold();
      return;
    }
    const control = driveKeys[key] ?? itemKeys[key];
    if (!control) return;
    event.preventDefault();
    if (down && world.state !== "playing" && driveKeys[key]) play();
    setControl(control, down);
  };
  const keyDown = keyHandler(true);
  const keyUp = keyHandler(false);
  const clearControls = (event: FocusEvent) => {
    if (!root.contains(event.relatedTarget as Node | null))
      controls = emptyControls();
  };
  const pointerFocus = () => root.focus({ preventScroll: true });
  const touch = (event: PointerEvent) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>(
      "[data-control]",
    );
    if (!button) return;
    event.preventDefault();
    const down = event.type === "pointerdown";
    if (down) {
      button.setPointerCapture(event.pointerId);
      if (world.state !== "playing") play();
    }
    setControl(button.dataset.control as keyof Controls, down);
  };
  const touchPad = root.querySelector<HTMLElement>(".hover-touch")!;
  const visibility = () => {
    if (document.hidden) hold();
  };
  const resizeObserver = new ResizeObserver(() => {
    view?.resize(viewport.clientWidth, viewport.clientHeight);
    if (!animationFrame) paint();
  });

  root.addEventListener("keydown", keyDown);
  root.addEventListener("keyup", keyUp);
  root.addEventListener("focusout", clearControls);
  viewport.addEventListener("pointerdown", pointerFocus);
  touchPad.addEventListener("pointerdown", touch);
  touchPad.addEventListener("pointerup", touch);
  touchPad.addEventListener("pointercancel", touch);
  action.addEventListener("click", play);
  retry.addEventListener("click", initialize);
  document.addEventListener("visibilitychange", visibility);
  resizeObserver.observe(viewport);
  running = options.autoStart !== false;
  drawMapBase();
  initialize();
  const removeTheme = observeFixtureTheme(() => {
    view?.applyTheme();
    drawMapBase();
    paint();
  });

  const handle = createFixtureLifecycle({
    fixtureId: "hover",
    pause() {
      running = false;
      hold();
      stopLoop();
      view?.release();
    },
    resume() {
      running = true;
      if (!supported) return;
      view?.acquire();
      view?.resize(viewport.clientWidth, viewport.clientHeight);
      paint();
      loop();
    },
    reset() {
      world = new HoverWorld();
      controls = emptyControls();
      elapsed = 0;
      frames = 0;
      contextLosses = 0;
      initialize();
    },
    destroy() {
      stopLoop();
      removeTheme();
      resizeObserver.disconnect();
      document.removeEventListener("visibilitychange", visibility);
      view?.dispose();
      view = null;
      container.replaceChildren();
    },
    snapshot() {
      const player = world.player;
      return {
        checksum: frames,
        counters: {
          frames,
          steps: world.steps,
          playerFlags: world.captured("player"),
          rivalFlags: world.captured("rival"),
          bumps: world.bumps,
          contextLosses,
        },
        details: {
          state: world.state,
          time: world.time,
          x: player.x,
          z: player.z,
          heading: player.heading,
          speed: Math.hypot(player.vx, player.vz),
          score: world.score(),
          rendering: view?.active ?? false,
        },
        supported,
      };
    },
  });
  if (options.autoStart !== false) handle.command("start");
  return handle;
}
