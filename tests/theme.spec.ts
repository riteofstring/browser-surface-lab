import { expect, test, type Page } from "@playwright/test";

async function applyTheme(
  page: Page,
  colorMode: "light" | "dark",
  styles: Record<string, string> = {},
) {
  await page.evaluate(
    async ({ colorMode, styles }) => {
      await new Promise<void>((resolve) => {
        const requestId = crypto.randomUUID();
        const receive = (event: MessageEvent) => {
          if (
            event.source === window &&
            event.data?.type === "theme-applied" &&
            event.data.requestId === requestId
          ) {
            window.removeEventListener("message", receive);
            resolve();
          }
        };
        window.addEventListener("message", receive);
        window.postMessage(
          {
            protocol: "browser-surface-lab/v1",
            command: "theme",
            theme: { colorMode, styles },
            requestId,
          },
          location.origin,
        );
      });
    },
    { colorMode, styles },
  );
}

for (const fixture of [
  "dom",
  "forms",
  "react",
  "canvas-2d",
  "video",
  "webgl-2",
  "webgpu",
  "xterm-dom",
  "xterm-webgl",
  "mixed",
  "three-reactor",
  "three-tidal",
  "hover",
]) {
  test(`${fixture} accepts host appearance without remounting its workload`, async ({
    page,
  }) => {
    const theme = {
      colorMode: "light",
      styles: {
        surface: "#faf8f5",
        text: "#242424",
        "font-family": "monospace",
        "font-size": "13px",
        "font-size-heading": "23px",
        "font-size-small": "15px",
        "font-size-label": "12px",
        "font-weight-heading": "600",
        "line-height-heading": "1.2",
        radius: "8px",
      },
    };
    await page.goto(
      `/fixture.html?fixture=${fixture}&embedding=surface&theme=${encodeURIComponent(JSON.stringify(theme))}`,
    );
    await page.waitForFunction(() => window.__surfaceLab !== undefined);
    await expect(page.locator("html")).toHaveAttribute(
      "data-color-mode",
      "light",
    );
    await expect(page.locator(".surface").first()).toHaveCSS(
      "background-color",
      "rgb(250, 248, 245)",
    );
    if (
      ["dom", "forms", "react", "three-reactor", "three-tidal"].includes(
        fixture,
      )
    ) {
      await expect(page.locator(".surface h2").first()).toHaveCSS(
        "font-family",
        "monospace",
      );
      await expect(page.locator(".surface h2").first()).toHaveCSS(
        "font-size",
        "23px",
      );
      await expect(page.locator(".surface h2").first()).toHaveCSS(
        "font-weight",
        "600",
      );
    }
    const surface = await page.locator(".surface").first().elementHandle();
    const original = await page.evaluate(() => window.__surfaceLab!.snapshot());
    expect(original.supported).toBe(true);
    if (fixture === "forms")
      await page.getByRole("textbox").first().fill("Keep this edit");
    await applyTheme(page, "dark", {
      surface: "#181818",
      text: "#eeeeee",
      "font-family": "sans-serif",
    });
    await expect(page.locator(".surface").first()).toHaveCSS(
      "background-color",
      "rgb(24, 24, 24)",
    );
    await expect(page.locator("html")).toHaveCSS("font-family", "sans-serif");
    expect(await surface!.evaluate((node) => node.isConnected)).toBe(true);
    const after = await page.evaluate(() => window.__surfaceLab!.snapshot());
    expect(after.supported).toBe(true);
    expect(after.running).toBe(original.running);
    for (const [key, value] of Object.entries(original.counters))
      expect(after.counters[key]).toBeGreaterThanOrEqual(value);
    if (fixture === "forms")
      await expect(page.getByRole("textbox").first()).toHaveValue(
        "Keep this edit",
      );
    if (fixture.startsWith("xterm"))
      expect(after.counters.bytesConsumed).toBeGreaterThanOrEqual(
        original.counters.bytesConsumed!,
      );
    await applyTheme(page, "light");
    await expect(page.locator(".surface").first()).toHaveCSS(
      "background-color",
      "rgb(255, 255, 255)",
    );
  });
}

