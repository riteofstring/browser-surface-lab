import { expect, test, type Page } from "@playwright/test";

const snapshot = (page: Page) =>
  page.evaluate(() => window.__surfaceLab!.snapshot());

async function hold(page: Page, key: string, ms: number) {
  await page.keyboard.down(key);
  await page.waitForTimeout(ms);
  await page.keyboard.up(key);
}

test("hover drives to a flag, pauses with its pixels and resumes on request", async ({
  page,
}) => {
  await page.goto("/fixture.html?fixture=hover");
  await expect(page.getByRole("button", { name: "Start" })).toBeVisible();
  const ready = await snapshot(page);
  expect(ready.supported).toBe(true);
  expect(ready.details.state).toBe("ready");
  await page.waitForTimeout(150);
  expect((await snapshot(page)).counters.frames).toBe(ready.counters.frames);

  await page.getByRole("button", { name: "Start" }).click();
  await expect(page.locator(".hover")).toBeFocused();
  await hold(page, "ArrowUp", 1400);
  await expect
    .poll(async () => (await snapshot(page)).counters.playerFlags)
    .toBe(1);
  await expect(page.locator('.hover-pips[data-team="blue"]')).toHaveText("●○○");

  await page.evaluate(() => window.__surfaceLab!.command("pause"));
  const paused = await snapshot(page);
  expect(paused.details.state).toBe("paused");
  expect(paused.details.rendering).toBe(false);
  await expect(page.locator(".hover-still")).toBeVisible();
  await page.waitForTimeout(150);
  expect((await snapshot(page)).counters.steps).toBe(paused.counters.steps);

  await page.evaluate(() => window.__surfaceLab!.command("resume"));
  const resumed = await snapshot(page);
  expect(resumed.details.rendering).toBe(true);
  expect(resumed.details.state).toBe("paused");
  await expect(page.getByRole("button", { name: "Resume" })).toBeVisible();
  await page.locator(".hover").focus();
  await page.keyboard.press("Enter");
  await expect
    .poll(async () => (await snapshot(page)).counters.steps)
    .toBeGreaterThan(paused.counters.steps!);
  expect((await snapshot(page)).counters.playerFlags).toBe(1);
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
  const keys = await page.evaluate(() =>
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
  expect(keys).toEqual(["Alt+ArrowLeft", "Escape"]);
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
