// The menu after the title screen: CONTINUE (when there's a save), NEW GAME and OPTIONS.

import type { Game } from "../engine/game";
import type { Scene } from "../engine/scene";
import { SCREEN_HEIGHT, SCREEN_WIDTH } from "../engine/screen";
import { NEW_GAME_INTRO } from "../data/placeholders";
import { formatPlayTime, loadSave, newSave, type SaveFile } from "../save/saveFile";
import { drawText } from "../ui/font";
import { askYesNo, Menu } from "../ui/menu";
import { drawWindow } from "../ui/window";
import { OptionsScene } from "./options";
import { TestRoomScene } from "./testRoom";
import { TitleScene } from "./title";

const BACKGROUND = "#5868a0";

export class MainMenuScene implements Scene {
  private existing: SaveFile | null = loadSave();
  private menu = this.buildMenu();

  private buildMenu() {
    const items = [{ label: "NEW GAME" }, { label: "OPTIONS" }];
    if (this.existing) items.unshift({ label: "CONTINUE" });
    return new Menu(items, 8, 8, SCREEN_WIDTH - 16);
  }

  resume() {
    // Back from Options: pick up a save made in another tab, just in case.
    this.existing = loadSave();
  }

  update(game: Game) {
    const picked = this.menu.update(game);
    if (picked === null) return;
    if (picked === "back") return game.switchTo(new TitleScene());
    const label = this.menu.items[picked].label;
    if (label === "CONTINUE" && this.existing) {
      game.save = this.existing;
      game.switchTo(new TestRoomScene());
    } else if (label === "NEW GAME") {
      if (!this.existing) return startNewGame(game);
      askYesNo(game, "There is already a saved game. Start a new one? The old save stays until you save over it.", (yes, g) => {
        if (yes) startNewGame(g);
      });
    } else if (label === "OPTIONS") {
      game.push(new OptionsScene());
    }
  }

  draw(ctx: CanvasRenderingContext2D) {
    ctx.fillStyle = BACKGROUND;
    ctx.fillRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);
    this.menu.draw(ctx);
    if (this.existing) {
      // Details of the saved game under the menu, like the GBA Continue box.
      const top = this.menu.y + this.menu.height + 6;
      drawWindow(ctx, 8, top, SCREEN_WIDTH - 16, 42);
      drawText(ctx, "SAVED GAME", 18, top + 8);
      drawText(ctx, "TIME", 18, top + 22);
      drawText(ctx, formatPlayTime(this.existing.playSeconds), 70, top + 22);
      drawText(ctx, "SAVED", 120, top + 22);
      drawText(ctx, new Date(this.existing.savedAt).toLocaleDateString(), 160, top + 22);
    }
  }
}

function startNewGame(game: Game) {
  game.save = newSave();
  game.switchTo(new TestRoomScene(NEW_GAME_INTRO));
}
