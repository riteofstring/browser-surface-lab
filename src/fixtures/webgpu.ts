import { fixtureBackground, observeFixtureTheme } from "../shared/theme";
import workloadManifest from "../../workload-manifest.json";

import type { FixtureFactory, FixtureHandle } from "./contract";
import { createFixtureLifecycle } from "./lifecycle";

const workload = workloadManifest.fixtures.webgpu;

const shaderSource = `
struct Uniforms {
  angle: f32,
}
@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var texture_sampler: sampler;
@group(0) @binding(2) var texture_data: texture_2d<f32>;

struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
}

@vertex
fn vertex_main(@location(0) position: vec2f, @location(1) uv: vec2f) -> VertexOutput {
  let rotation = mat2x2f(
    cos(uniforms.angle), -sin(uniforms.angle),
    sin(uniforms.angle), cos(uniforms.angle)
  );
  var output: VertexOutput;
  output.position = vec4f(rotation * position, 0.0, 1.0);
  output.uv = uv;
  return output;
}

@fragment
fn fragment_main(input: VertexOutput) -> @location(0) vec4f {
  let sampled = textureSample(texture_data, texture_sampler, input.uv);
  let glow = 0.72 + 0.28 * sin((input.uv.x + input.uv.y) * 18.0);
  return vec4f(sampled.rgb * glow, 1.0);
}`;

const gpuBufferUsage = {
  copyDestination: 0x0008,
  uniform: 0x0040,
  vertex: 0x0020,
} as const;

const gpuTextureUsage = {
  copyDestination: 0x02,
  textureBinding: 0x04,
} as const;

function texturePixels(): Uint8Array {
  const pixels = new Uint8Array(
    workload.textureSize * workload.textureSize * 4,
  );
  for (let y = 0; y < workload.textureSize; y += 1) {
    for (let x = 0; x < workload.textureSize; x += 1) {
      const offset = (y * workload.textureSize + x) * 4;
      const alternate = (Math.floor(x / 8) + Math.floor(y / 8)) % 2 === 0;
      pixels[offset] = alternate ? 255 : 54;
      pixels[offset + 1] = alternate ? 178 : 215;
      pixels[offset + 2] = alternate ? 76 : 238;
      pixels[offset + 3] = 255;
    }
  }
  return pixels;
}

