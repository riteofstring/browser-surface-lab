import { expect, test } from "@playwright/test";

for (const fixture of ["three-reactor", "three-tidal"]) {
  test(`${fixture} animates, pauses, resumes and resizes as an independent fixture`, async ({
    page,
  }) => {
    await page.goto(`/fixture.html?fixture=${fixture}`);
    const canvas = page.locator(".three-viewport canvas");
    await expect(canvas).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(() => window.__surfaceLab!.snapshot().counters.frames),
      )
      .toBeGreaterThan(5);
    await expect(page.getByRole("slider")).toHaveValue("1");
    await page.getByRole("slider").evaluate((element: HTMLInputElement) => {
      element.value = "1.5";
      element.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const before = await canvas.screenshot();
    await page.waitForTimeout(120);
    expect((await canvas.screenshot()).equals(before)).toBe(false);
    await page.evaluate(() => window.__surfaceLab!.command("pause"));
    const paused = await page.evaluate(() => window.__surfaceLab!.snapshot());
    const frozen = await canvas.screenshot();
    await page.waitForTimeout(120);
    expect(
      await page.evaluate(
        () => window.__surfaceLab!.snapshot().counters.frames,
      ),
    ).toBe(paused.counters.frames);
    expect((await canvas.screenshot()).equals(frozen)).toBe(true);
    await page.evaluate(() => window.__surfaceLab!.command("resume"));
    await expect
      .poll(() =>
        page.evaluate(() => window.__surfaceLab!.snapshot().counters.frames),
      )
      .toBeGreaterThan(paused.counters.frames! + 5);
    await expect(page.getByRole("slider")).toHaveValue("1.5");
    for (const viewport of [
      { width: 700, height: 1000 },
      { width: 1280, height: 900 },
    ]) {
      await page.setViewportSize(viewport);
      await expect
        .poll(() =>
          canvas.evaluate((element: HTMLCanvasElement) =>
            Math.abs(
              element.width / element.height -
                element.clientWidth / element.clientHeight,
            ),
          ),
        )
        .toBeLessThan(0.005);
    }
    await page.evaluate(() => window.__surfaceLab!.command("reset"));
    expect(
      await page.evaluate(() => window.__surfaceLab!.snapshot().running),
    ).toBe(false);
    await expect(page.getByRole("slider")).toHaveValue("1");
  });
}

test("Three.js reports graphics loss and retries without losing settings", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext;
    Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
      value: function (this: HTMLCanvasElement, ...args: unknown[]) {
        const context = Reflect.apply(getContext, this, args);
        if (args[0] === "webgl2" && context)
          (window as Window & { graphics?: WebGL2RenderingContext }).graphics =
            context;
        return context;
      },
    });
  });
  await page.goto("/fixture.html?fixture=three-reactor");
  const canvas = page.locator(".three-viewport canvas");
  await expect(canvas).toBeVisible();
  await page.waitForFunction(() => window.__surfaceLab !== undefined);
  await expect
    .poll(() =>
      page.evaluate(() => window.__surfaceLab!.snapshot().counters.frames),
    )
    .toBeGreaterThan(5);
  await page.getByRole("slider").evaluate((element: HTMLInputElement) => {
    element.value = "1.7";
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.evaluate(() =>
    (window as Window & { graphics?: WebGL2RenderingContext })
      .graphics!.getExtension("WEBGL_lose_context")!
      .loseContext(),
  );
  await expect(page.getByRole("alert")).toBeVisible();
  expect(
    await page.evaluate(() => window.__surfaceLab!.snapshot().supported),
  ).toBe(false);
  await page.getByRole("button", { name: "Retry graphics" }).click();
  await expect(page.getByRole("alert")).toBeHidden();
  await expect(page.getByRole("slider")).toHaveValue("1.7");
  const before = await canvas.screenshot();
  await page.waitForTimeout(120);
  expect((await canvas.screenshot()).equals(before)).toBe(false);
});

test("Three.js demos run in a plain container and accept cross-origin lifecycle messages", async ({
  page,
}) => {
  await page.goto("/gallery.html?fixture=three-reactor&count=2");
  await expect(page.locator(".three-viewport canvas")).toHaveCount(2);
  await expect
    .poll(() =>
      page.evaluate(() =>
        window
          .__surfaceGallery!.snapshot()
          .every((snapshot) => snapshot.counters.frames! > 5),
      ),
    )
    .toBe(true);
  await page.goto("/");
  await page.evaluate(() => {
    const frame = document.createElement("iframe");
    frame.title = "Cross-origin Three.js demo";
    frame.src =
      "http://localhost:5185/fixture.html?fixture=three-tidal&embedding=surface";
    frame.style.cssText = "width:600px;height:600px";
    document.body.append(frame);
  });
  await page.locator("iframe").scrollIntoViewIfNeeded();
  const canvas = page.frameLocator("iframe").locator(".three-viewport canvas");
  await expect(canvas).toBeVisible();
  const response = await page.evaluate(
    () =>
      new Promise<{ running: boolean }>((resolve) => {
        const frame = document.querySelector("iframe")!;
        const receive = (event: MessageEvent) => {
          if (
            event.source !== frame.contentWindow ||
            event.data?.requestId !== "pause-demo"
          )
            return;
          window.removeEventListener("message", receive);
          resolve(event.data.snapshot);
        };
        window.addEventListener("message", receive);
        frame.contentWindow!.postMessage(
          {
            protocol: "browser-surface-lab/v1",
            command: "pause",
            requestId: "pause-demo",
          },
          "http://localhost:5185",
        );
      }),
  );
  expect(response.running).toBe(false);
  const before = await canvas.screenshot();
  await page.waitForTimeout(120);
  expect((await canvas.screenshot()).equals(before)).toBe(true);
});
