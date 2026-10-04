import { expect, test, type Page } from "@playwright/test";

const snapshot = (page: Page) =>
  page.evaluate(() => window.__surfaceLab!.snapshot());

async function hold(page: Page, key: string, ms: number) {
  await page.keyboard.down(key);
  await page.waitForTimeout(ms);
  await page.keyboard.up(key);
}

test("hover drives to a pod, pauses with its pixels and resumes on request", async ({
  page,
}) => {
  // Several software-rendered screenshots; slow on a busy machine.
  test.setTimeout(90_000);
  await page.goto("/fixture.html?fixture=hover");
  await expect(page.getByRole("button", { name: "Start" })).toBeVisible();
  const ready = await snapshot(page);
  expect(ready.supported).toBe(true);
  expect(ready.details.state).toBe("ready");
  await page.waitForTimeout(150);
  expect((await snapshot(page)).counters.frames).toBe(ready.counters.frames);

  await page.getByRole("button", { name: "Start" }).click();
  await expect(page.locator(".hover")).toBeFocused();
  const start = await snapshot(page);
  await hold(page, "ArrowUp", 700);
  await expect(page.locator('.hover-items [data-item="spring"]')).toHaveText(
    "×1",
  );
  // The start faces north, and the spring pod sits one cell ahead.
  expect(Number((await snapshot(page)).details.z)).toBeLessThan(
    Number(start.details.z) - 1,
  );

  const canvas = await page.locator(".hover-canvas canvas").elementHandle();
  await page.evaluate(() => window.__surfaceLab!.command("pause"));
  const paused = await snapshot(page);
  expect(paused.details.state).toBe("paused");
  // Pausing draws nothing more: the canvas keeps its last frame on screen.
  await expect(page.locator(".hover-still")).toBeHidden();
  const frozen = await page.locator(".hover-viewport").screenshot();
  await page.waitForTimeout(300);
  const later = await snapshot(page);
  expect(later.counters.steps).toBe(paused.counters.steps);
  expect(later.counters.frames).toBe(paused.counters.frames);
  expect(
    (await page.locator(".hover-viewport").screenshot()).equals(frozen),
  ).toBe(true);

  await page.evaluate(() => window.__surfaceLab!.command("resume"));
  const resumed = await snapshot(page);
  expect(resumed.details.state).toBe("paused");
  // A quick return reuses the graphics context instead of rebuilding it.
  expect(await canvas!.evaluate((element) => element.isConnected)).toBe(true);
  await expect(page.getByRole("button", { name: "Resume" })).toBeVisible();
  await page.locator(".hover").focus();
  await page.keyboard.press("Enter");
  await expect
    .poll(async () => (await snapshot(page)).counters.steps)
    .toBeGreaterThan(paused.counters.steps!);
  // The paused still gives way to the live view again.
  await expect(page.locator(".hover-still")).toBeHidden();
  await expect(page.locator(".hover-canvas canvas")).toBeVisible();
  await page.keyboard.down("ArrowLeft");
  const before = await page.locator(".hover-viewport").screenshot();
  await page.waitForTimeout(400);
  const after = await page.locator(".hover-viewport").screenshot();
  await page.keyboard.up("ArrowLeft");
  expect(after.equals(before)).toBe(false);
  await expect(page.locator('.hover-items [data-item="spring"]')).toHaveText(
    "×1",
  );
});

test("hover collects a spring pod, springs with it and resets to round one", async ({
  page,
}) => {
  await page.goto("/fixture.html?fixture=hover");
  const spring = page.locator('.hover-items [data-item="spring"]');
  await expect(spring).toHaveText("×0");
  await page.getByRole("button", { name: "Start" }).click();
  await hold(page, "ArrowUp", 500);
  await expect(spring).toHaveText("×1");
  await page.keyboard.press("a");
  await expect(spring).toHaveText("×0");
  await expect
    .poll(async () => Number((await snapshot(page)).details.y))
    .toBeGreaterThan(0.5);
  await page.evaluate(() => window.__surfaceLab!.command("reset"));
  await expect(page.getByRole("button", { name: "Start" })).toBeVisible();
  await expect(spring).toHaveText("×0");
  const fresh = await snapshot(page);
  expect(fresh.counters.steps).toBe(0);
  expect(fresh.details.round).toBe(0);
  expect(fresh.details.maze).toBe("castle");
});

