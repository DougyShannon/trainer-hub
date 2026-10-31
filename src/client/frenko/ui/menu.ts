// A list menu in a box: up and down move the ▶, A picks, B backs out.

import type { Game } from "../engine/game";
import type { Scene } from "../engine/scene";
import { COLORS } from "../engine/screen";
import { drawText, LINE_HEIGHT, measureText } from "./font";
import { drawCursor, drawWindow } from "./window";
import { drawMessageBox, lastLines, MessageScene } from "./textbox";

export type MenuItem = {
  label: string;
  /** Shown greyed out. It can still be picked, so it can explain why it isn't ready. */
  disabled?: boolean;
  /** Small text on the right of the line, such as a setting's current value. */
  value?: string;
};

const PAD_X = 8;
const PAD_Y = 7;
const CURSOR_SPACE = 8;

export class Menu {
  cursor = 0;

  constructor(
    public items: MenuItem[],
    public x: number,
    public y: number,
    public minWidth = 0,
  ) {}

  get width() {
    const widest = Math.max(...this.items.map((i) => measureText(i.label) + (i.value ? measureText(i.value) + 10 : 0)));
    return Math.max(this.minWidth, widest + CURSOR_SPACE + PAD_X * 2);
  }

  get height() {
    return this.items.length * LINE_HEIGHT + PAD_Y * 2 - 2;
  }

  /** Returns the picked line's number, "back" when B is pressed, or null when nothing happened. */
  update(game: Game): number | "back" | null {
    const input = game.input;
    if (input.repeated("up")) this.cursor = (this.cursor + this.items.length - 1) % this.items.length;
    if (input.repeated("down")) this.cursor = (this.cursor + 1) % this.items.length;
    // Start picks too, since on a keyboard Enter is the natural "OK".
    if (input.pressed("a") || input.pressed("start")) return this.cursor;
    if (input.pressed("b")) return "back";
    return null;
  }

  draw(ctx: CanvasRenderingContext2D) {
    const w = this.width;
    drawWindow(ctx, this.x, this.y, w, this.height);
    this.items.forEach((item, i) => {
      const top = this.y + PAD_Y + i * LINE_HEIGHT;
      const color = item.disabled ? COLORS.dim : COLORS.ink;
      drawText(ctx, item.label, this.x + PAD_X + CURSOR_SPACE, top, { color });
      if (item.value) drawText(ctx, item.value, this.x + w - PAD_X - measureText(item.value), top, { color });
      if (i === this.cursor) drawCursor(ctx, this.x + PAD_X, top);
    });
  }
}

/** Asks `question` in the message box and waits for YES or NO. B counts as NO. */
export function askYesNo(game: Game, question: string, answer: (yes: boolean, game: Game) => void) {
  game.push(new MessageScene(question, (g) => g.push(new YesNoScene(question, answer)), false));
}

class YesNoScene implements Scene {
  overlay = true;
  private menu = new Menu([{ label: "YES" }, { label: "NO" }], 186, 70);
  private lines: string[];

  constructor(
    question: string,
    private answer: (yes: boolean, game: Game) => void,
  ) {
    this.lines = lastLines(question);
  }

  update(game: Game) {
    const picked = this.menu.update(game);
    if (picked === null) return;
    game.pop();
    this.answer(picked === 0, game);
  }

  draw(ctx: CanvasRenderingContext2D) {
    drawMessageBox(ctx, this.lines);
    this.menu.draw(ctx);
  }
}
