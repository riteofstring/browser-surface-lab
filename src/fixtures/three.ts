import type { FixtureHandle, FixtureMountOptions } from "./contract";
import { createFixtureLifecycle } from "./lifecycle";
import { createThreeScene } from "./three-scene";
import "./three.css";

export function createThreeFixture(
  fixtureId: "three-reactor" | "three-tidal",
  container: HTMLElement,
  options: FixtureMountOptions = {},
): FixtureHandle {
  const root = document.createElement("section");
  container.replaceChildren(root);
  const kind = fixtureId === "three-reactor" ? "reactor" : "tidal";
  const reactor = kind === "reactor";
  root.className = `surface three-demo three-demo--${kind}`;
  root.innerHTML = `<header class="three-header">
    <span class="three-eyebrow">${reactor ? "01 / KINETIC STUDY" : "02 / WAVE STUDY"}</span>
    <h2>${reactor ? "Chromatic reactor" : "Tidal lattice"}</h2>
    <p>${reactor ? "A little controlled chaos." : "An ocean made of light."}</p>
  </header>
  <div class="three-viewport"></div>
  <div class="three-error" hidden><p role="alert"></p><button>Retry graphics</button></div>
  <footer class="three-footer"><label>${reactor ? "Energy" : "Amplitude"}
    <input aria-label="${reactor ? "Reactor energy" : "Wave amplitude"}" type="range" min="0.3" max="2" step="0.05" value="1">
  </label><span class="three-hint">Move the pointer to explore</span></footer>`;
  const viewport = root.querySelector<HTMLElement>(".three-viewport")!;
  const error = root.querySelector<HTMLElement>(".three-error")!;
  const slider = root.querySelector<HTMLInputElement>("input")!;
  const retry = root.querySelector<HTMLButtonElement>("button")!;
  let scene: ReturnType<typeof createThreeScene> | null = null;
  let animationFrame = 0;
  let running = false;
  let supported = true;
  let time = 0;
  let previous = 0;
  let frames = 0;
  let contextLosses = 0;
  let pointer = { x: 0, y: 0 };
  const fail = (message: string) => {
    supported = false;
    cancelAnimationFrame(animationFrame);
    animationFrame = 0;
    error.hidden = false;
    error.querySelector("p")!.textContent = message;
  };
  const draw = (timestamp: number) => {
    if (!scene || !supported) return;
    if (previous && running)
      time += Math.max(0, Math.min(0.05, (timestamp - previous) / 1000));
    previous = timestamp;
    scene.draw(time, Number(slider.value), pointer);
    viewport.dataset.frames = String(++frames);
    if (running) animationFrame = requestAnimationFrame(draw);
  };
  const initialize = () => {
    scene?.dispose();
    scene = null;
    viewport.replaceChildren();
    error.hidden = true;
    supported = true;
    previous = 0;
    try {
      scene = createThreeScene(kind, viewport, (message) => {
        contextLosses += 1;
        fail(message);
      });
      draw(performance.now());
      if (!running) scene.setVisible(false);
    } catch (failure) {
      fail(
        failure instanceof Error ? failure.message : "Graphics are unavailable",
      );
    }
  };
  const move = (event: PointerEvent) => {
    const bounds = viewport.getBoundingClientRect();
    pointer = {
      x: (event.clientX - bounds.left) / bounds.width - 0.5,
      y: (event.clientY - bounds.top) / bounds.height - 0.5,
    };
  };
  const pause = () => {
    running = false;
    cancelAnimationFrame(animationFrame);
    animationFrame = 0;
    previous = 0;
    scene?.setVisible(false);
  };
  const resume = () => {
    running = true;
    if (!supported) return;
    scene?.setVisible(true);
    if (!animationFrame) draw(performance.now());
  };
  viewport.addEventListener("pointermove", move);
  retry.addEventListener("click", initialize);
  initialize();
  const handle = createFixtureLifecycle({
    fixtureId,
    pause,
    resume,
    reset() {
      time = 0;
      frames = 0;
      contextLosses = 0;
      pointer = { x: 0, y: 0 };
      slider.value = "1";
      initialize();
    },
    destroy() {
      pause();
      scene?.dispose();
      viewport.removeEventListener("pointermove", move);
      retry.removeEventListener("click", initialize);
      container.replaceChildren();
    },
    snapshot() {
      return {
        checksum: frames,
        counters: { frames, contextLosses },
        details: {
          time,
          energy: Number(slider.value),
          width: scene?.canvas.width ?? 0,
          height: scene?.canvas.height ?? 0,
        },
        supported,
      };
    },
  });
  if (options.autoStart !== false) handle.command("start");
  return handle;
}
