# Browser Surface Lab

## Purpose

- Provide fixed, neutral browser workloads (`fixture.html`, `gallery.html`), the
  `browser-surface-lab/v1` protocol, and the theme contract for hosts that frame
  real web content.
- Treat fixtures, settings, assets, proof counters, and `workload-manifest.json`
  as protected inputs. Changing them changes the measured workload.

## Isolation

- Fixtures know nothing about any pane system or host. Fixture and shared code
  may import only lab fixture modules, the workload manifest, and declared
  runtime dependencies; `pnpm contract` enforces this.
- Hosts interact only through the protocol, the theme contract, and URL
  parameters. Do not add host-specific fixture names, rates, URLs, counters,
  assets, or test shortcuts.
- Keep the protocol, theme contract, `fixture.html`, and
  `/assets/tier1-video.webm` compatible; external hosts depend on them.

## Dependencies and workloads

- Pin every direct dependency and the package manager exactly. Use the frozen
  lockfile and disabled lifecycle scripts.
- Do not patch, fork, override, or locally replace fixture dependencies.
- Three.js serves only the separately selectable procedural demos. Keep them out
  of the Tier 1 manifest. Keep other Tier 2 dependencies out unless they are
  separately reviewed.
- Never lower a workload, resolution, or update rate to make a host pass.
- Refreeze `receipts/protected-inputs.json` with `pnpm freeze:inputs` only for a
  reviewed baseline change. `pnpm integrity` checks it.

## Verification

- Prove each fixture works as a standalone page before using it in a container.
- Use `gallery.html` as the plain-container baseline.
- Report an unavailable browser capability, such as WebGPU or a visible surface,
  as unavailable rather than passing.
- Record work counters so hidden, paused, missing, or failed fixtures cannot be
  presented as completed work.