test("framed fixtures forward unhandled shortcut keys and loads same-origin host fonts", async ({
  page,
}) => {
  await page.goto("/index.html");
  const theme = {
    colorMode: "dark",
    fonts: [
      { family: "Host Pixel", source: "/missing-font.woff2", weight: "400" },
    ],
    styles: { "font-family": '"Host Pixel", monospace' },
  };
  await page.evaluate((theme) => {
    const messages: unknown[] = [];
    (window as Window & { messages?: unknown[] }).messages = messages;
    window.addEventListener("message", (event) => messages.push(event.data));
    const frame = document.createElement("iframe");
    frame.src = `/fixture.html?fixture=hover&embedding=surface&theme=${encodeURIComponent(JSON.stringify(theme))}`;
    frame.style.cssText = "width:640px;height:480px";
    document.body.append(frame);
  }, theme);
  const frame = page.frameLocator("iframe");
  await expect(frame.getByRole("button", { name: "Start" })).toBeVisible();
  const fixture = page.frames()[1]!;
  expect(
    await fixture.evaluate(() =>
      [...document.fonts].map((font) => font.family.replaceAll('"', "")),
    ),
  ).toContain("Host Pixel");
  await frame.getByRole("button", { name: "Start" }).click();
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("Alt+ArrowLeft");
  await page.keyboard.press("Escape");
  // Messages arrive asynchronously; wait for both.
  const keys = () =>
    page.evaluate(() =>
      (
        (
          window as Window & {
            messages?: { type?: string; key?: string; altKey?: boolean }[];
          }
        ).messages ?? []
      )
        .filter((message) => message?.type === "key")
        .map((message) => `${message.altKey ? "Alt+" : ""}${message.key}`),
    );
  await expect.poll(keys).toEqual(["Alt+ArrowLeft", "Escape"]);
  expect(
    await fixture.evaluate(() => window.__surfaceLab!.snapshot().details.state),
  ).toBe("paused");
});

test("theme rejects cross-origin font sources", async ({ page }) => {
  await page.goto("/fixture.html?fixture=hover&colorMode=light");
  await page.waitForFunction(() => window.__surfaceLab !== undefined);
  const applied = await page.evaluate(
    () =>
      new Promise<boolean>((resolve) => {
        window.addEventListener("message", (event) => {
          if (event.data?.type === "theme-applied") resolve(true);
        });
        setTimeout(() => resolve(false), 500);
        window.postMessage(
          {
            protocol: "browser-surface-lab/v1",
            command: "theme",
            requestId: "cross-origin-font",
            theme: {
              colorMode: "dark",
              fonts: [
                { family: "Remote", source: "https://fonts.example/a.woff2" },
              ],
            },
          },
          location.origin,
        );
      }),
  );
  expect(applied).toBe(false);
  await expect(page.locator("html")).toHaveAttribute(
    "data-color-mode",
    "light",
  );
});

