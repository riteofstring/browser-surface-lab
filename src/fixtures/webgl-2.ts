import { fixtureBackground, observeFixtureTheme } from "../shared/theme";
import workloadManifest from "../../workload-manifest.json";

import type { FixtureFactory } from "./contract";
import { createFixtureLifecycle } from "./lifecycle";

const workload = workloadManifest.fixtures["webgl-2"];

const vertexShaderSource = `#version 300 es
in vec2 a_position;
in vec2 a_uv;
uniform float u_angle;
out vec2 v_uv;
void main() {
  mat2 rotation = mat2(cos(u_angle), -sin(u_angle), sin(u_angle), cos(u_angle));
  vec2 position = rotation * a_position;
  gl_Position = vec4(position, 0.0, 1.0);
  v_uv = a_uv;
}`;

const fragmentShaderSource = `#version 300 es
precision highp float;
uniform sampler2D u_texture;
in vec2 v_uv;
out vec4 out_color;
void main() {
  vec4 texture_color = texture(u_texture, v_uv);
  float glow = 0.72 + 0.28 * sin((v_uv.x + v_uv.y) * 18.0);
  out_color = vec4(texture_color.rgb * glow, 1.0);
}`;

function compileShader(
  context: WebGL2RenderingContext,
  type: number,
  source: string,
): WebGLShader {
  const shader = context.createShader(type);
  if (!shader) {
    throw new Error("WebGL shader allocation failed");
  }
  context.shaderSource(shader, source);
  context.compileShader(shader);
  if (!context.getShaderParameter(shader, context.COMPILE_STATUS)) {
    const message = context.getShaderInfoLog(shader) ?? "WebGL shader failed";
    context.deleteShader(shader);
    throw new Error(message);
  }
  return shader;
}

function createProgram(context: WebGL2RenderingContext): WebGLProgram {
  const vertexShader = compileShader(
    context,
    context.VERTEX_SHADER,
    vertexShaderSource,
  );
  const fragmentShader = compileShader(
    context,
    context.FRAGMENT_SHADER,
    fragmentShaderSource,
  );
  const program = context.createProgram();
  if (!program) {
    throw new Error("WebGL program allocation failed");
  }
  context.attachShader(program, vertexShader);
  context.attachShader(program, fragmentShader);
  context.linkProgram(program);
  context.deleteShader(vertexShader);
  context.deleteShader(fragmentShader);
  if (!context.getProgramParameter(program, context.LINK_STATUS)) {
    const message = context.getProgramInfoLog(program) ?? "WebGL link failed";
    context.deleteProgram(program);
    throw new Error(message);
  }
  return program;
}

function texturePixels(): Uint8Array {
  const size = workload.textureSize;
  const pixels = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const offset = (y * size + x) * 4;
      const alternate = (Math.floor(x / 8) + Math.floor(y / 8)) % 2 === 0;
      pixels[offset] = alternate ? 42 : 237;
      pixels[offset + 1] = alternate ? 210 : 82;
      pixels[offset + 2] = alternate ? 232 : 158;
      pixels[offset + 3] = 255;
    }
  }
  return pixels;
}

