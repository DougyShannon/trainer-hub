import type { Game } from "./game";

/**
 * A scene is one "mode" of the game: the title screen, the overworld, a menu, a battle. The game
 * keeps a pile (stack) of scenes. Only the top one reacts to the buttons, but scenes underneath
 * still draw when the top one is an overlay, which is how the Start menu sits over the map.
 */
export interface Scene {
  /** Move things along by `dt` seconds and read the buttons. */
  update(game: Game, dt: number): void;
  /** Draw onto the 240 × 160 screen. */
  draw(ctx: CanvasRenderingContext2D, game: Game): void;
  /** True when the scene below should still be drawn (menus and text boxes). */
  overlay?: boolean;
  /** Called when the scene is shown again after the one on top of it closes. */
  resume?(game: Game): void;
}
