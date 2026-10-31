// The game itself: the screen, the buttons, the pile of scenes, and the loop that redraws about 60
// times a second.

import { Input } from "./input";
import type { Scene } from "./scene";
import { COLORS, SCREEN_HEIGHT, SCREEN_WIDTH } from "./screen";
import { loadOptions, type Options } from "../save/options";
import type { SaveFile } from "../save/saveFile";

/** Seconds a fade to black (or back) takes. */
const FADE = 0.25;

export class Game {
  readonly input = new Input();
  readonly ctx: CanvasRenderingContext2D;
  options: Options = loadOptions();
  /** The adventure being played, or null on the title screen. */
  save: SaveFile | null = null;
  /** The slot (1 to 5) this adventure was loaded from or last saved to; null until first saved. */
  saveSlot: number | null = null;
  /** Seconds since the game started, for blinking arrows and the like. */
  time = 0;

  private scenes: Scene[] = [];
  private frame = 0;
  private last = 0;
  private fade: { alpha: number; direction: 1 | -1; then?: () => void } | null = null;

  constructor(readonly canvas: HTMLCanvasElement) {
    canvas.width = SCREEN_WIDTH;
    canvas.height = SCREEN_HEIGHT;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("This browser can't draw the game screen.");
    ctx.imageSmoothingEnabled = false;
    this.ctx = ctx;
  }

  start(first: Scene) {
    this.scenes = [first];
    this.last = performance.now();
    const tick = (now: number) => {
      // A long gap (the tab was hidden) counts as one short frame, so nothing jumps ahead.
      const dt = Math.min((now - this.last) / 1000, 1 / 20);
      this.last = now;
      this.step(dt);
      this.frame = requestAnimationFrame(tick);
    };
    this.frame = requestAnimationFrame(tick);
  }

  stop() {
    cancelAnimationFrame(this.frame);
    this.input.releaseAll();
  }

  /** Puts a scene on top (a menu opening). */
  push(scene: Scene) {
    this.scenes.push(scene);
    this.input.consume();
  }

  /** Closes the top scene (a menu closing). */
  pop() {
    this.scenes.pop();
    this.input.consume();
    this.top()?.resume?.(this);
  }

  /** Swaps everything for a new scene, fading through black. */
  switchTo(scene: Scene) {
    this.fadeOut(() => {
      this.scenes = [scene];
      this.fadeIn();
    });
  }

  fadeOut(then: () => void) {
    this.fade = { alpha: 0, direction: 1, then };
  }

  fadeIn() {
    this.fade = { alpha: 1, direction: -1 };
  }

  top(): Scene | undefined {
    return this.scenes[this.scenes.length - 1];
  }

  private step(dt: number) {
    this.time += dt;
    if (this.save) this.save.playSeconds += dt;
    if (this.fade) {
      // Nothing reacts to the buttons mid-fade.
      this.fade.alpha += (this.fade.direction * dt) / FADE;
      if (this.fade.direction === 1 && this.fade.alpha >= 1) {
        const then = this.fade.then;
        this.fade = { alpha: 1, direction: 1 };
        then?.();
      } else if (this.fade.direction === -1 && this.fade.alpha <= 0) {
        this.fade = null;
      }
      this.input.consume();
    } else {
      this.top()?.update(this, dt);
    }
    this.input.endFrame(dt);
    this.draw();
  }

  private draw() {
    const ctx = this.ctx;
    ctx.fillStyle = COLORS.black;
    ctx.fillRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);
    // Draw from the lowest scene that is fully covered by the ones above it.
    let from = this.scenes.length - 1;
    while (from > 0 && this.scenes[from].overlay) from--;
    for (let i = from; i < this.scenes.length; i++) this.scenes[i].draw(ctx, this);
    if (this.fade) {
      ctx.globalAlpha = Math.max(0, Math.min(1, this.fade.alpha));
      ctx.fillStyle = COLORS.black;
      ctx.fillRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);
      ctx.globalAlpha = 1;
    }
  }
}