export const createWebgl2Fixture: FixtureFactory = (root, options = {}) => {
  root.className = "surface surface--webgl";
  const shell = document.createElement("div");
  shell.className = "gpu-shell";
  const canvas = document.createElement("canvas");
  canvas.width = workload.width;
  canvas.height = workload.height;
  const label = document.createElement("div");
  label.className = "surface-label";
  label.innerHTML = `<span>Native WebGL 2</span><strong>Fixed shader · fixed texture</strong>`;
  shell.append(canvas, label);
  root.replaceChildren(shell);
  const context = canvas.getContext("webgl2", {
    antialias: true,
    powerPreference: "high-performance",
  });

  let animationFrame: number | null = null;
  let checksum = 0;
  let contextLosses = 0;
  let drawCalls = 0;
  let frames = 0;
  let supported = context !== null;
  let disposeResources = (): void => undefined;
  let background: [number, number, number, number] = fixtureBackground(root);
  let renderFrame = (): void => undefined;

  if (context) {
    try {
      const program = createProgram(context);
      const vao = context.createVertexArray();
      const buffer = context.createBuffer();
      const texture = context.createTexture();
      if (!vao || !buffer || !texture) {
        throw new Error("WebGL resource allocation failed");
      }
      const vertices = new Float32Array([
        -0.62, -0.62, 0, 1,
        0.62, -0.62, 1, 1,
        -0.62, 0.62, 0, 0,
        -0.62, 0.62, 0, 0,
        0.62, -0.62, 1, 1,
        0.62, 0.62, 1, 0,
      ]);
      context.bindVertexArray(vao);
      context.bindBuffer(context.ARRAY_BUFFER, buffer);
      context.bufferData(context.ARRAY_BUFFER, vertices, context.STATIC_DRAW);
      const positionLocation = context.getAttribLocation(program, "a_position");
      const uvLocation = context.getAttribLocation(program, "a_uv");
      context.enableVertexAttribArray(positionLocation);
      context.vertexAttribPointer(positionLocation, 2, context.FLOAT, false, 16, 0);
      context.enableVertexAttribArray(uvLocation);
      context.vertexAttribPointer(uvLocation, 2, context.FLOAT, false, 16, 8);
      context.bindTexture(context.TEXTURE_2D, texture);
      context.texParameteri(context.TEXTURE_2D, context.TEXTURE_MIN_FILTER, context.NEAREST);
      context.texParameteri(context.TEXTURE_2D, context.TEXTURE_MAG_FILTER, context.NEAREST);
      context.texImage2D(
        context.TEXTURE_2D,
        0,
        context.RGBA,
        workload.textureSize,
        workload.textureSize,
        0,
        context.RGBA,
        context.UNSIGNED_BYTE,
        texturePixels(),
      );
      const angleLocation = context.getUniformLocation(program, "u_angle");
      renderFrame = () => {
        context.clearColor(...background);
        context.viewport(0, 0, canvas.width, canvas.height);
        context.clear(context.COLOR_BUFFER_BIT);
        context.useProgram(program);
        context.bindVertexArray(vao);
        context.uniform1f(angleLocation, frames * 0.0125);
        context.drawArrays(context.TRIANGLES, 0, 6);
        frames += 1;
        drawCalls += 1;
        checksum = (checksum * 33 + frames * 19) >>> 0;
      };
      disposeResources = () => {
        context.deleteBuffer(buffer);
        context.deleteProgram(program);
        context.deleteTexture(texture);
        context.deleteVertexArray(vao);
      };
    } catch (error) {
      supported = false;
      label.querySelector("strong")?.replaceChildren(
        document.createTextNode(
          error instanceof Error ? error.message : "WebGL setup failed",
        ),
      );
    }
  }

  const loop = (): void => {
    renderFrame();
    animationFrame = window.requestAnimationFrame(loop);
  };
  const pause = (): void => {
    if (animationFrame !== null) {
      window.cancelAnimationFrame(animationFrame);
      animationFrame = null;
    }
  };
  const resume = (): void => {
    if (supported && animationFrame === null) {
      animationFrame = window.requestAnimationFrame(loop);
    }
  };
  const onContextLost = (event: Event): void => {
    event.preventDefault();
    contextLosses += 1;
    supported = false;
    pause();
  };
  canvas.addEventListener("webglcontextlost", onContextLost);
  const removeTheme = observeFixtureTheme(() => {
    background = fixtureBackground(root);
    renderFrame();
  });

  const handle = createFixtureLifecycle({
    destroy() {
      removeTheme();
      pause();
      canvas.removeEventListener("webglcontextlost", onContextLost);
      disposeResources();
      root.replaceChildren();
    },
    fixtureId: "webgl-2",
    pause,
    reset() {
      checksum = 0;
      contextLosses = 0;
      drawCalls = 0;
      frames = 0;
      renderFrame();
    },
    resume,
    snapshot() {
      return {
        checksum,
        counters: { contextLosses, drawCalls, frames },
        details: {
          height: workload.height,
          renderer: context?.getParameter(context.RENDERER) ?? null,
          textureWidth: workload.textureSize,
          width: workload.width,
        },
        supported,
      };
    },
  });
  if (options.autoStart !== false) {
    handle.command("start");
  }
  return handle;
};
