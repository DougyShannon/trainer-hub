// The menu after the title screen: CONTINUE (when the signed-in trainer has a saved game), NEW GAME
// and OPTIONS. Signed out, the game can still be played; a note explains that saving needs a sign-in.

import type { Game } from "../engine/game";
import type { Scene } from "../engine/scene";
import { SCREEN_HEIGHT, SCREEN_WIDTH } from "../engine/screen";
import { loadSlots, type Slots } from "../save/saveFile";
import { drawText, wrapText } from "../ui/font";
import { Menu } from "../ui/menu";
import { drawWindow } from "../ui/window";
import { GenderScene } from "./newGame";
import { OptionsScene } from "./options";
import { OverworldScene } from "./overworld";
import { SlotsScene } from "./slots";
import { TitleScene } from "./title";

const BACKGROUND = "#5868a0";
const SIGNED_OUT = "You're not signed in. You can play, but saving needs a Trainer Hub sign-in.";
const LOAD_FAILED = "Your saved games didn't load. Check your connection, then try again.";

export class MainMenuScene implements Scene {
  private slots: Slots | "loading" | "failed" = "loading";
  private menu: Menu | null = null;

  constructor() {
    this.load();
  }

  private load() {
    this.slots = "loading";
    this.menu = null;
    loadSlots().then(
      (slots) => (this.slots = slots),
      () => (this.slots = "failed"),
    );
  }

  private get hasSaves() {
    return typeof this.slots === "object" && this.slots.signedIn && this.slots.slots.some(Boolean);
  }

  update(game: Game) {
    if (this.slots === "loading") return;
    this.menu ??= new Menu(
      [...(this.hasSaves ? [{ label: "CONTINUE" }] : []), { label: "NEW GAME" }, { label: "OPTIONS" }],
      8,
      8,
      SCREEN_WIDTH - 16,
    );
    const picked = this.menu.update(game);
    if (picked === null) return;
    if (picked === "back") return game.switchTo(new TitleScene());
    const label = this.menu.items[picked].label;
    if (label === "CONTINUE" && typeof this.slots === "object" && this.slots.signedIn) {
      game.push(
        new SlotsScene(this.slots.slots, "load", (slot, g) => {
          if (typeof this.slots !== "object" || !this.slots.signedIn) return;
          g.save = this.slots.slots[slot - 1];
          g.saveSlot = slot;
          g.switchTo(new OverworldScene(g));
        }),
      );
    } else if (label === "NEW GAME") {
      game.switchTo(new GenderScene(() => new MainMenuScene()));
    } else if (label === "OPTIONS") {
      game.push(new OptionsScene());
    }
  }

  draw(ctx: CanvasRenderingContext2D) {
    ctx.fillStyle = BACKGROUND;
    ctx.fillRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);
    if (!this.menu) {
      drawWindow(ctx, 8, 8, SCREEN_WIDTH - 16, 22);
      drawText(ctx, "LOADING...", 18, 15);
      return;
    }
    this.menu.draw(ctx);
    const note = this.slots === "failed" ? LOAD_FAILED : typeof this.slots === "object" && !this.slots.signedIn ? SIGNED_OUT : null;
    if (note) {
      const lines = wrapText(note, SCREEN_WIDTH - 36);
      const top = this.menu.y + this.menu.height + 6;
      drawWindow(ctx, 8, top, SCREEN_WIDTH - 16, lines.length * 14 + 14);
      lines.forEach((line, i) => drawText(ctx, line, 18, top + 8 + i * 14));
    }
  }
}
