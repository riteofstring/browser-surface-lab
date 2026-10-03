# Browser Surface Lab

Fixed, neutral browser workloads for testing how a container hosts real web
content. Every fixture runs as a standalone page, speaks a small `postMessage`
protocol, and accepts a host theme. Fixtures know nothing about any pane system
or host.

## Fixtures

| Fixture       | Fixed example                                     | Runtime                   |
| ------------- | ------------------------------------------------- | ------------------------- |
| `dom`         | 12 deep scrolling sections with 216 changing rows | Browser DOM               |
| `forms`       | 24 native controls with retained focus and input  | Browser DOM               |
| `react`       | 180 externally updated signal cards               | `react`, `react-dom`      |
| `canvas-2d`   | 960×540 field with 240 animated particles         | Canvas 2D                 |
| `video`       | Local 1280×720, 30 fps, eight-second VP9 video    | Native `<video>`          |
| `webgl-2`     | Fixed shader, geometry, and 64×64 texture         | Native WebGL 2            |
| `webgpu`      | Fixed pipeline, buffers, and 64×64 texture        | Native WebGPU             |
| `xterm-dom`   | Fixed ANSI byte stream at 20 writes per second    | `@xterm/xterm`            |
| `xterm-webgl` | The same ANSI bytes and terminal dimensions       | `@xterm/addon-webgl`      |
| `mixed`       | Forms, Canvas 2D, video, and xterm together       | Reuses the fixtures above |

These are the Tier 1 workloads. `workload-manifest.json` is the authority for
their sizes, rates, and counts.

`three-reactor` and `three-tidal` are separately selectable procedural Three.js
demos. They are not part of the Tier 1 manifest. They use procedural geometry
and shaders with no remote assets, cap the drawing-buffer pixel ratio at 1.5,
release their WebGL context while paused, and share one renderer per document.

`hover` is a playable Three.js take on Microsoft's 1995 _Hover!_. It keeps the
original's rules and gives every piece a purpose:

- You drive the red car and collect the blue flags; blue seeker drones collect
  your red ones. Only you and the seekers carry flags, and carried flags ride
  visibly on their car. Green hunters guard the blue flags, ping when they spot
  you, and ram you.
- Flags change hands by ramming. Hit a seeker hard enough (a head-on hit, or
  any hit under a green light) and one of your red flags drops loose; touch it
  to send it home. A hunter's hard hit knocks one of your blue flags loose for
  you to grab again. Seekers carrying flags flee once they see you close by.
- Flag stands are random each game, as in the original, but fair: blue stands
  sit a moderate drive from you and red stands a longer drive from the slower
  seekers. `seed=` replays a layout.
- Pods float in green bubbles showing their icon, so you can choose. Kept
  pods: a spring (A or Space) to jump onto ledges and over walls, tiles and
  drones; a wall (S) dropped behind you, which drones must route around; and
  a cloak (D) so that hunters lose you and seekers don't flee while you close
  in. Instant pods: green light (faster, harder rams), red light (slower),
  shield (no knock-loose, tiles or power-downs), map eraser, slower drones and
  random.
- Floor tiles: arrows push you the way they point, swirls hold you, and the
  flag tile sends the flag you carry home. Ramming a seeker onto it works too.
- Rounds cycle through three two-tier mazes after the original castle,
  futuristic city and sewer. Flags start at 3 a side and rise to 6, seekers
  quicken, and more drones join. You score per flag, per red flag kept and for
  time.

The HUD follows the original: flags, rear-view mirror, score, items, a radar
that reveals only explored ground, and speed. `maze=castle|city|sewer` picks
the first maze, like the original's Maze Type option, and M mutes the
synthesised sounds. On touch screens a translucent joystick steers and a
D-pad holds spring, wall, cloak and pause, shown only in play. The mazes and
textures are new and procedural, not the original's; the world keeps
Hover!'s colours while the theme styles the HUD and its fonts. The rules have
unit tests (`pnpm test:rules`). The game renders only during play, caps the
pixel ratio at 1.5, and when paused by its host keeps a still of the last frame
and releases its WebGL context. Like the other Three.js demos it is outside the
Tier 1 manifest.

## Pages

- `fixture.html?fixture=<id>` mounts one fixture. Add `embedding=surface` to
  drop the standalone page chrome when framing it.
- `gallery.html?count=18` repeats the Tier 1 fixtures in a plain grid, without a
  pane system. `gallery.html?fixture=<id>&count=<n>` repeats one fixture. Use it
  as the baseline when deciding whether a cost comes from the host or the
  workload.
- `index.html` links to both.

## Protocol

