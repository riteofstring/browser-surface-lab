import "@xterm/xterm/css/xterm.css";

import { fixtureIdFromSearch } from "./fixtures/contract";
import { mountFixture } from "./fixtures/registry";
import { startFixturePage } from "./fixture-page";
import "./styles.css";

const fixtureId = fixtureIdFromSearch(window.location.search);
await startFixturePage(fixtureId, (root, options) =>
  mountFixture(fixtureId, root, options),
);
