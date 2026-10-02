import { fixtureColor, observeFixtureTheme } from "../shared/theme";
import workloadManifest from "../../workload-manifest.json";

import type { FixtureFactory } from "./contract";
import { createFixtureLifecycle } from "./lifecycle";

const workload = workloadManifest.fixtures["canvas-2d"];
const width = workload.width;
const height = workload.height;
const particleCount = workload.particleCount;

export const createCanvas2dFixture: FixtureFactory = (root, options = {}) => {
  root.className = "surface surface--canvas";
  const shell = document.createElement("div");
  shell.className = "canvas-shell";
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  Object.assign(canvas.style, {
    width: `${width}px`,
    height: `${height}px`,
    position: "absolute",
    left: "50%",
    top: "50%",
    objectFit: "fill",
    transformOrigin: "center",
  });
  const label = document.createElement("div");
  label.className = "surface-label";
  label.innerHTML = `<span>Canvas 2D</span><strong>${particleCount} particles</strong>`;
  shell.append(canvas, label);
  root.replaceChildren(shell);
  const fitCanvas = (): void => {
    const scale = Math.max(
      shell.clientWidth / width,
      shell.clientHeight / height,
    );
    canvas.style.transform = `translate(-50%, -50%) scale(${scale})`;
  };
  const resizeObserver = new ResizeObserver(fitCanvas);
  resizeObserver.observe(shell);
  fitCanvas();
  const context = canvas.getContext("2d");

  let animationFrame: number | null = null;
  let checksum = 240;
  let frames = 0;

  let palette = {
    background: "#071d2c",
    raised: "#16132d",
    accent: "#70e1f5",
    alternate: "#ff7eb3",
    positive: "#8df0c7",
  };
  const draw = (): void => {
    if (!context) {
      return;
    }
    const time = frames / 60;
    const gradient = context.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, palette.background);
    gradient.addColorStop(1, palette.raised);
    context.fillStyle = gradient;
    context.fillRect(0, 0, width, height);
    context.globalCompositeOperation =
      document.documentElement.dataset.colorMode === "light"
        ? "source-over"
        : "lighter";
    for (let index = 0; index < particleCount; index += 1) {
      const phase = index * 0.618 + time;
      const radius = 80 + (index % 23) * 14;
      const x = width / 2 + Math.sin(phase * 0.8) * radius * 1.6;
      const y = height / 2 + Math.cos(phase * 1.1) * radius;
      const size = 1.5 + (index % 7) * 0.45;
      context.fillStyle =
        index % 3 === 0
          ? palette.accent
          : index % 3 === 1
            ? palette.alternate
            : palette.positive;
      context.beginPath();
      context.arc(x, y, size, 0, Math.PI * 2);
      context.fill();
    }
    context.globalCompositeOperation = "source-over";
    frames += 1;
    checksum = (checksum * 33 + frames * 17) >>> 0;
  };

  const loop = (): void => {
    draw();
    animationFrame = window.requestAnimationFrame(loop);
  };
  const pause = (): void => {
    if (animationFrame !== null) {
      window.cancelAnimationFrame(animationFrame);
      animationFrame = null;
    }
  };
  const resume = (): void => {
    if (animationFrame === null && context) {
      animationFrame = window.requestAnimationFrame(loop);
    }
  };
  const removeTheme = observeFixtureTheme(() => {
    palette = {
      background: fixtureColor(root, "surface"),
      raised: fixtureColor(root, "surface-raised"),
      accent: fixtureColor(root, "accent"),
      alternate: fixtureColor(root, "accent-alt"),
      positive: fixtureColor(root, "positive"),
    };
    draw();
  });

  const handle = createFixtureLifecycle({
    destroy() {
      resizeObserver.disconnect();
      removeTheme();
      pause();
      root.replaceChildren();
    },
    fixtureId: "canvas-2d",
    pause,
    reset() {
      checksum = 240;
      frames = 0;
      draw();
    },
    resume,
    snapshot() {
      return {
        checksum,
        counters: { frames, particles: particleCount },
        details: { height, width },
        supported: context !== null,
      };
    },
  });
  if (options.autoStart !== false) {
    handle.command("start");
  }
  return handle;
};
