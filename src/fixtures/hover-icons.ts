import * as THREE from "three";
import type { PodKind } from "./hover-world";

type Draw = (context: CanvasRenderingContext2D) => void;

function canvasTexture(draw: Draw): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 64;
  const context = canvas.getContext("2d")!;
  context.lineCap = context.lineJoin = "round";
  draw(context);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

const disc = (
  context: CanvasRenderingContext2D,
  color: string,
  radius = 15,
) => {
  context.fillStyle = color;
  context.beginPath();
  context.arc(32, 32, radius, 0, Math.PI * 2);
  context.fill();
};

// Each pod's icon, drawn inside its green bubble as in the original.
const podIcons: Record<PodKind, Draw> = {
  spring: (context) => {
    context.strokeStyle = "#ffd23a";
    context.lineWidth = 5;
    context.beginPath();
    for (let turn = 0; turn <= 4; turn++)
      context.lineTo(turn % 2 ? 44 : 20, 50 - turn * 9);
    context.stroke();
  },
  barrier: (context) => {
    context.fillStyle = "#c8562a";
    for (let row = 0; row < 3; row++)
      for (let column = 0; column < 3; column++)
        context.fillRect(
          10 + column * 15 + (row % 2) * 6,
          18 + row * 10,
          13,
          8,
        );
  },
  cloak: (context) => {
    context.fillStyle = "#f2f2f2";
    for (const [x, y, r] of [
      [22, 36, 10],
      [34, 30, 13],
      [44, 37, 9],
    ] as const) {
      context.beginPath();
      context.arc(x, y, r, 0, Math.PI * 2);
      context.fill();
    }
  },
  green: (context) => disc(context, "#3bff6a"),
  red: (context) => disc(context, "#ff3b3b"),
  shield: (context) => {
    context.fillStyle = "#49e6ff";
    context.beginPath();
    context.moveTo(32, 12);
    context.lineTo(50, 20);
    context.quadraticCurveTo(48, 44, 32, 54);
    context.quadraticCurveTo(16, 44, 14, 20);
    context.closePath();
    context.fill();
  },
  eraser: (context) => {
    context.fillStyle = "#ffe14a";
    context.beginPath();
    for (const [x, y] of [
      [38, 8],
      [18, 36],
      [30, 36],
      [24, 58],
      [46, 26],
      [34, 26],
    ] as const)
      context.lineTo(x, y);
    context.closePath();
    context.fill();
  },
  calm: (context) => {
    context.strokeStyle = "#4a8bff";
    context.lineWidth = 5;
    context.beginPath();
    context.arc(32, 32, 16, 0, Math.PI * 2);
    context.moveTo(32, 32);
    context.lineTo(32, 20);
    context.moveTo(32, 32);
    context.lineTo(41, 37);
    context.stroke();
  },
  random: (context) => {
    context.fillStyle = "#ffffff";
    context.font = "bold 40px sans-serif";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText("?", 32, 34);
  },
};

export function podIcon(kind: PodKind): THREE.CanvasTexture {
  return canvasTexture(podIcons[kind]);
}

/** Floor tiles: an arrow pointing the way it pushes (up the texture is the
 * push direction), a swirl that holds, and a flag that goes home. */
export function tileTexture(
  kind: "push" | "stop" | "return",
): THREE.CanvasTexture {
  return canvasTexture((context) => {
    context.fillStyle = "#151515";
    context.fillRect(0, 0, 64, 64);
    const colors = { push: "#3bff6a", stop: "#ff3b3b", return: "#ffd23a" };
    context.strokeStyle = context.fillStyle = colors[kind];
    context.lineWidth = 5;
    context.strokeRect(4, 4, 56, 56);
    context.beginPath();
    if (kind === "push") {
      for (const y of [26, 42]) {
        context.moveTo(16, y + 6);
        context.lineTo(32, y - 8);
        context.lineTo(48, y + 6);
      }
    } else if (kind === "stop") {
      for (let step = 0; step < 40; step++) {
        const angle = step * 0.45;
        context.lineTo(
          32 + Math.cos(angle) * step * 0.5,
          32 + Math.sin(angle) * step * 0.5,
        );
      }
    } else {
      context.moveTo(24, 50);
      context.lineTo(24, 14);
      context.lineTo(46, 21);
      context.lineTo(24, 28);
    }
    context.stroke();
  });
}