test("ignores invalid style input without changing the running fixture", async ({
  page,
}) => {
  await page.goto("/fixture.html?fixture=forms&colorMode=light");
  await page.waitForFunction(() => window.__surfaceLab !== undefined);
  await page.evaluate(() =>
    window.postMessage(
      {
        protocol: "browser-surface-lab/v1",
        command: "theme",
        requestId: "invalid",
        theme: {
          colorMode: "dark",
          styles: { surface: "url(https://invalid.example/image.png)" },
        },
      },
      location.origin,
    ),
  );
  await expect(page.locator("html")).toHaveAttribute(
    "data-color-mode",
    "light",
  );
  expect(
    await page.evaluate(() => window.__surfaceLab!.snapshot().supported),
  ).toBe(true);
});

for (const fixture of ["three-reactor", "three-tidal"]) {
  test(`${fixture} repaints paused graphics with host overrides without restarting`, async ({
    page,
  }) => {
    await page.goto(`/fixture.html?fixture=${fixture}&embedding=surface`);
    await page.waitForFunction(
      () => (window.__surfaceLab?.snapshot().counters.frames ?? 0) > 3,
    );
    await page.getByRole("slider").fill("1.5");
    await page.evaluate(() => window.__surfaceLab!.command("pause"));
    const paused = await page.evaluate(() => window.__surfaceLab!.snapshot());
    const canvas = page.locator(".three-viewport canvas");
    const original = await canvas.elementHandle();
    const colors = {
      surface: "#ffffff",
      accent: "#ff0000",
      "accent-alt": "#ff0000",
      positive: "#ff0000",
      warning: "#ff0000",
      "text-subtle": "#ff0000",
    };
    await applyTheme(page, "light", {
      ...colors,
      "font-family": "serif",
      "font-mono": "monospace",
      "font-size": "18px",
      "font-size-heading": "28px",
      "font-size-small": "16px",
      "font-size-label": "14px",
    });
    await expect(page.locator(".three-header h2")).toHaveCSS(
      "font-family",
      "serif",
    );
    await expect(page.locator(".three-header h2")).toHaveCSS(
      "font-size",
      "28px",
    );
    await expect(page.locator(".three-header p")).toHaveCSS(
      "font-size",
      "16px",
    );
    await expect(page.locator(".three-eyebrow")).toHaveCSS(
      "font-family",
      "monospace",
    );
    await expect(page.locator(".three-eyebrow")).toHaveCSS("font-size", "14px");
    const red = await canvas.screenshot();
    const pixels = await canvas.evaluate((element: HTMLCanvasElement) => {
      const data = element
        .getContext("2d")!
        .getImageData(0, 0, element.width, element.height).data;
      let red = 0,
        blue = 0,
        background = 0;
      for (let index = 0; index < data.length; index += 4) {
        if (data[index]! > data[index + 2]! + 30) red++;
        if (data[index + 2]! > data[index]! + 30) blue++;
        if (
          data[index] === 255 &&
          data[index + 1] === 255 &&
          data[index + 2] === 255
        )
          background++;
      }
      return { red, blue, background };
    });
    expect(pixels.red).toBeGreaterThan(100);
    expect(pixels.blue).toBe(0);
    expect(pixels.background).toBeGreaterThan(1000);
    await applyTheme(page, "dark", {
      surface: "#000000",
      accent: "#0000ff",
      "accent-alt": "#0000ff",
      positive: "#0000ff",
      warning: "#0000ff",
      "text-subtle": "#0000ff",
    });
    expect((await canvas.screenshot()).equals(red)).toBe(false);
    expect(await original!.evaluate((node) => node.isConnected)).toBe(true);
    const after = await page.evaluate(() => window.__surfaceLab!.snapshot());
    expect(after.running).toBe(false);
    expect(after.details.time).toBe(paused.details.time);
    expect(after.counters).toEqual(paused.counters);
    await expect(page.getByRole("slider")).toHaveValue("1.5");
    await page.evaluate(() => window.__surfaceLab!.command("resume"));
    await expect
      .poll(() =>
        page.evaluate(() => window.__surfaceLab!.snapshot().counters.frames),
      )
      .toBeGreaterThan(paused.counters.frames!);
    await expect(page.getByRole("alert")).toBeHidden();
  });
}
