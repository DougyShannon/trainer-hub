// The player on the map. Movement works square by square like the GBA games: a quick tap turns to
// face a way, holding the button walks, and each step glides smoothly from one square to the next.
// Walking into something solid makes the player walk on the spot, facing it.

import type { Input } from "../engine/input";
import { TILE } from "../engine/screen";
import { PALETTE, PLAYER_ART, type Pose } from "../art/player";
import { sprite } from "../art/pixels";
import { STEP, type Direction } from "./direction";
import type { GameMap } from "./map";

/** Seconds one step takes (16 frames, as on the GBA). */
const STEP_TIME = 16 / 60;
/** How long a button must be held after turning before the player starts walking. */
const TURN_TIME = 6 / 60;
/** Walking on the spot against a wall plays more slowly. */
const BUMP_TIME = STEP_TIME * 2;

export class Player {
  x: number;
  y: number;
  facing: Direction;

  /** 0 to 1 through the current step, or null when standing still. */
  private progress: number | null = null;
  private bumping = false;
  private turnWait = 0;
  /** Which foot leads; it swaps every step so the walk alternates. */
  private foot = false;

  constructor(at: { x: number; y: number; facing: Direction }) {
    this.x = at.x;
    this.y = at.y;
    this.facing = at.facing;
  }

  get moving() {
    return this.progress !== null;
  }

  /** The square in front of the player (for reading signs and, later, talking to people). */
  facingSquare() {
    return { x: this.x + STEP[this.facing].x, y: this.y + STEP[this.facing].y };
  }

  update(input: Input, map: GameMap, dt: number) {
    let time = dt;
    let walking = false; // true when carrying on straight from a finished step
    while (time > 0) {
      if (this.progress === null) {
        if (!this.tryStart(input, map, time, walking)) return;
        continue;
      }
      const length = this.bumping ? BUMP_TIME : STEP_TIME;
      const left = (1 - this.progress) * length;
      if (time < left) {
        this.progress += time / length;
        return;
      }
      // Finished this step: arrive, then carry straight on if a direction is still held.
      time -= left;
      if (!this.bumping) {
        this.x += STEP[this.facing].x;
        this.y += STEP[this.facing].y;
      }
      this.progress = null;
      this.bumping = false;
      this.foot = !this.foot;
      if (!input.heldDirection()) return;
      walking = true;
    }
  }

  /**
   * Starts a step (or a turn) if a direction is held. Returns false when standing still. Mid-walk
   * (`walking`), a new direction turns and steps at once, without the pause a standing turn has.
   */
  private tryStart(input: Input, map: GameMap, dt: number, walking: boolean): boolean {
    const dir = input.heldDirection();
    if (!dir) {
      this.turnWait = 0;
      return false;
    }
    if (!walking && dir !== this.facing && this.turnWait <= 0) {
      // Turn first; keep holding to walk.
      this.facing = dir;
      this.turnWait = TURN_TIME;
      return false;
    }
    if (this.turnWait > 0) {
      this.turnWait -= dt;
      if (this.turnWait > 0) return false;
    }
    const to = { x: this.x + STEP[dir].x, y: this.y + STEP[dir].y };
    this.facing = dir;
    this.bumping = !map.walkable(to.x, to.y);
    this.progress = 0;
    return true;
  }

  /** Where the player is drawn on the map, in pixels (top-left of the square they stand on). */
  pixelPosition() {
    const along = this.progress !== null && !this.bumping ? this.progress * TILE : 0;
    return {
      x: this.x * TILE + Math.round(STEP[this.facing].x * along),
      y: this.y * TILE + Math.round(STEP[this.facing].y * along),
    };
  }

  private pose(): Pose {
    // First half of a step shows a foot forward, second half standing, like the GBA walk.
    if (this.progress === null || this.progress >= 0.5) return "stand";
    return this.foot ? "stepB" : "stepA";
  }

  /** Draws the player with the top-left of their square at screenX, screenY. */
  draw(ctx: CanvasRenderingContext2D, screenX: number, screenY: number) {
    const view = this.facing === "left" ? "right" : this.facing;
    const pose = this.pose();
    const image = sprite(`player-${view}-${pose}`, PLAYER_ART[view][pose], PALETTE, this.facing === "left");
    // The picture is 20 pixels tall, so it stands with its feet on the bottom of the square.
    ctx.drawImage(image, screenX, screenY + TILE - image.height);
  }
}
