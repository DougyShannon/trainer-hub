// The game's buttons, laid out like a GBA: a D-pad, A, B and Start. The keyboard and the on-screen
// touch buttons both press the same buttons, so the rest of the game never cares which was used.

export type Button = "up" | "down" | "left" | "right" | "a" | "b" | "start";

export const BUTTONS: Button[] = ["up", "down", "left", "right", "a", "b", "start"];

/** Which keyboard keys press which button. */
export const KEYS: Record<string, Button> = {
  ArrowUp: "up",
  KeyW: "up",
  ArrowDown: "down",
  KeyS: "down",
  ArrowLeft: "left",
  KeyA: "left",
  ArrowRight: "right",
  KeyD: "right",
  KeyZ: "a",
  Space: "a",
  KeyX: "b",
  Backspace: "b",
  Escape: "b",
  Enter: "start",
};

/** How long a held button waits before it starts repeating (menus), then how often it repeats. */
const REPEAT_DELAY = 0.35;
const REPEAT_EVERY = 0.1;

export class Input {
  private held = new Map<Button, number>(); // button → seconds held
  private fresh = new Set<Button>(); // pressed since the last frame
  private repeats = new Set<Button>(); // repeat ticks this frame

  press(button: Button) {
    if (!this.held.has(button)) {
      this.held.set(button, 0);
      this.fresh.add(button);
    }
  }

  release(button: Button) {
    this.held.delete(button);
  }

  releaseAll() {
    this.held.clear();
  }

  /** Called by the game loop once a frame, after the scenes have read the buttons. */
  endFrame(dt: number) {
    this.fresh.clear();
    this.repeats.clear();
    for (const [button, time] of this.held) {
      const next = time + dt;
      this.held.set(button, next);
      if (next >= REPEAT_DELAY) {
        const before = Math.floor((time - REPEAT_DELAY) / REPEAT_EVERY);
        const after = Math.floor((next - REPEAT_DELAY) / REPEAT_EVERY);
        if (after > before) this.repeats.add(button);
      }
    }
  }

  /** True only on the frame the button went down. */
  pressed(button: Button) {
    return this.fresh.has(button);
  }

  /** True while the button is held down (for walking, from Stage 2). */
  isHeld(button: Button) {
    return this.held.has(button);
  }

  /** True when first pressed, then again every so often while held (for moving through menus). */
  repeated(button: Button) {
    return this.fresh.has(button) || this.repeats.has(button);
  }

  /** Forgets this frame's presses, so one press isn't used by two scenes. */
  consume() {
    this.fresh.clear();
    this.repeats.clear();
  }
}