test.describe("on a touch screen", () => {
  test.use({
    hasTouch: true,
    isMobile: true,
    viewport: { width: 400, height: 760 },
  });

  test("hover drives with the joystick and springs from the pad, shown only in play", async ({
    page,
  }) => {
    await page.goto("/fixture.html?fixture=hover&embedding=surface");
    const stick = page.locator(".hover-stick");
    await expect(page.getByRole("button", { name: "Start" })).toBeVisible();
    await expect(stick).toBeHidden();
    await page.getByRole("button", { name: "Start" }).tap();
    await expect(stick).toBeVisible();
    const push = (type: string, dy: number) =>
      stick.evaluate(
        (element, { type, dy }) => {
          const bounds = element.getBoundingClientRect();
          element.dispatchEvent(
            new PointerEvent(type, {
              pointerId: 7,
              pointerType: "touch",
              clientX: bounds.left + bounds.width / 2,
              clientY: bounds.top + bounds.height / 2 + dy * bounds.height,
              bubbles: true,
            }),
          );
        },
        { type, dy },
      );
    const spring = page.locator('.hover-pad [data-item="spring"]');
    await push("pointerdown", -0.45);
    await expect(spring).toHaveText("×1");
    await push("pointerup", 0);
    await page.locator(".hover-pad-jump").tap();
    await expect(spring).toHaveText("×0");
    await page.locator(".hover-pad-pause").tap();
    expect((await snapshot(page)).details.state).toBe("paused");
    await expect(stick).toBeHidden();
  });
});

test("hover loaded with autostart=0 creates no graphics until resumed", async ({
  page,
}) => {
  await page.goto("/fixture.html?fixture=hover&embedding=surface&autostart=0");
  await expect(page.getByRole("button", { name: "Start" })).toBeVisible();
  await page.waitForTimeout(300);
  const idle = await snapshot(page);
  expect(idle.running).toBe(false);
  expect(idle.counters.frames).toBe(0);
  await expect(page.locator(".hover-canvas canvas")).toHaveCount(0);
  await page.evaluate(() => window.__surfaceLab!.command("resume"));
  await expect(page.locator(".hover-canvas canvas")).toHaveCount(1);
  await expect
    .poll(async () => (await snapshot(page)).counters.frames)
    .toBeGreaterThan(0);
});

test("a host tint washes the view only while the game is paused", async ({
  page,
}) => {
  const theme = { colorMode: "dark", styles: { tint: "#8dff5a" } };
  await page.goto(
    `/fixture.html?fixture=hover&embedding=surface&theme=${encodeURIComponent(JSON.stringify(theme))}`,
  );
  const wash = () =>
    page.locator(".hover-viewport").evaluate((element) => {
      const style = getComputedStyle(element, "::after");
      return { color: style.backgroundColor, opacity: style.opacity };
    });
  await page.getByRole("button", { name: "Start" }).click();
  await expect.poll(async () => (await wash()).opacity).toBe("0");
  expect((await wash()).color).toBe("rgb(141, 255, 90)");
  await page.keyboard.press("p");
  await expect.poll(async () => (await wash()).opacity).toBe("0.6");
  await page.keyboard.press("p");
  await expect.poll(async () => (await wash()).opacity).toBe("0");
  await page.evaluate(() => window.__surfaceLab!.command("pause"));
  await expect.poll(async () => (await wash()).opacity).toBe("0.6");
});

test("hover.html serves the game alone with the same bridge and options", async ({
  page,
}) => {
  const requests: string[] = [];
  page.on("request", (request) => requests.push(request.url()));
  await page.goto("/hover.html?embedding=surface&autostart=0&maze=city");
  await expect(page.getByRole("button", { name: "Start" })).toBeVisible();
  const state = await snapshot(page);
  expect(state.fixtureId).toBe("hover");
  expect(state.running).toBe(false);
  expect(state.details.maze).toBe("city");
  expect(requests.some((url) => /xterm|react-dom/u.test(url))).toBe(false);
});

test("hover gives its graphics context back after half a minute paused", async ({
  page,
}) => {
  await page.clock.install();
  await page.goto("/fixture.html?fixture=hover&embedding=surface");
  await page.clock.runFor(500);
  await expect(page.locator(".hover-canvas canvas")).toHaveCount(1);
  await page.evaluate(() => window.__surfaceLab!.command("pause"));
  await page.clock.runFor(29_000);
  await expect(page.locator(".hover-canvas canvas")).toHaveCount(1);
  await page.clock.runFor(2_000);
  await expect(page.locator(".hover-canvas canvas")).toHaveCount(0);
  expect((await snapshot(page)).details.rendering).toBe(false);
  await expect(page.locator(".hover-still")).toBeVisible();
});
