import workloadManifest from "../../workload-manifest.json";

import type { FixtureFactory } from "./contract";
import { createFixtureLifecycle } from "./lifecycle";

const workload = workloadManifest.fixtures.dom;
const sectionCount = workload.sectionCount;
const rowsPerSection = workload.rowsPerSection;

export const createDomFixture: FixtureFactory = (root, options = {}) => {
  root.className = "surface surface--dom";
  const shell = document.createElement("div");
  shell.className = "document-shell";
  const sidebar = document.createElement("aside");
  sidebar.className = "document-sidebar";
  sidebar.innerHTML = `<strong>Field notes</strong><span>12 sections</span><span>216 records</span>`;
  const documentBody = document.createElement("div");
  documentBody.className = "document-body";
  const pulseCells: HTMLElement[] = [];

  for (let sectionIndex = 0; sectionIndex < sectionCount; sectionIndex += 1) {
    const section = document.createElement("section");
    section.className = "document-section";
    const heading = document.createElement("h2");
    heading.textContent = `Section ${String(sectionIndex + 1).padStart(2, "0")}`;
    section.append(heading);
    const table = document.createElement("div");
    table.className = "document-table";
    for (let rowIndex = 0; rowIndex < rowsPerSection; rowIndex += 1) {
      const row = document.createElement("div");
      row.className = "document-row";
      row.innerHTML = `<span>${String(rowIndex + 1).padStart(2, "0")}</span><span>Signal ${sectionIndex + 1}.${rowIndex + 1}</span><span data-pulse>${(sectionIndex * 17 + rowIndex * 13) % 100}</span>`;
      const pulseCell = row.querySelector<HTMLElement>("[data-pulse]");
      if (pulseCell) {
        pulseCells.push(pulseCell);
      }
      table.append(row);
    }
    section.append(table);
    documentBody.append(section);
  }

  shell.append(sidebar, documentBody);
  root.replaceChildren(shell);

  let checksum = 216;
  let mutations = 0;
  let timer: number | null = null;
  let ticks = 0;

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
    timer = window.setInterval(() => {
      ticks += 1;
      const cellIndex = (ticks * 37) % pulseCells.length;
      const cell = pulseCells[cellIndex];
      const value = (ticks * 29 + cellIndex * 11) % 1000;
      if (cell) {
        cell.textContent = String(value);
      }
      mutations += 1;
      checksum = (checksum * 31 + value) >>> 0;
    }, workload.updateIntervalMs);
  };

  const handle = createFixtureLifecycle({
    destroy() {
      pause();
      root.replaceChildren();
    },
    fixtureId: "dom",
    pause,
    reset() {
      checksum = 216;
      mutations = 0;
      ticks = 0;
    },
    resume,
    snapshot() {
      return {
        checksum,
        counters: { mutations, records: sectionCount * rowsPerSection, ticks },
        details: { sections: sectionCount },
        supported: true,
      };
    },
  });
  if (options.autoStart !== false) {
    handle.command("start");
  }
  return handle;
};
