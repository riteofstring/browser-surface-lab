import type { FixtureHandle, FixtureMountOptions } from "./contract";
import { createFixtureLifecycle } from "./lifecycle";
import { observeFixtureTheme } from "../shared/theme";
import { createHoverRenderer, type HoverRenderer } from "./hover-render";
import { createHud, hudMarkup, overlayFor } from "./hover-hud";
import { createHoverSound } from "./hover-sound";
import { bindTouchControls, touchMarkup } from "./hover-touch";
import { mazes } from "./hover-mazes";
import {
  emptyControls,
  HoverWorld,
  type Controls,
  type GameState,
} from "./hover-world";
import "./hover.css";

const step = 1 / 60;
const bestKey = "browser-surface-lab:hover:best";

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

// Like Hover!'s Maze Type option: `maze=city` starts the cycle there.
const firstRound = Math.max(
  0,
  mazes.findIndex(
    (maze) => maze.name === new URLSearchParams(location.search).get("maze"),
  ),
);

const items = new Set<keyof Controls>(["jump", "barrier", "cloak"]);

// Flags land at random each game, as in the original; `seed=` replays one
// layout, for sharing a challenge or for tests.
const fixedSeed = Number(new URLSearchParams(location.search).get("seed"));
const newSeed = () =>
  Number.isInteger(fixedSeed) && fixedSeed > 0
    ? fixedSeed
    : Math.floor(Math.random() * 2 ** 31);

const readBest = () => {
  try {
    return Number(localStorage.getItem(bestKey)) || 0;
  } catch {
    return 0;
  }
};

