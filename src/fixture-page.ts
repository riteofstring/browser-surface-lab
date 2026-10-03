import type { FixtureHandle, FixtureId } from "./fixtures/contract";
import { installFixtureBridge } from "./shared/bridge";
import { applyInitialFixtureTheme } from "./shared/theme";

type Mount = (
  root: HTMLElement,
  options: { autoStart: boolean },
) => Promise<FixtureHandle> | FixtureHandle;

/** Mounts one fixture in a fixture page, with the theme and host bridge. */
export async function startFixturePage(
  fixtureId: FixtureId,
  mount: Mount,
): Promise<void> {
  const root = document.querySelector<HTMLElement>("#fixture-root");
  const title = document.querySelector<HTMLElement>("#fixture-title");
  const status = document.querySelector<HTMLOutputElement>("#fixture-status");
  if (!root) {
    throw new Error("Fixture root is missing");
  }
  const query = new URLSearchParams(window.location.search);
  document.documentElement.dataset.fixtureEmbedding =
    query.get("embedding") === "surface" ? "surface" : "standalone";
  document.title = `${fixtureId} · Browser Surface Lab`;
  if (title) {
    title.textContent = fixtureId;
  }
  applyInitialFixtureTheme(window.location.search);
  // `autostart=0` mounts a fixture without starting it, for hosts that load
  // one in the background and start it when it is shown.
  const handle = await mount(root, {
    autoStart: query.get("autostart") !== "0",
  });
  const removeBridge = installFixtureBridge(handle);
  if (status) {
    status.value = handle.snapshot().supported ? "Running" : "Unavailable";
  }
  window.addEventListener(
    "beforeunload",
    () => {
      removeBridge();
      handle.destroy();
    },
    { once: true },
  );
}
