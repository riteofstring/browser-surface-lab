# Lab architecture

The lab is one module because its pages, fixtures, and repository tooling ship
and change together as one measured workload. Splitting them would not create
an independently built or tested boundary.

## Dependency direction

- Fixture modules (`src/fixtures`) and the shared runtime (`src/shared`) form
  one runtime. The shared bridge reads the fixture contract types, and
  fixtures use the shared theme and bridge helpers.
- Fixture and shared code may import only each other, `workload-manifest.json`,
  and declared runtime dependencies. `pnpm contract` enforces this, along with
  exact dependency pins, the absence of overrides, disabled lifecycle scripts,
  and a complete Tier 1 manifest.
- Page entries (`src/*-entry.ts`, loaded by `fixture.html`, `gallery.html`, and
  `index.html`) import the fixture registry, contract, bridge, and theme.
  Fixtures never import page entries.
- Repository scripts read files from the checkout and import no browser code.

## Evidence

The browser suite drives the real pages in installed Chrome. Hosts depend only
on the `browser-surface-lab/v1` protocol, the theme contract, URL parameters,
and `/assets/tier1-video.webm`, so tests exercise those surfaces instead of
internal functions. The quick Tier 1 suite proves every protected fixture runs
standalone and inside the plain-container gallery. The full suite adds theme,
Canvas 2D capture, and Three.js lifecycle coverage.
