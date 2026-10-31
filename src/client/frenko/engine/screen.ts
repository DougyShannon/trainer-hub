// The game draws on a screen the size of a Game Boy Advance's: 240 × 160 pixels. The web page
// stretches it up to fit (keeping the pixels sharp), so the art looks the same on every device.

export const SCREEN_WIDTH = 240;
export const SCREEN_HEIGHT = 160;

/** One map square. 15 × 10 tiles fill the screen, like the GBA games. */
export const TILE = 16;

/** The colours the interface uses. Change them here and every menu and text box follows. */
export const COLORS = {
  ink: "#383838",
  inkShadow: "#d8d8d0",
  paper: "#f8f8f8",
  frame: "#4a5a78",
  frameLight: "#8ea0c4",
  dim: "#a0a0a0",
  white: "#ffffff",
  black: "#101010",
};
