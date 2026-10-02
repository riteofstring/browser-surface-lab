import workloadManifest from "../../workload-manifest.json";

import type { FixtureFactory } from "./contract";
import { createFixtureLifecycle } from "./lifecycle";

const workload = workloadManifest.fixtures.forms;
const fieldCount = workload.fieldCount;

export const createFormsFixture: FixtureFactory = (root, options = {}) => {
  root.className = "surface surface--forms";
  const form = document.createElement("form");
  form.className = "settings-form";
  const heading = document.createElement("div");
  heading.className = "settings-form__heading";
  heading.innerHTML = `<div><span class="eyebrow">Workspace profile</span><h2>Operator settings</h2></div><output data-form-pulse>Revision 0</output>`;
  form.append(heading);

  for (let index = 0; index < fieldCount; index += 1) {
    const field = document.createElement("label");
    field.className = "settings-field";
    const label = document.createElement("span");
    label.textContent = `Setting ${String(index + 1).padStart(2, "0")}`;
    let control: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
    if (index % 6 === 0) {
      control = document.createElement("textarea");
      control.rows = 2;
      control.value = `Persistent note ${index + 1}`;
    } else if (index % 5 === 0) {
      control = document.createElement("select");
      for (const value of ["Quiet", "Balanced", "Active"]) {
        const option = document.createElement("option");
        option.value = value.toLowerCase();
        option.textContent = value;
        control.append(option);
      }
    } else {
      control = document.createElement("input");
      control.type = index % 4 === 0 ? "range" : "text";
      control.value = control.type === "range" ? String(index * 3) : `Value ${index + 1}`;
    }
    control.name = `setting-${index + 1}`;
    field.append(label, control);
    form.append(field);
  }

  const choices = document.createElement("fieldset");
  choices.innerHTML = `<legend>Delivery</legend><label><input type="checkbox" name="digest" checked> Daily digest</label><label><input type="checkbox" name="alerts"> Priority alerts</label><label><input type="radio" name="channel" value="email" checked> Email</label><label><input type="radio" name="channel" value="desktop"> Desktop</label>`;
  form.append(choices);
  root.replaceChildren(form);

  const pulse = form.querySelector<HTMLOutputElement>("[data-form-pulse]");
  let checksum = 24;
  let inputEvents = 0;
  let timer: number | null = null;
  let ticks = 0;
  const onInput = (event: Event): void => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement)) {
      return;
    }
    inputEvents += 1;
    checksum = (checksum * 31 + target.value.length + inputEvents) >>> 0;
  };
  form.addEventListener("input", onInput);

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
      if (pulse) {
        pulse.value = `Revision ${ticks}`;
      }
      checksum = (checksum * 33 + ticks) >>> 0;
    }, workload.updateIntervalMs);
  };

  const handle = createFixtureLifecycle({
    destroy() {
      pause();
      form.removeEventListener("input", onInput);
      root.replaceChildren();
    },
    fixtureId: "forms",
    pause,
    reset() {
      checksum = 24;
      inputEvents = 0;
      ticks = 0;
      form.reset();
      if (pulse) {
        pulse.value = "Revision 0";
      }
    },
    resume,
    snapshot() {
      return {
        checksum,
        counters: { fields: fieldCount, inputEvents, ticks },
        details: {
          activeControl:
            document.activeElement instanceof HTMLElement
              ? document.activeElement.getAttribute("name")
              : null,
        },
        supported: true,
      };
    },
  });
  if (options.autoStart !== false) {
    handle.command("start");
  }
  return handle;
};
