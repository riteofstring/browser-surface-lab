import type { Controls } from "./hover-world";

type SetControl = (name: keyof Controls, value: boolean) => void;

const dead = 0.3;

const padButton = (
  control: keyof Controls | "pause",
  label: string,
  face: string,
  item?: string,
) =>
  `<button type="button" class="hover-pad-${control}" data-control="${control}" aria-label="${label}">${face}${item ? `<b data-item="${item}"></b>` : ""}</button>`;

/** A translucent joystick on the left and an item pad on the right. */
export const touchMarkup = `<div class="hover-touch">
  <div class="hover-stick" role="group" aria-label="Steer: push up to thrust, down to reverse, sideways to turn"><i></i></div>
  <div class="hover-pad" role="group" aria-label="Items">
    ${padButton("jump", "Spring", "Spring", "spring")}
    ${padButton("barrier", "Drop a wall", "Wall", "barrier")}
    ${padButton("cloak", "Cloak", "Cloak", "cloak")}
    ${padButton("pause", "Pause", "❚❚")}
  </div>
</div>`;

/** Wires the joystick and pad; returns a function that removes the listeners. */
export function bindTouchControls(
  root: HTMLElement,
  setControl: SetControl,
  onPress: () => void,
  onPause: () => void,
): () => void {
  const stick = root.querySelector<HTMLElement>(".hover-stick")!;
  const knob = stick.querySelector<HTMLElement>("i")!;
  const pad = root.querySelector<HTMLElement>(".hover-pad")!;
  let stickPointer: number | null = null;

  const steer = (x: number, y: number) => {
    setControl("thrust", y < -dead);
    setControl("reverse", y > dead + 0.15);
    setControl("left", x < -dead);
    setControl("right", x > dead);
  };

  const moveStick = (event: PointerEvent) => {
    if (event.pointerId !== stickPointer) return;
    const bounds = stick.getBoundingClientRect();
    const radius = bounds.width / 2;
    let x = (event.clientX - bounds.left - radius) / radius;
    let y = (event.clientY - bounds.top - radius) / radius;
    const length = Math.hypot(x, y);
    if (length > 1) {
      x /= length;
      y /= length;
    }
    knob.style.transform = `translate(${x * radius * 0.55}px, ${y * radius * 0.55}px)`;
    steer(x, y);
  };

  const grabStick = (event: PointerEvent) => {
    event.preventDefault();
    stickPointer = event.pointerId;
    if (event.isTrusted) stick.setPointerCapture(event.pointerId);
    onPress();
    moveStick(event);
  };

  const dropStick = (event: PointerEvent) => {
    if (event.pointerId !== stickPointer) return;
    stickPointer = null;
    knob.style.transform = "";
    steer(0, 0);
  };

  const press = (event: PointerEvent) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>(
      "[data-control]",
    );
    if (!button) return;
    event.preventDefault();
    const down = event.type === "pointerdown";
    const control = button.dataset.control!;
    if (control === "pause") {
      if (down) onPause();
      return;
    }
    if (down && event.isTrusted) button.setPointerCapture(event.pointerId);
    if (down) onPress();
    setControl(control as keyof Controls, down);
  };

  const listeners: [HTMLElement, string, (event: PointerEvent) => void][] = [
    [stick, "pointerdown", grabStick],
    [stick, "pointermove", moveStick],
    [stick, "pointerup", dropStick],
    [stick, "pointercancel", dropStick],
    [pad, "pointerdown", press],
    [pad, "pointerup", press],
    [pad, "pointercancel", press],
  ];
  for (const [element, type, listener] of listeners)
    element.addEventListener(type, listener as EventListener);
  return () => {
    for (const [element, type, listener] of listeners)
      element.removeEventListener(type, listener as EventListener);
  };
}
