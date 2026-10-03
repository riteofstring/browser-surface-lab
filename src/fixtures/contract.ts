export const tierOneFixtureIds = [
  "dom",
  "forms",
  "react",
  "canvas-2d",
  "video",
  "webgl-2",
  "webgpu",
  "xterm-dom",
  "xterm-webgl",
  "mixed",
] as const;

export type TierOneFixtureId = (typeof tierOneFixtureIds)[number];

export type FixtureId =
  | TierOneFixtureId
  | "three-reactor"
  | "three-tidal"
  | "hover";

export type WorkloadCommand = "pause" | "reset" | "resume" | "start";

export type FixtureDetail = boolean | number | string | null;

export interface FixtureSnapshot {
  checksum: number;
  counters: Record<string, number>;
  details: Record<string, FixtureDetail>;
  fixtureId: FixtureId;
  running: boolean;
  supported: boolean;
}

export interface FixtureHandle {
  command(command: WorkloadCommand): Promise<void> | void;
  destroy(): void;
  snapshot(): FixtureSnapshot;
}

export interface FixtureMountOptions {
  autoStart?: boolean;
}

export type FixtureFactory = (
  root: HTMLElement,
  options?: FixtureMountOptions,
) => FixtureHandle | Promise<FixtureHandle>;

export function isTierOneFixtureId(value: string): value is TierOneFixtureId {
  return tierOneFixtureIds.some((fixtureId) => fixtureId === value);
}

export function isFixtureId(value: string): value is FixtureId {
  return (
    isTierOneFixtureId(value) ||
    value === "three-reactor" ||
    value === "three-tidal" ||
    value === "hover"
  );
}

export function fixtureIdFromSearch(search: string): FixtureId {
  const value = new URLSearchParams(search).get("fixture") ?? "dom";
  return isFixtureId(value) ? value : "dom";
}

declare global {
  interface Window {
    __surfaceGallery?: {
      command(command: WorkloadCommand): Promise<void>;
      snapshot(): FixtureSnapshot[];
    };
    __surfaceLab?: {
      command(command: WorkloadCommand): Promise<void>;
      snapshot(): FixtureSnapshot;
    };
  }
}