const saveBest = (score: number) => {
  try {
    localStorage.setItem(bestKey, String(score));
  } catch {
    /* Storage can be unavailable in framed or private documents. */
  }
};

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
    "Hover! Arrow keys drive, A or Space jumps, S drops a wall, D cloaks, Enter starts or pauses, M mutes.",
  );
  root.innerHTML = `<div class="hover-viewport"></div>
  ${hudMarkup}
  <div class="hover-overlay">
    <h2></h2><p class="hover-message"></p>
    <button type="button" class="hover-action"></button>
    <p class="hover-help">Arrows drive · A/Space spring · S wall · D cloak · Enter pause · M mute</p>
  </div>
  ${touchMarkup}
  <div class="hover-error" hidden><p role="alert"></p><button type="button">Retry graphics</button></div>`;
  const viewport = root.querySelector<HTMLElement>(".hover-viewport")!;
  const overlay = root.querySelector<HTMLElement>(".hover-overlay")!;
  const heading = overlay.querySelector("h2")!;
  const message = overlay.querySelector<HTMLElement>(".hover-message")!;
  const action = overlay.querySelector<HTMLButtonElement>(".hover-action")!;
  const error = root.querySelector<HTMLElement>(".hover-error")!;
  const retry = error.querySelector("button")!;
  const hud = createHud(root);
  const sound = createHoverSound();

  let world = new HoverWorld({ round: firstRound, seed: newSeed() });
  let controls = emptyControls();
  let view: HoverRenderer | null = null;
  let running = false;
  let startRequested = -Infinity;
  let releaseTimer = 0;
  let supported = true;
  let animationFrame = 0;
  let previous = 0;
  let accumulator = 0;
  let elapsed = 0;
  let frames = 0;
  let contextLosses = 0;
  let mapAge = Infinity;
  let shownState: GameState | null = null;
  let best = readBest();
  let tapped: Partial<Controls> = {};

  const fail = (text: string) => {
    supported = false;
    stopLoop();
    error.hidden = false;
    error.querySelector("p")!.textContent = text;
  };

  const showOverlay = () => {
    if (shownState === world.state) return;
    shownState = world.state;
    root.dataset.state = world.state;
    const copy = overlayFor(world, best);
    overlay.hidden = copy === null;
    if (!copy) return;
    heading.textContent = copy.heading;
    message.textContent = copy.body;
    action.textContent = copy.action;
  };

  const updateHud = () => {
    root.toggleAttribute("data-held", !running || world.state === "paused");
    hud.update(world, elapsed, view?.mirrorBox() ?? null);
    showOverlay();
  };

  const drainEvents = () => {
    for (const event of world.events.splice(0)) {
      hud.announce(event, elapsed, world);
      sound.play(event);
    }
    if (world.state === "lost" && world.score > best) {
      best = world.score;
      saveBest(best);
    }
  };

  const present = (dt: number) => {
    if (!view?.render(dt, elapsed)) return;
    viewport.dataset.frames = String(++frames);
  };

  const paint = () => {
    updateHud();
    hud.drawMap(world, elapsed);
    // A game loaded unstarted creates no graphics until its host resumes it.
    if (!view || !supported || (!running && frames === 0)) return;
    view.acquire();
    present(0);
    if (!running) view.suspend();
  };

  function stopLoop() {
    cancelAnimationFrame(animationFrame);
    animationFrame = 0;
    previous = 0;
  }

  const advance = (dt: number) => {
    accumulator = Math.min(accumulator + dt, step * 4);
    while (accumulator >= step) {
      // A tap shorter than a step still counts once.
      world.step(step, { ...controls, ...tapped });
      tapped = {};
      accumulator -= step;
    }
    elapsed += dt;
    mapAge += dt;
  };

  const frame = (timestamp: number) => {
    animationFrame = 0;
    if (!running || !supported || world.state !== "playing") return;
    const dt = previous
      ? Math.min(0.05, Math.max(0, (timestamp - previous) / 1000))
      : 0;
    previous = timestamp;
    advance(dt);
    drainEvents();
    present(dt);
    updateHud();
    if (mapAge >= 0.1) {
      mapAge = 0;
      hud.drawMap(world, elapsed);
    }
    if (world.state === "playing")
      animationFrame = requestAnimationFrame(frame);
    else paint();
  };

  const loop = () => {
    if (!animationFrame && running && supported && world.state === "playing")
      animationFrame = requestAnimationFrame(frame);
  };

  const startWorld = (next: HoverWorld) => {
    world = next;
    initialize();
  };

  const play = () => {
    if (!supported) return;
    // A start pressed while the host holds the game takes effect when the
    // host resumes it, as when a click both chooses the pane and plays.
    if (!running) {
      startRequested = performance.now();
      return;
    }
    sound.unlock();
    if (world.state === "cleared")
      startWorld(
        new HoverWorld({
          round: world.round + 1,
          score: world.score,
          seed: world.seed,
        }),
      );
    else if (world.state === "lost")
      startWorld(new HoverWorld({ round: firstRound, seed: newSeed() }));
    world.state = "playing";
    view?.snapCamera();
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
      view = createHoverRenderer(
        world,
        viewport,
        () => {
          contextLosses += 1;
          fail("Graphics context lost. Retry to keep playing.");
        },
        () => {
          if (!animationFrame) paint();
        },
      );
      view.resize(viewport.clientWidth, viewport.clientHeight);
      shownState = null;
      paint();
    } catch (failure) {
      fail(
        failure instanceof Error ? failure.message : "Graphics are unavailable",
      );
    }
  };

  const setControl = (name: keyof Controls, value: boolean) => {
    if (value && items.has(name)) tapped[name] = true;
    if (controls[name] === value) return;
    controls = { ...controls, [name]: value };
  };

  const keyName = (event: KeyboardEvent) =>
    event.altKey || event.ctrlKey || event.metaKey
      ? null
      : event.key.length === 1
        ? event.key.toLowerCase()
        : event.key;
  const toggle = (event: KeyboardEvent) => {
    if (event.target instanceof HTMLButtonElement && event.key === "Enter")
      return;
    event.preventDefault();
    if (world.state === "playing") hold();
    else play();
  };
  const commands: Record<string, (event: KeyboardEvent) => void> = {
    Enter: toggle,
    p: toggle,
    Escape: hold,
    m: () => sound.toggleMute(),
  };
  const steer = (key: string, down: boolean, event: KeyboardEvent) => {
    const control = driveKeys[key] ?? itemKeys[key];
    if (!control) return;
    event.preventDefault();
    if (down && world.state !== "playing" && driveKeys[key]) play();
    setControl(control, down);
  };
  // Keys reach the game whenever nothing else in its document has focus, so
  // a host that focuses the frame can hand over the keyboard.
  const ours = () => {
    const active = document.activeElement;
    return !active || active === document.body || root.contains(active);
  };
  const keyDown = (event: KeyboardEvent) => {
    const key = ours() ? keyName(event) : null;
    if (key === null) return;
    const command = commands[key];
    if (command) command(event);
    else steer(key, true, event);
  };
  const keyUp = (event: KeyboardEvent) => {
    const key = ours() ? keyName(event) : null;
    if (key !== null) steer(key, false, event);
  };
  const clearControls = (event: FocusEvent) => {
    if (!root.contains(event.relatedTarget as Node | null))
      controls = emptyControls();
  };
  const pointerFocus = () => root.focus({ preventScroll: true });
  const visibility = () => {
    if (document.hidden) hold();
  };
  const resizeObserver = new ResizeObserver(() => {
    view?.resize(viewport.clientWidth, viewport.clientHeight);
    if (!animationFrame) paint();
  });

  document.addEventListener("keydown", keyDown);
  document.addEventListener("keyup", keyUp);
  root.addEventListener("focusout", clearControls);
  viewport.addEventListener("pointerdown", pointerFocus);
  const unbindTouch = bindTouchControls(
    root,
    setControl,
    () => {
      if (world.state !== "playing") play();
    },
    hold,
  );
  action.addEventListener("click", play);
  retry.addEventListener("click", initialize);
  document.addEventListener("visibilitychange", visibility);
  resizeObserver.observe(viewport);
  running = options.autoStart !== false;
  initialize();
  const removeTheme = observeFixtureTheme(paint);

  const resumeHost = () => {
    window.clearTimeout(releaseTimer);
    running = true;
    if (!supported) return;
    view?.acquire();
    view?.resize(viewport.clientWidth, viewport.clientHeight);
    paint();
    loop();
    if (performance.now() - startRequested >= 3000) return;
    startRequested = -Infinity;
    play();
  };

  const handle = createFixtureLifecycle({
    fixtureId: "hover",
    pause() {
      running = false;
      hold();
      stopLoop();
      view?.suspend();
      updateHud();
      // Give the graphics context back only after a while away.
      window.clearTimeout(releaseTimer);
      releaseTimer = window.setTimeout(() => view?.release(), 30_000);
    },
    resume: resumeHost,
    reset() {
      world = new HoverWorld({ round: firstRound, seed: newSeed() });
      controls = emptyControls();
      elapsed = 0;
      frames = 0;
      contextLosses = 0;
      initialize();
    },
    destroy() {
      stopLoop();
      window.clearTimeout(releaseTimer);
      removeTheme();
      resizeObserver.disconnect();
      document.removeEventListener("visibilitychange", visibility);
      document.removeEventListener("keydown", keyDown);
      document.removeEventListener("keyup", keyUp);
      sound.close();
      unbindTouch();
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
          round: world.round,
          maze: world.arena.maze.name,
          seed: world.seed,
          steals: world.steals,
          time: world.time,
          x: player.x,
          y: player.y,
          z: player.z,
          heading: player.heading,
          speed: Math.hypot(player.vx, player.vz),
          score: world.score,
          rendering: view?.active ?? false,
        },
        supported,
      };
    },
  });
  if (options.autoStart !== false) handle.command("start");
  return handle;
}