export const createWebgpuFixture: FixtureFactory = async (
  root,
  options = {},
): Promise<FixtureHandle> => {
  root.className = "surface surface--webgpu";
  const shell = document.createElement("div");
  shell.className = "gpu-shell";
  const canvas = document.createElement("canvas");
  canvas.width = workload.width;
  canvas.height = workload.height;
  const label = document.createElement("div");
  label.className = "surface-label";
  label.innerHTML = `<span>Native WebGPU</span><strong>Fixed pipeline · fixed texture</strong>`;
  shell.append(canvas, label);
  root.replaceChildren(shell);

  let animationFrame: number | null = null;
  let checksum = 0;
  let deviceLosses = 0;
  let drawCalls = 0;
  let frames = 0;
  let supported = "gpu" in navigator;
  let background: [number, number, number, number] = fixtureBackground(root);
  let renderFrame = (): void => undefined;
  let release = (): void => undefined;

  if (supported) {
    try {
      const adapter = await navigator.gpu.requestAdapter({
        powerPreference: "high-performance",
      });
      if (!adapter) {
        throw new Error("WebGPU adapter unavailable");
      }
      const device = await adapter.requestDevice();
      const context = canvas.getContext("webgpu") as GPUCanvasContext | null;
      if (!context) {
        throw new Error("WebGPU canvas context unavailable");
      }
      const format = navigator.gpu.getPreferredCanvasFormat();
      context.configure({ alphaMode: "opaque", device, format });
      const shader = device.createShaderModule({ code: shaderSource });
      const pipeline = device.createRenderPipeline({
        fragment: {
          entryPoint: "fragment_main",
          module: shader,
          targets: [{ format }],
        },
        layout: "auto",
        primitive: { topology: "triangle-list" },
        vertex: {
          buffers: [
            {
              arrayStride: 16,
              attributes: [
                { format: "float32x2", offset: 0, shaderLocation: 0 },
                { format: "float32x2", offset: 8, shaderLocation: 1 },
              ],
            },
          ],
          entryPoint: "vertex_main",
          module: shader,
        },
      });
      const vertices = new Float32Array([
        -0.62, -0.62, 0, 1,
        0.62, -0.62, 1, 1,
        -0.62, 0.62, 0, 0,
        -0.62, 0.62, 0, 0,
        0.62, -0.62, 1, 1,
        0.62, 0.62, 1, 0,
      ]);
      const vertexBuffer = device.createBuffer({
        mappedAtCreation: true,
        size: vertices.byteLength,
        usage: gpuBufferUsage.vertex,
      });
      new Float32Array(vertexBuffer.getMappedRange()).set(vertices);
      vertexBuffer.unmap();
      const uniformBuffer = device.createBuffer({
        size: 16,
        usage: gpuBufferUsage.copyDestination | gpuBufferUsage.uniform,
      });
      const texture = device.createTexture({
        format: "rgba8unorm",
        size: [workload.textureSize, workload.textureSize],
        usage:
          gpuTextureUsage.copyDestination | gpuTextureUsage.textureBinding,
      });
      device.queue.writeTexture(
        { texture },
        texturePixels(),
        {
          bytesPerRow: workload.textureSize * 4,
          rowsPerImage: workload.textureSize,
        },
        { height: workload.textureSize, width: workload.textureSize },
      );
      const sampler = device.createSampler({
        magFilter: "nearest",
        minFilter: "nearest",
      });
      const bindGroup = device.createBindGroup({
        entries: [
          { binding: 0, resource: { buffer: uniformBuffer } },
          { binding: 1, resource: sampler },
          { binding: 2, resource: texture.createView() },
        ],
        layout: pipeline.getBindGroupLayout(0),
      });
      renderFrame = () => {
        device.queue.writeBuffer(
          uniformBuffer,
          0,
          new Float32Array([frames * 0.0125]),
        );
        const encoder = device.createCommandEncoder();
        const pass = encoder.beginRenderPass({
          colorAttachments: [
            {
              clearValue: background,
              loadOp: "clear",
              storeOp: "store",
              view: context.getCurrentTexture().createView(),
            },
          ],
        });
        pass.setPipeline(pipeline);
        pass.setBindGroup(0, bindGroup);
        pass.setVertexBuffer(0, vertexBuffer);
        pass.draw(6);
        pass.end();
        device.queue.submit([encoder.finish()]);
        frames += 1;
        drawCalls += 1;
        checksum = (checksum * 33 + frames * 23) >>> 0;
      };
      release = () => {
        texture.destroy();
        uniformBuffer.destroy();
        vertexBuffer.destroy();
        device.destroy();
      };
      void device.lost.then(() => {
        deviceLosses += 1;
        supported = false;
        if (animationFrame !== null) {
          window.cancelAnimationFrame(animationFrame);
          animationFrame = null;
        }
      });
    } catch (error) {
      supported = false;
      label.querySelector("strong")?.replaceChildren(
        document.createTextNode(
          error instanceof Error ? error.message : "WebGPU setup failed",
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
  const removeTheme = observeFixtureTheme(() => {
    background = fixtureBackground(root);
    renderFrame();
  });

  const handle = createFixtureLifecycle({
    destroy() {
      removeTheme();
      pause();
      release();
      root.replaceChildren();
    },
    fixtureId: "webgpu",
    pause,
    reset() {
      checksum = 0;
      deviceLosses = 0;
      drawCalls = 0;
      frames = 0;
      renderFrame();
    },
    resume,
    snapshot() {
      return {
        checksum,
        counters: { deviceLosses, drawCalls, frames },
        details: {
          height: workload.height,
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
