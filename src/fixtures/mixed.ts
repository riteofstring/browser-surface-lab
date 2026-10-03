import { fixtureSnapshotChecksum } from "../shared/bridge";
import { createCanvas2dFixture } from "./canvas-2d";
import type { FixtureFactory, FixtureHandle } from "./contract";
import { createFormsFixture } from "./forms";
import { createFixtureLifecycle } from "./lifecycle";
import { createVideoFixture } from "./video";
import { createXtermDomFixture } from "./xterm";

const mixedFactories = [
  createFormsFixture,
  createCanvas2dFixture,
  createVideoFixture,
  createXtermDomFixture,
] as const;

export const createMixedFixture: FixtureFactory = async (
  root,
  options = {},
) => {
  root.className = "surface surface--mixed";
  const grid = document.createElement("div");
  grid.className = "mixed-grid";
  const handles: FixtureHandle[] = [];

  for (const factory of mixedFactories) {
    const cell = document.createElement("div");
    cell.className = "mixed-grid__cell";
    grid.append(cell);
    handles.push(await factory(cell, { autoStart: false }));
  }
  root.replaceChildren(grid);

  const commandAll = async (
    command: "pause" | "reset" | "resume",
  ): Promise<void> => {
    await Promise.all(handles.map((handle) => handle.command(command)));
  };
  const handle = createFixtureLifecycle({
    destroy() {
      for (const child of handles) {
        child.destroy();
      }
      root.replaceChildren();
    },
    fixtureId: "mixed",
    pause() {
      void commandAll("pause");
    },
    reset() {
      void commandAll("reset");
    },
    resume() {
      void commandAll("resume");
    },
    snapshot() {
      const snapshots = handles.map((child) => child.snapshot());
      return {
        checksum: fixtureSnapshotChecksum(snapshots),
        counters: {
          activeChildren: snapshots.filter((snapshot) => snapshot.running)
            .length,
          childFrames: snapshots.reduce(
            (total, snapshot) => total + (snapshot.counters.frames ?? 0),
            0,
          ),
          children: snapshots.length,
        },
        details: {
          childFixtures: snapshots
            .map((snapshot) => snapshot.fixtureId)
            .join(","),
        },
        supported: snapshots.every((snapshot) => snapshot.supported),
      };
    },
  });
  if (options.autoStart !== false) {
    handle.command("start");
  }
  return handle;
};
