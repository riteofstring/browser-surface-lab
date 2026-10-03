import { applyFixtureTheme, isFixtureTheme } from "./theme";
import type {
  FixtureHandle,
  FixtureSnapshot,
  WorkloadCommand,
} from "../fixtures/contract";

const protocol = "browser-surface-lab/v1";

interface CommandMessage {
  command: WorkloadCommand;
  protocol: typeof protocol;
  requestId?: string;
}

function isCommandMessage(value: unknown): value is CommandMessage {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Partial<CommandMessage>;
  return (
    candidate.protocol === protocol &&
    (candidate.command === "pause" ||
      candidate.command === "reset" ||
      candidate.command === "resume" ||
      candidate.command === "start")
  );
}

interface HostKey {
  command: "key";
  key: string;
  code?: string;
  protocol: typeof protocol;
  shiftKey?: boolean;
  type: "keydown" | "keyup";
}

function isHostKey(value: unknown): value is HostKey {
  const candidate = value as Partial<HostKey> | null;
  return (
    candidate?.protocol === protocol &&
    candidate.command === "key" &&
    (candidate.type === "keydown" || candidate.type === "keyup") &&
    typeof candidate.key === "string" &&
    candidate.key.length <= 32
  );
}

/** A host passing on a key its document received while the fixture should
 * have had it; the fixture sees an ordinary key event. */
function replayHostKey(value: unknown): boolean {
  if (!isHostKey(value)) return false;
  document.dispatchEvent(
    new KeyboardEvent(value.type, {
      key: value.key,
      code: typeof value.code === "string" ? value.code : "",
      shiftKey: value.shiftKey === true,
      bubbles: true,
      cancelable: true,
    }),
  );
  return true;
}

export function installFixtureBridge(handle: FixtureHandle): () => void {
  const command = async (nextCommand: WorkloadCommand): Promise<void> => {
    await handle.command(nextCommand);
  };
  window.__surfaceLab = {
    command,
    snapshot: () => handle.snapshot(),
  };

  const onMessage = (event: MessageEvent<unknown>): void => {
    if (event.source === window.parent && replayHostKey(event.data)) return;
    const value = event.data as {
      protocol?: unknown;
      command?: unknown;
      theme?: unknown;
      requestId?: unknown;
    } | null;
    if (
      event.source === window.parent &&
      value?.protocol === protocol &&
      value.command === "theme"
    ) {
      if (
        isFixtureTheme(value.theme) &&
        typeof value.requestId === "string" &&
        value.requestId.length <= 128
      ) {
        applyFixtureTheme(value.theme);
        window.parent.postMessage(
          { protocol, type: "theme-applied", requestId: value.requestId },
          event.origin,
        );
      }
      return;
    }
    if (!isCommandMessage(event.data)) {
      return;
    }
    const message = event.data;
    void command(message.command).then(() => {
      const response = {
        protocol,
        requestId: message.requestId ?? null,
        snapshot: handle.snapshot(),
        type: "snapshot",
      };
      if (event.source && "postMessage" in event.source) {
        event.source.postMessage(response, { targetOrigin: event.origin });
      }
    });
  };
  const forwardKey = (event: KeyboardEvent): void => {
    if (
      window.parent === window ||
      event.defaultPrevented ||
      ["Alt", "Control", "Meta", "Shift"].includes(event.key) ||
      !(
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.key === "Escape"
      )
    ) {
      return;
    }
    window.parent.postMessage(
      {
        protocol,
        type: "key",
        key: event.key,
        code: event.code,
        altKey: event.altKey,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        shiftKey: event.shiftKey,
        repeat: event.repeat,
      },
      "*",
    );
  };
  window.addEventListener("message", onMessage);
  window.addEventListener("keydown", forwardKey);
  window.parent.postMessage(
    {
      protocol,
      snapshot: handle.snapshot(),
      type: "ready",
    },
    "*",
  );

  return () => {
    window.removeEventListener("message", onMessage);
    window.removeEventListener("keydown", forwardKey);
    delete window.__surfaceLab;
  };
}

export function fixtureSnapshotChecksum(
  snapshots: readonly FixtureSnapshot[],
): number {
  return snapshots.reduce(
    (checksum, snapshot) => (checksum * 33 + snapshot.checksum) >>> 0,
    5381,
  );
}
