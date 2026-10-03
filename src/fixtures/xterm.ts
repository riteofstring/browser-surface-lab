import { fixtureColor, observeFixtureTheme } from "../shared/theme";
import { WebglAddon } from "@xterm/addon-webgl";
import { Terminal } from "@xterm/xterm";

import workloadManifest from "../../workload-manifest.json";

import type { FixtureFactory, TierOneFixtureId } from "./contract";
import { createFixtureLifecycle } from "./lifecycle";

const sourceLines = [
  "resolve workspace surface",
  "streaming structured records",
  "refreshing search index",
  "checking renderer health",
  "persisting local session",
  "waiting for operator input",
] as const;

function createTerminalFixture(
  fixtureId: TierOneFixtureId,
  useWebgl: boolean,
): FixtureFactory {
  return (root, options = {}) => {
    const workload = workloadManifest.fixtures[fixtureId];
    if (!("cols" in workload)) {
      throw new Error(`Terminal workload is missing for ${fixtureId}`);
    }
    root.className = "surface surface--terminal";
    const shell = document.createElement("div");
    shell.className = "terminal-shell";
    const terminalRoot = document.createElement("div");
    terminalRoot.className = "terminal-root";
    const label = document.createElement("div");
    label.className = "surface-label";
    label.innerHTML = `<span>xterm</span><strong>${useWebgl ? "WebGL renderer" : "Default DOM renderer"}</strong>`;
    shell.append(terminalRoot, label);
    root.replaceChildren(shell);

    const terminal = new Terminal({
      allowTransparency: false,
      cols: workload.cols,
      convertEol: true,
      cursorBlink: false,
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
      fontSize: 13,
      rows: workload.rows,
      scrollback: workload.scrollback,
      theme: {
        background: "#071019",
        foreground: "#d9e7ef",
        selectionBackground: "#35627c99",
      },
    });
    terminal.open(terminalRoot);
    const removeTheme = observeFixtureTheme(() => {
      const styles = getComputedStyle(
        root.isConnected ? root : root.ownerDocument.documentElement,
      );
      terminal.options.fontFamily = styles
        .getPropertyValue("--lab-font-mono")
        .trim();
      terminal.options.fontSize = Number.parseFloat(styles.fontSize);
      terminal.options.theme = {
        background: fixtureColor(root, "surface"),
        foreground: fixtureColor(root, "text"),
        selectionBackground: fixtureColor(root, "surface-raised"),
        cursor: fixtureColor(root, "focus"),
      };
    });
    let contextLosses = 0;
    let rendererAvailable = true;
    const webglAddon = useWebgl ? new WebglAddon() : null;
    const contextLossDisposable = webglAddon?.onContextLoss(() => {
      contextLosses += 1;
    });
    if (webglAddon) {
      try {
        terminal.loadAddon(webglAddon);
      } catch (error) {
        rendererAvailable = false;
        label
          .querySelector("strong")
          ?.replaceChildren(
            document.createTextNode(
              error instanceof Error
                ? error.message
                : "WebGL renderer unavailable",
            ),
          );
      }
    }

    let bytesConsumed = 0;
    let checksum = 0;
    let linesWritten = 0;
    let parsedWrites = 0;
    let timer: number | null = null;
    const parseDisposable = terminal.onWriteParsed(() => {
      parsedWrites += 1;
    });

    const writeLine = (): void => {
      const source = sourceLines[linesWritten % sourceLines.length];
      const severity =
        linesWritten % 9 === 0
          ? "\u001b[38;5;214mWARN\u001b[0m"
          : "\u001b[38;5;81mINFO\u001b[0m";
      const line = `${severity} ${String(linesWritten).padStart(5, "0")} ${source} · ${(linesWritten * 37) % 997}\r\n`;
      terminal.write(line);
      bytesConsumed += new TextEncoder().encode(line).byteLength;
      linesWritten += 1;
      checksum = (checksum * 33 + bytesConsumed + linesWritten) >>> 0;
    };
    for (let index = 0; index < workload.initialLines; index += 1) {
      writeLine();
    }

    const pause = (): void => {
      if (timer !== null) {
        window.clearInterval(timer);
        timer = null;
      }
    };
    const resume = (): void => {
      if (timer !== null) {
        return;
      }
      timer = window.setInterval(writeLine, workload.writeIntervalMs);
    };

    const handle = createFixtureLifecycle({
      destroy() {
        removeTheme();
        pause();
        contextLossDisposable?.dispose();
        parseDisposable.dispose();
        webglAddon?.dispose();
        terminal.dispose();
        root.replaceChildren();
      },
      fixtureId,
      pause,
      reset() {
        bytesConsumed = 0;
        checksum = 0;
        contextLosses = 0;
        linesWritten = 0;
        parsedWrites = 0;
        terminal.reset();
      },
      resume,
      snapshot() {
        const buffer = terminal.buffer.active;
        return {
          checksum,
          counters: {
            bufferLines: buffer.length,
            bytesConsumed,
            contextLosses,
            linesWritten,
            parsedWrites,
          },
          details: {
            cols: terminal.cols,
            renderer: useWebgl ? "webgl" : "dom",
            rows: terminal.rows,
          },
          supported: !useWebgl || (rendererAvailable && contextLosses === 0),
        };
      },
    });
    if (options.autoStart !== false) {
      handle.command("start");
    }
    return handle;
  };
}

export const createXtermDomFixture = createTerminalFixture("xterm-dom", false);
export const createXtermWebglFixture = createTerminalFixture(
  "xterm-webgl",
  true,
);
