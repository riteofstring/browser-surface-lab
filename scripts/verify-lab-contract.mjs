import { readdirSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const packageJson = JSON.parse(
  readFileSync(resolve(root, "package.json"), "utf8"),
);
const npmrc = readFileSync(resolve(root, ".npmrc"), "utf8");
const workloadManifest = JSON.parse(
  readFileSync(resolve(root, "workload-manifest.json"), "utf8"),
);
const expectedFixtureIds = [
  "canvas-2d",
  "dom",
  "forms",
  "mixed",
  "react",
  "video",
  "webgl-2",
  "webgpu",
  "xterm-dom",
  "xterm-webgl",
];

for (const dependencyGroup of ["dependencies", "devDependencies"]) {
  for (const [name, version] of Object.entries(
    packageJson[dependencyGroup] ?? {},
  )) {
    if (
      typeof version !== "string" ||
      !/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/u.test(version)
    ) {
      throw new Error(`${name} is not pinned exactly: ${version}`);
    }
  }
}
if (
  typeof packageJson.packageManager !== "string" ||
  !/^pnpm@\d+\.\d+\.\d+$/u.test(packageJson.packageManager)
) {
  throw new Error("The package manager is not pinned exactly");
}
if (packageJson.pnpm?.overrides || packageJson.resolutions) {
  throw new Error("Dependency overrides are forbidden");
}
if (!npmrc.split(/\r?\n/u).includes("ignore-scripts=true")) {
  throw new Error("Lifecycle scripts are not disabled");
}
for (const tierTwoPackage of [
  "chart.js",
  "echarts",
  "hls.js",
  "shaka-player",
]) {
  if (
    packageJson.dependencies?.[tierTwoPackage] ||
    packageJson.devDependencies?.[tierTwoPackage]
  ) {
    throw new Error(`Tier 2 package is present: ${tierTwoPackage}`);
  }
}

const runtimePackages = new Set(Object.keys(packageJson.dependencies ?? {}));
const fixtureRoots = [
  resolve(root, "src", "fixtures"),
  resolve(root, "src", "shared"),
];
const allowedLocalPaths = [
  ...fixtureRoots,
  resolve(root, "workload-manifest.json"),
];
const importPattern = /(?:\bfrom\s*|\bimport\s*\(?\s*)["']([^"']+)["']/gu;

function packageName(specifier) {
  const parts = specifier.split("/");
  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
}

for (const directory of fixtureRoots) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isFile() || !/\.(?:ts|tsx)$/u.test(entry.name)) {
      continue;
    }
    const sourcePath = resolve(directory, entry.name);
    const source = readFileSync(sourcePath, "utf8");
    for (const [, specifier] of source.matchAll(importPattern)) {
      if (specifier.startsWith(".")) {
        const target = resolve(directory, specifier);
        if (
          !allowedLocalPaths.some(
            (allowed) =>
              target === allowed || !relative(allowed, target).startsWith(".."),
          )
        ) {
          throw new Error(
            `Fixture source imports outside the lab fixtures: ${relative(root, sourcePath)} -> ${specifier}`,
          );
        }
      } else if (!runtimePackages.has(packageName(specifier))) {
        throw new Error(
          `Fixture source imports an undeclared package: ${relative(root, sourcePath)} -> ${specifier}`,
        );
      }
    }
  }
}

const manifestFixtureIds = Object.keys(workloadManifest.fixtures).sort();
if (JSON.stringify(manifestFixtureIds) !== JSON.stringify(expectedFixtureIds)) {
  throw new Error("The Tier 1 workload manifest is incomplete");
}
process.stdout.write("Tier 1 isolation contract passed\n");
