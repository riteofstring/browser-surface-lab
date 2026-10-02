import { useEffect, useMemo, useState } from "react";
import { createRoot, type Root } from "react-dom/client";

import workloadManifest from "../../workload-manifest.json";

import type { FixtureFactory } from "./contract";
import { createFixtureLifecycle } from "./lifecycle";

const workload = workloadManifest.fixtures.react;

interface ReactWorkloadProps {
  epoch: number;
  onCommit(value: number): void;
  running: boolean;
}

function ReactWorkload({ epoch, onCommit, running }: ReactWorkloadProps) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    setTick(0);
  }, [epoch]);
  useEffect(() => {
    if (!running) {
      return;
    }
    const timer = window.setInterval(() => {
      setTick((value) => value + 1);
    }, workload.updateIntervalMs);
    return () => window.clearInterval(timer);
  }, [running]);
  useEffect(() => {
    onCommit(tick);
  }, [onCommit, tick]);

  const values = useMemo(
    () =>
      Array.from({ length: workload.cellCount }, (_, index) =>
        Math.round((Math.sin((index + tick) * 0.17) + 1) * 50),
      ),
    [tick],
  );

  return (
    <section className="react-dashboard">
      <header>
        <div>
          <span className="eyebrow">External state stream</span>
          <h2>{workload.cellCount} live signals</h2>
        </div>
        <output>{running ? `Tick ${tick}` : "Paused"}</output>
      </header>
      <div className="react-dashboard__grid">
        {values.map((value, index) => (
          <div className="react-signal" key={index}>
            <span>{String(index + 1).padStart(3, "0")}</span>
            <strong>{value}</strong>
            <i style={{ transform: `scaleX(${value / 100})` }} />
          </div>
        ))}
      </div>
    </section>
  );
}

export const createReactFixture: FixtureFactory = (rootElement, options = {}) => {
  rootElement.className = "surface surface--react";
  const reactRoot: Root = createRoot(rootElement);
  let checksum = workload.cellCount;
  let commits = 0;
  let epoch = 0;
  let lastTick = 0;
  let running = false;

  const onCommit = (tick: number): void => {
    commits += 1;
    lastTick = tick;
    checksum = (checksum * 31 + tick * 17 + commits) >>> 0;
  };
  const render = (): void => {
    reactRoot.render(
      <ReactWorkload epoch={epoch} onCommit={onCommit} running={running} />,
    );
  };

  render();
  const handle = createFixtureLifecycle({
    destroy() {
      reactRoot.unmount();
    },
    fixtureId: "react",
    pause() {
      running = false;
      render();
    },
    reset() {
      checksum = workload.cellCount;
      commits = 0;
      epoch += 1;
      lastTick = 0;
      render();
    },
    resume() {
      running = true;
      render();
    },
    snapshot() {
      return {
        checksum,
        counters: { cells: workload.cellCount, commits, ticks: lastTick },
        details: { epoch },
        supported: true,
      };
    },
  });
  if (options.autoStart !== false) {
    handle.command("start");
  }
  return handle;
};
