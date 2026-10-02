import type {
  FixtureHandle,
  FixtureSnapshot,
  FixtureId,
  WorkloadCommand,
} from "./contract";

interface LifecycleOptions {
  destroy?(): void;
  fixtureId: FixtureId;
  pause?(): void;
  reset?(): void;
  resume?(): void;
  snapshot(): Omit<FixtureSnapshot, "fixtureId" | "running">;
  start?(): void;
}

export function createFixtureLifecycle(
  options: LifecycleOptions,
): FixtureHandle {
  let destroyed = false;
  let running = false;

  const setRunning = (nextRunning: boolean): void => {
    if (destroyed || running === nextRunning) {
      return;
    }
    running = nextRunning;
    if (running) {
      options.resume?.();
    } else {
      options.pause?.();
    }
  };

  const command = (nextCommand: WorkloadCommand): void => {
    if (destroyed) {
      return;
    }
    if (nextCommand === "pause") {
      setRunning(false);
      return;
    }
    if (nextCommand === "reset") {
      setRunning(false);
      options.reset?.();
      return;
    }
    if (nextCommand === "resume") {
      setRunning(true);
      return;
    }
    if (!running) {
      running = true;
      options.start?.();
      if (!options.start) {
        options.resume?.();
      }
    }
  };

  return {
    command,
    destroy() {
      if (destroyed) {
        return;
      }
      setRunning(false);
      destroyed = true;
      options.destroy?.();
    },
    snapshot() {
      return {
        ...options.snapshot(),
        fixtureId: options.fixtureId,
        running,
      };
    },
  };
}
