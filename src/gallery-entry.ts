import "@xterm/xterm/css/xterm.css";

import {
  isFixtureId,
  tierOneFixtureIds,
  type FixtureHandle,
  type WorkloadCommand,
} from "./fixtures/contract";
import { mountFixture } from "./fixtures/registry";
import "./styles.css";

const root = document.querySelector<HTMLElement>("#gallery-root");
if (!root) {
  throw new Error("Gallery root is missing");
}

const handles: FixtureHandle[] = [];
const parameters = new URLSearchParams(window.location.search);
const requestedFixture = parameters.get("fixture");
const requestedFixtureIds =
  requestedFixture && isFixtureId(requestedFixture)
    ? [requestedFixture]
    : tierOneFixtureIds;
const requestedCount = Number(parameters.get("count"));
const fixtureIds =
  Number.isInteger(requestedCount) && requestedCount > 0
    ? Array.from(
        { length: Math.min(500, requestedCount) },
        (_, index) =>
          requestedFixtureIds[index % requestedFixtureIds.length] ??
          tierOneFixtureIds[0],
      )
    : requestedFixtureIds;
for (const fixtureId of fixtureIds) {
  const card = document.createElement("article");
  card.className = "gallery-card";
  const heading = document.createElement("h2");
  heading.textContent = fixtureId;
  const surfaceRoot = document.createElement("div");
  surfaceRoot.className = "gallery-card__surface";
  card.append(heading, surfaceRoot);
  root.append(card);
  handles.push(await mountFixture(fixtureId, surfaceRoot));
}

window.__surfaceGallery = {
  async command(command: WorkloadCommand): Promise<void> {
    await Promise.all(handles.map((handle) => handle.command(command)));
  },
  snapshot: () => handles.map((handle) => handle.snapshot()),
};

window.addEventListener(
  "beforeunload",
  () => {
    for (const handle of handles) {
      handle.destroy();
    }
    delete window.__surfaceGallery;
  },
  { once: true },
);
