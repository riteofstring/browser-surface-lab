import { expect, test, type Page } from "@playwright/test";

interface ElementImage {
  readonly width: number;
  close(): void;
}

interface ElementCanvas extends HTMLCanvasElement {
  captureElementImage(element: Element): ElementImage;
  requestPaint(): void;
}

interface ElementQueue extends GPUQueue {
  copyElementImageToTexture(
    source: { source: ElementImage },
    destination: {
      destination: { texture: GPUTexture; premultipliedAlpha: boolean };
      width: number;
      height: number;
    },
  ): void;
}

test.use({
  launchOptions: { args: ["--enable-blink-features=CanvasDrawElement"] },
  viewport: { width: 1000, height: 900 },
});

async function openFixture(page: Page, framed: boolean) {
  await page.goto(
    "/fixture.html?fixture=canvas-2d&embedding=surface&colorMode=dark",
  );
  await page.waitForFunction(() => window.__surfaceLab?.snapshot().running);
  await page.evaluate(() => window.__surfaceLab!.command("pause"));
  if (framed) {
    await page.evaluate(() => {
      document.body.innerHTML =
        '<div id="capture-content" style="width:480px;height:760px"><iframe src="/fixture.html?fixture=canvas-2d&embedding=surface&colorMode=dark" style="width:100%;height:100%;border:0;display:block"></iframe></div>';
    });
    await page.waitForFunction(
      () =>
        document
          .querySelector("iframe")
          ?.contentWindow?.__surfaceLab?.snapshot().running,
    );
    await page.evaluate(() =>
      document
        .querySelector("iframe")!
        .contentWindow!.__surfaceLab!.command("pause"),
    );
  } else {
    await page.locator("#fixture-root").evaluate((root) => {
      root.id = "capture-content";
    });
  }
}

async function capturePixels(page: Page) {
  return page.evaluate(async () => {
    const content = document.querySelector<HTMLElement>("#capture-content")!;
    const parent = content.parentElement!;
    const canvas = document.createElement("canvas") as ElementCanvas;
    const width = content.offsetWidth;
    const height = content.offsetHeight;
    canvas.width = width * devicePixelRatio;
    canvas.height = height * devicePixelRatio;
    canvas.style.cssText = `display:block;width:${width}px;height:${height}px`;
    canvas.setAttribute("layoutsubtree", "");
    content.setAttribute("drawable", "");
    const device =
      await (await navigator.gpu.requestAdapter())!.requestDevice();
    const context = canvas.getContext("webgpu") as GPUCanvasContext;
    context.configure({
      device,
      format: "rgba8unorm",
      alphaMode: "premultiplied",
      usage: 0x02 | 0x10,
    });
    parent.insertBefore(canvas, content);
    canvas.moveBefore(content, null);
    try {
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
      return await new Promise<string>((resolve, reject) => {
        let scale = 1;
        const paint = () => {
          let image: ElementImage | undefined;
          try {
            image = canvas.captureElementImage(content);
            if (Math.abs(image.width - width) > 1) {
              scale *= image.width / width;
              Object.assign(canvas.style, {
                zoom: String(1 / scale),
                scale: String(scale),
                transformOrigin: "0 0",
              });
              canvas.requestPaint();
              return;
            }
            (device.queue as ElementQueue).copyElementImageToTexture(
              { source: image },
              {
                destination: {
                  texture: context.getCurrentTexture(),
                  premultipliedAlpha: true,
                },
                width: canvas.width,
                height: canvas.height,
              },
            );
            canvas.removeEventListener("paint", paint);
            resolve(canvas.toDataURL());
          } catch (error) {
            reject(error);
          } finally {
            image?.close();
          }
        };
        canvas.addEventListener("paint", paint);
        canvas.requestPaint();
      });
    } finally {
      parent.moveBefore(content, canvas);
      content.removeAttribute("drawable");
      canvas.remove();
      device.destroy();
    }
  });
}

for (const dpr of [1, 2]) {
  test.describe(`Canvas 2D capture at pixel ratio ${dpr}`, () => {
    test.use({ deviceScaleFactor: dpr });
    for (const framed of [false, true]) {
      test(`preserves native crop through paused resizing ${framed ? "inside an iframe" : "in a plain container"}`, async ({
        page,
      }, info) => {
        await openFixture(page, framed);
        const identity = await page.evaluate(() => {
          const owner =
            document.querySelector("iframe")?.contentDocument ?? document;
          const canvas = owner.querySelector<HTMLCanvasElement>(
            ".canvas-shell canvas",
          )!;
          canvas.dataset.identity = crypto.randomUUID();
          return { id: canvas.dataset.identity, bitmap: canvas.toDataURL() };
        });
        for (const [width, height] of [
          [480, 760],
          [760, 320],
          [320, 560],
        ]) {
          await page.locator("#capture-content").evaluate(
            (element, size) => {
              Object.assign((element as HTMLElement).style, {
                width: `${size.width}px`,
                height: `${size.height}px`,
                minHeight: "0",
                border: "0",
                borderRadius: "0",
              });
            },
            { width, height },
          );
          await page.evaluate(
            () =>
              new Promise<void>((resolve) =>
                requestAnimationFrame(() =>
                  requestAnimationFrame(() => resolve()),
                ),
              ),
          );
          const native = await page.locator("#capture-content").screenshot({
            path: info.outputPath(`native-${width}-${height}.png`),
          });
          const captured = await capturePixels(page);
          const difference = await page.evaluate(
            async ({ native, captured, dpr }) => {
              async function pixels(url: string) {
                const bitmap = await createImageBitmap(
                  await (await fetch(url)).blob(),
                );
                const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
                const context = canvas.getContext("2d")!;
                context.drawImage(bitmap, 0, 0);
                bitmap.close();
                return context.getImageData(0, 0, canvas.width, canvas.height);
              }
              const expected = await pixels(`data:image/png;base64,${native}`);
              const actual = await pixels(captured);
              let error = 0;
              let channels = 0;
              let mismatches = 0;
              for (let y = 10; y < expected.height - 90 * dpr; y += 2) {
                for (let x = 10; x < expected.width - 10; x += 2) {
                  const offset = (y * expected.width + x) * 4;
                  let difference = 0;
                  for (let channel = 0; channel < 3; channel += 1)
                    difference += Math.abs(
                      expected.data[offset + channel]! -
                        actual.data[offset + channel]!,
                    );
                  error += difference;
                  channels += 3;
                  if (difference > 15) mismatches += 1;
                }
              }
              return {
                expected: [expected.width, expected.height],
                actual: [actual.width, actual.height],
                meanError: error / channels,
                mismatchedPixels: mismatches / (channels / 3),
              };
            },
            { native: native.toString("base64"), captured, dpr },
          );
          await info.attach(`capture-${width}-${height}`, {
            body: Buffer.from(captured.split(",")[1]!, "base64"),
            contentType: "image/png",
          });
          expect(difference.actual).toEqual(difference.expected);
          expect(difference.meanError).toBeLessThan(0.5);
          expect(difference.mismatchedPixels).toBeLessThan(0.005);
          const after = await page.evaluate(() => {
            const owner =
              document.querySelector("iframe")?.contentDocument ?? document;
            const canvas = owner.querySelector<HTMLCanvasElement>(
              ".canvas-shell canvas",
            )!;
            return {
              id: canvas.dataset.identity,
              bitmap: canvas.toDataURL(),
              width: canvas.width,
              height: canvas.height,
            };
          });
          expect(after).toEqual({ ...identity, width: 960, height: 540 });
        }
      });
    }
  });
}