Fixtures implement `browser-surface-lab/v1`. After mounting, a fixture posts
`{ protocol, type: "ready", snapshot }` to its parent. A host sends
`{ protocol, command, requestId }`, where `command` is `start`, `pause`,
`resume`, or `reset`. The fixture replies with `type: "snapshot"`, the same
`requestId`, and its current snapshot.

A framed fixture also posts `{ protocol, type: "key", key, code, altKey,
ctrlKey, metaKey, shiftKey, repeat }` to its parent for every keydown it did not
handle (`defaultPrevented` is false) that carries Alt, Control or Meta, or is
Escape. Hosts can replay these as their own shortcuts, so keyboard focus inside
a frame does not trap the host's navigation. In the other direction, a parent can send
`{ protocol, command: "key", type: "keydown" | "keyup", key, code, shiftKey }`
to pass on a key its own document received; the fixture dispatches it as an
ordinary key event on its document. Snapshots carry proof counters, so hidden,
paused, or failed fixtures cannot pass as completed work. In the same document,
`window.__surfaceLab` exposes `command()` and `snapshot()` for automation.

## Theme contract

Fixture pages accept `colorMode=light` or `colorMode=dark`, or a `theme` query
parameter containing a JSON object with `colorMode` and `styles`. Only the
embedding parent can update a framed page:

```js
frame.contentWindow.postMessage(
  {
    protocol: "browser-surface-lab/v1",
    command: "theme",
    requestId: "appearance-1",
    theme: {
      colorMode: "light",
      styles: {
        surface: "#ffffff",
        text: "#202020",
        "font-family": "sans-serif",
      },
    },
  },
  fixtureOrigin,
);
```

The reply has `type: "theme-applied"` and the same `requestId`.

- Color styles: `page`, `surface`, `surface-raised`, `surface-sunken`, `text`,
  `text-strong`, `text-muted`, `text-subtle`, `border`, `accent`, `accent-alt`,
  `positive`, `warning`, and `focus`.
- Typography and shape styles: `font-family`, `font-mono`, `font-size`,
  `font-size-heading`, `font-size-small`, `font-size-label`, `font-size-tiny`,
  `font-weight`, `font-weight-heading`, `line-height`, `line-height-heading`,
  and `radius`.

Values must be concrete CSS values. URLs, references, and unknown keys are
rejected. Omitted styles use the selected mode's defaults. A family name does
not transfer font files. To use a custom web font, add `fonts`: up to eight
`{ family, source, weight?, style? }` entries whose `source` is a `.woff2` or
`.woff` URL on the fixture's own origin. The fixture loads them with the
FontFace API and drops fonts a later theme omits; any other source rejects the
whole theme.

Theme updates keep the workload, form values, terminal buffers, and Three.js
simulation state. Canvas, GPU, and Three.js surfaces repaint in the new palette.
A paused Three.js scene repaints once and does not resume. Media and fixed GPU
textures keep their own content. Appearance never changes workload sizes or
rates.

## Hosting the lab

A host builds or serves this repository and frames `fixture.html` pages. It
drives them only through the protocol and theme contract. For example,
the [Onirigiri playground](https://github.com/riteofstring/onirigiri/tree/main/playground)
expects this repository beside its `onirigiri` checkout and serves a Vite
build of `fixture.html` under `/surface-lab/`. It also serves the video asset at
`/assets/tier1-video.webm`.

A host that only needs the Three.js demos can instead build a self-contained
copy with `pnpm build:embed --outDir <dir>`. It emits `fixture.html` and its
chunks with relative URLs and no `public/` assets, so it works from any
same-origin subdirectory; each fixture still loads only its own chunks.

## Commands

```sh
pnpm install --frozen-lockfile
pnpm contract        # pinned dependencies and fixture isolation
pnpm typecheck
pnpm build
pnpm build:embed     # fixture.html only, relative base, no public assets
pnpm test:browser    # Playwright with installed Chrome; serves 127.0.0.1:5185
pnpm integrity       # compares the tree with receipts/protected-inputs.json
pnpm freeze:inputs   # records a new protected-input baseline
```

`pnpm dev:fixtures` serves the lab at `http://127.0.0.1:5185`. Browser tests use
`localhost:5185` as a second origin for cross-origin framing. The WebGPU and
WebGL fixtures report themselves as unsupported where the browser lacks the API.

## Code Polishy

The repository is governed by Code Polishy 0.28.1, pinned in
`.code-polishy.lock.json` and configured in `.code-polishy.json`. Run it through
the wrapper: `./code-polishyw setup` once after cloning, then for example
`./code-polishyw doctor --strict` or `./code-polishyw check --all`
(PowerShell: `.\code-polishyw.ps1`).

## License

[Apache License 2.0](LICENSE).
