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

export function installFixtureBridge(handle: FixtureHandle): () => void {
  const command = async (nextCommand: WorkloadCommand): Promise<void> => {
    await handle.command(nextCommand);
  };
  window.__surfaceLab = {
    command,
    snapshot: () => handle.snapshot(),
  };

  const onMessage = (event: MessageEvent<unknown>): void => {
    const value = event.data as { protocol?: unknown; command?: unknown; theme?: unknown; requestId?: unknown } | null;
    if (event.source === window.parent && value?.protocol === protocol && value.command === "theme") {
      if (isFixtureTheme(value.theme) && typeof value.requestId === "string" && value.requestId.length <= 128) {
        applyFixtureTheme(value.theme);
        window.parent.postMessage({ protocol, type: "theme-applied", requestId: value.requestId }, event.origin);
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
  window.addEventListener("message", onMessage);
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
