import "@xterm/xterm/css/xterm.css";

import { fixtureIdFromSearch } from "./fixtures/contract";
import { mountFixture } from "./fixtures/registry";
import { installFixtureBridge } from "./shared/bridge";
import { applyInitialFixtureTheme } from "./shared/theme";
import "./styles.css";

const root = document.querySelector<HTMLElement>("#fixture-root");
const title = document.querySelector<HTMLElement>("#fixture-title");
const status = document.querySelector<HTMLOutputElement>("#fixture-status");
if (!root) {
  throw new Error("Fixture root is missing");
}

const fixtureId = fixtureIdFromSearch(window.location.search);
const embedding = new URLSearchParams(window.location.search).get("embedding");
document.documentElement.dataset.fixtureEmbedding =
  embedding === "surface" ? "surface" : "standalone";
document.title = `${fixtureId} · Browser Surface Lab`;
if (title) {
  title.textContent = fixtureId;
}
applyInitialFixtureTheme(window.location.search);
// `autostart=0` mounts a fixture without starting it, for hosts that load
// one in the background and start it when it is shown.
const handle = await mountFixture(fixtureId, root, {
  autoStart:
    new URLSearchParams(window.location.search).get("autostart") !== "0",
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
