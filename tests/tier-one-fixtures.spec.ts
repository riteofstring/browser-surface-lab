import { expect, test } from "@playwright/test";

import workloadManifest from "../workload-manifest.json" with { type: "json" };
import {
  tierOneFixtureIds,
  isTierOneFixtureId,
  type FixtureSnapshot,
  type TierOneFixtureId,
} from "../src/fixtures/contract";

function progress(snapshot: FixtureSnapshot): number {
  const countersByFixture: Record<TierOneFixtureId, string> = {
    "canvas-2d": "frames",
    "webgl-2": "frames",
    "xterm-dom": "linesWritten",
    "xterm-webgl": "linesWritten",
    dom: "ticks",
    forms: "ticks",
    mixed: "childFrames",
    react: "ticks",
    video: "decodedFrames",
    webgpu: "frames",
  };
  if (!isTierOneFixtureId(snapshot.fixtureId))
    throw new Error("Expected a Tier 1 fixture snapshot");
  return snapshot.counters[countersByFixture[snapshot.fixtureId]] ?? 0;
}

function expectManifestContract(snapshot: FixtureSnapshot): void {
  if (snapshot.fixtureId === "dom") {
    expect(snapshot.counters.records).toBe(
      workloadManifest.fixtures.dom.rowsPerSection *
        workloadManifest.fixtures.dom.sectionCount,
    );
  } else if (snapshot.fixtureId === "forms") {
    expect(snapshot.counters.fields).toBe(
      workloadManifest.fixtures.forms.fieldCount,
    );
  } else if (snapshot.fixtureId === "react") {
    expect(snapshot.counters.cells).toBe(
      workloadManifest.fixtures.react.cellCount,
    );
  } else if (snapshot.fixtureId === "canvas-2d") {
    expect(snapshot.counters.particles).toBe(
      workloadManifest.fixtures["canvas-2d"].particleCount,
    );
    expect(snapshot.details.width).toBe(
      workloadManifest.fixtures["canvas-2d"].width,
    );
    expect(snapshot.details.height).toBe(
      workloadManifest.fixtures["canvas-2d"].height,
    );
  } else if (snapshot.fixtureId === "video") {
    expect(snapshot.details.videoWidth).toBe(
      workloadManifest.fixtures.video.width,
    );
    expect(snapshot.details.videoHeight).toBe(
      workloadManifest.fixtures.video.height,
    );
    expect(snapshot.details.duration).toBeCloseTo(
      workloadManifest.fixtures.video.durationSeconds,
      1,
    );
  } else if (
    snapshot.fixtureId === "webgl-2" ||
    snapshot.fixtureId === "webgpu"
  ) {
    const workload = workloadManifest.fixtures[snapshot.fixtureId];
    expect(snapshot.details.width).toBe(workload.width);
    expect(snapshot.details.height).toBe(workload.height);
    expect(snapshot.details.textureWidth).toBe(workload.textureSize);
  } else if (
    snapshot.fixtureId === "xterm-dom" ||
    snapshot.fixtureId === "xterm-webgl"
  ) {
    const workload = workloadManifest.fixtures[snapshot.fixtureId];
    expect(snapshot.details.cols).toBe(workload.cols);
    expect(snapshot.details.rows).toBe(workload.rows);
    expect(snapshot.counters.linesWritten).toBeGreaterThanOrEqual(
      workload.initialLines,
    );
  } else {
    expect(snapshot.counters.children).toBe(
      workloadManifest.fixtures.mixed.children.length,
    );
  }
}

for (const fixtureId of tierOneFixtureIds) {
  test(`${fixtureId} runs as a standalone protected fixture`, async ({
    page,
  }) => {
    await page.goto(`/fixture.html?fixture=${fixtureId}`);
    await page.waitForFunction(() => window.__surfaceLab !== undefined);
    const initial = await page.evaluate(() => window.__surfaceLab!.snapshot());
    expect(initial.fixtureId).toBe(fixtureId);
    expect(initial.running).toBe(true);
    expect(initial.checksum).toBeGreaterThanOrEqual(0);

    await page.waitForTimeout(450);
    const advanced = await page.evaluate(() => window.__surfaceLab!.snapshot());
    expectManifestContract(advanced);
    if (advanced.supported) {
      expect(progress(advanced)).toBeGreaterThan(progress(initial));
      expect(advanced.checksum).not.toBe(initial.checksum);
    }

    await page.evaluate(() => window.__surfaceLab!.command("pause"));
    const paused = await page.evaluate(() => window.__surfaceLab!.snapshot());
    expect(paused.running).toBe(false);
    await page.evaluate(() => window.__surfaceLab!.command("resume"));
    expect(
      await page.evaluate(() => window.__surfaceLab!.snapshot().running),
    ).toBe(true);
  });
}

test("native forms retain user state across lifecycle commands", async ({
  page,
}) => {
  await page.goto("/fixture.html?fixture=forms");
  await page.locator('[name="setting-2"]').fill("Operator retained value");
  await page.evaluate(() => window.__surfaceLab!.command("pause"));
  await page.evaluate(() => window.__surfaceLab!.command("resume"));
  await expect(page.locator('[name="setting-2"]')).toHaveValue(
    "Operator retained value",
  );
  expect(
    await page.evaluate(
      () => window.__surfaceLab!.snapshot().counters.inputEvents,
    ),
  ).toBeGreaterThan(0);
});

test("plain container mounts the same selected fixture", async ({ page }) => {
  await page.goto("/gallery.html?fixture=dom");
  await page.waitForFunction(() => window.__surfaceGallery !== undefined);
  const snapshots = await page.evaluate(() =>
    window.__surfaceGallery!.snapshot(),
  );
  expect(snapshots).toHaveLength(1);
  expect(snapshots[0]?.fixtureId).toBe("dom");
  expect(snapshots[0]?.counters.records).toBe(
    workloadManifest.fixtures.dom.rowsPerSection *
      workloadManifest.fixtures.dom.sectionCount,
  );
});

test("plain container repeats the protected fixtures for a neutral baseline", async ({
  page,
}) => {
  await page.goto("/gallery.html?count=18");
  await page.waitForFunction(
    () => window.__surfaceGallery?.snapshot().length === 18,
  );
  const snapshots = await page.evaluate(() =>
    window.__surfaceGallery!.snapshot(),
  );
  expect(snapshots).toHaveLength(18);
  expect(snapshots.map((snapshot) => snapshot.fixtureId)).toEqual(
    Array.from(
      { length: 18 },
      (_, index) => tierOneFixtureIds[index % tierOneFixtureIds.length],
    ),
  );
});
