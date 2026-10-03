interface FixtureFont {
  family: string;
  source: string;
  style?: "italic" | "normal";
  weight?: string;
}

interface FixtureTheme {
  colorMode: "dark" | "light";
  fonts?: FixtureFont[];
  styles?: Partial<Record<FixtureStyleName, string>>;
}

const colorStyles = [
  "page",
  "surface",
  "surface-raised",
  "surface-sunken",
  "text",
  "text-strong",
  "text-muted",
  "text-subtle",
  "border",
  "accent",
  "accent-alt",
  "positive",
  "warning",
  "focus",
] as const;
const sizeStyles = [
  "font-size",
  "font-size-heading",
  "font-size-small",
  "font-size-label",
  "font-size-tiny",
] as const;
const weightStyles = ["font-weight", "font-weight-heading"] as const;
const lineStyles = ["line-height", "line-height-heading"] as const;
const textStyles = [
  "font-family",
  "font-mono",
  ...sizeStyles,
  ...weightStyles,
  ...lineStyles,
  "radius",
] as const;
type FixtureStyleName =
  (typeof colorStyles)[number] | (typeof textStyles)[number];

function styleProperty(name: string): string | null {
  if (colorStyles.some((key) => key === name)) return "color";
  if (name === "font-family" || name === "font-mono") return "font-family";
  if (sizeStyles.some((key) => key === name)) return "font-size";
  if (weightStyles.some((key) => key === name)) return "font-weight";
  if (lineStyles.some((key) => key === name)) return "line-height";
  if (name === "radius") return "border-radius";
  return null;
}

function fontSource(source: string): URL | null {
  try {
    const url = new URL(source, window.location.href);
    return url.origin === window.location.origin &&
      /\.woff2?$/u.test(url.pathname)
      ? url
      : null;
  } catch {
    return null;
  }
}

const fontRules: Record<
  keyof FixtureFont,
  { required: boolean; valid(value: string): boolean }
> = {
  family: {
    required: true,
    valid: (value) => /^[\p{L}\p{N} ._-]{1,64}$/u.test(value),
  },
  source: {
    required: true,
    valid: (value) => value.length <= 512 && fontSource(value) !== null,
  },
  style: {
    required: false,
    valid: (value) => value === "normal" || value === "italic",
  },
  weight: { required: false, valid: (value) => /^[1-9]00$/u.test(value) },
};

function isFixtureFont(value: unknown): value is FixtureFont {
  if (!value || typeof value !== "object") return false;
  const font = value as Record<string, unknown>;
  return Object.entries(fontRules).every(([name, rule]) => {
    const field = font[name];
    return field === undefined
      ? !rule.required
      : typeof field === "string" && rule.valid(field);
  });
}

export function isFixtureTheme(value: unknown): value is FixtureTheme {
  if (!value || typeof value !== "object") return false;
  const theme = value as Partial<FixtureTheme>;
  if (theme.colorMode !== "dark" && theme.colorMode !== "light") return false;
  return areFixtureFonts(theme.fonts) && areFixtureStyles(theme.styles);
}

function areFixtureFonts(fonts: unknown): boolean {
  return (
    fonts === undefined ||
    (Array.isArray(fonts) && fonts.length <= 8 && fonts.every(isFixtureFont))
  );
}

function areFixtureStyles(styles: unknown): boolean {
  if (styles === undefined) return true;
  if (!styles || typeof styles !== "object" || Array.isArray(styles))
    return false;
  return Object.entries(styles).every(([name, value]) => {
    const property = styleProperty(name);
    return (
      property !== null &&
      typeof value === "string" &&
      value.length <= 512 &&
      !/var\(|url\(|inherit|initial|unset|revert/iu.test(value) &&
      CSS.supports(property, value)
    );
  });
}

const hostFonts = new Map<string, FontFace>();

function applyFixtureFonts(fonts: readonly FixtureFont[]): void {
  const wanted = new Map(
    fonts.map((font) => {
      const descriptors = {
        style: font.style ?? "normal",
        weight: font.weight ?? "400",
      };
      const href = fontSource(font.source)!.href;
      return [
        JSON.stringify([font.family, href, descriptors]),
        { family: font.family, href, descriptors },
      ] as const;
    }),
  );
  for (const [key, face] of hostFonts)
    if (!wanted.has(key)) {
      document.fonts.delete(face);
      hostFonts.delete(key);
    }
  for (const [key, font] of wanted) {
    if (hostFonts.has(key)) continue;
    const face = new FontFace(
      font.family,
      `url(${JSON.stringify(font.href)})`,
      font.descriptors,
    );
    hostFonts.set(key, face);
    document.fonts.add(face);
    void face
      .load()
      .then(() => window.dispatchEvent(new Event("surface-lab-themechange")))
      .catch(() => {});
  }
}

export function applyFixtureTheme(theme: FixtureTheme): void {
  const root = document.documentElement;
  applyFixtureFonts(theme.fonts ?? []);
  root.dataset.colorMode = theme.colorMode;
  for (const name of [...colorStyles, ...textStyles]) {
    const value = theme.styles?.[name];
    if (value === undefined) root.style.removeProperty(`--lab-${name}`);
    else root.style.setProperty(`--lab-${name}`, value);
  }
  window.dispatchEvent(new Event("surface-lab-themechange"));
}

export function applyInitialFixtureTheme(search: string): void {
  const query = new URLSearchParams(search);
  const serialized = query.get("theme");
  if (serialized && serialized.length <= 12_000) {
    try {
      const value: unknown = JSON.parse(serialized);
      if (isFixtureTheme(value)) {
        applyFixtureTheme(value);
        return;
      }
    } catch {}
  }
  applyFixtureTheme({
    colorMode: query.get("colorMode") === "light" ? "light" : "dark",
  });
}

export function observeFixtureTheme(update: () => void): () => void {
  update();
  window.addEventListener("surface-lab-themechange", update);
  return () => window.removeEventListener("surface-lab-themechange", update);
}

export function fixtureColor(
  root: HTMLElement,
  name: (typeof colorStyles)[number],
): string {
  const color = getComputedStyle(
    root.isConnected ? root : root.ownerDocument.documentElement,
  )
    .getPropertyValue(`--lab-${name}`)
    .trim();
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  const context = canvas.getContext("2d")!;
  context.fillStyle = color;
  context.fillRect(0, 0, 1, 1);
  const channels = context.getImageData(0, 0, 1, 1).data;
  return `#${[...channels]
    .slice(0, 3)
    .map((channel) => channel.toString(16).padStart(2, "0"))
    .join("")}`;
}

export function fixtureBackground(
  root: HTMLElement,
): [number, number, number, number] {
  const hex = fixtureColor(root, "surface");
  return [1, 3, 5]
    .map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255)
    .concat(1) as [number, number, number, number];
}
