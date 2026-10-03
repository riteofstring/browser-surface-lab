import type {
  FixtureFactory,
  FixtureId,
  FixtureHandle,
  FixtureMountOptions,
  TierOneFixtureId,
} from "./contract";

type FixtureFactoryLoader = () => Promise<FixtureFactory>;

const fixtureFactoryLoaders: Record<TierOneFixtureId, FixtureFactoryLoader> = {
  "canvas-2d": async () => (await import("./canvas-2d")).createCanvas2dFixture,
  "webgl-2": async () => (await import("./webgl-2")).createWebgl2Fixture,
  "xterm-dom": async () => (await import("./xterm")).createXtermDomFixture,
  "xterm-webgl": async () => (await import("./xterm")).createXtermWebglFixture,
  dom: async () => (await import("./dom")).createDomFixture,
  forms: async () => (await import("./forms")).createFormsFixture,
  mixed: async () => (await import("./mixed")).createMixedFixture,
  react: async () => (await import("./react")).createReactFixture,
  video: async () => (await import("./video")).createVideoFixture,
  webgpu: async () => (await import("./webgpu")).createWebgpuFixture,
};

export async function mountFixture(
  fixtureId: FixtureId,
  root: HTMLElement,
  options?: FixtureMountOptions,
): Promise<FixtureHandle> {
  if (fixtureId === "three-reactor" || fixtureId === "three-tidal") {
    const { createThreeFixture } = await import("./three");
    return createThreeFixture(fixtureId, root, options);
  }
  if (fixtureId === "hover") {
    const { createHoverFixture } = await import("./hover");
    return createHoverFixture(root, options);
  }
  const factory = await fixtureFactoryLoaders[fixtureId]();
  return factory(root, options);
}
