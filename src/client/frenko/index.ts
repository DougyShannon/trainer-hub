// The Frenko game's front door. The web page calls `startFrenko` with its canvas and gets back the
// buttons (for the on-screen controls) and a way to stop the game when the player leaves the page.
//
// Folders:
//   engine/  the game loop, screen size and buttons
//   ui/      the pixel font, boxes, menus and the message box
//   scenes/  each mode of the game (title, main menu, walking around, the Start menu...)
//   world/   maps, map squares (tiles), the player and how they move
//   art/     pixel-art pictures written as letter grids (placeholders until the real art exists)
//   save/    the save file and options, kept in this browser
//   data/    Frenko's own content; only placeholder text until Dougy's designs go in

import { Game } from "./engine/game";
import { TitleScene } from "./scenes/title";

export { BUTTONS, KEYS, type Button } from "./engine/input";
export { SCREEN_WIDTH, SCREEN_HEIGHT } from "./engine/screen";

export function startFrenko(canvas: HTMLCanvasElement) {
  const game = new Game(canvas);
  game.start(new TitleScene());
  return { input: game.input, stop: () => game.stop() };
}

export type Frenko = ReturnType<typeof startFrenko>;
