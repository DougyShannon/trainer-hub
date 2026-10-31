// A small pixel font drawn by hand for Frenko, so text looks like a GBA game's instead of blurry web
// text. Each letter is a little picture: "#" is a lit pixel, "." is empty, and each word in the
// string is one row from the top. Capitals sit on rows 0 to 6; lowercase g, j, p, q and y hang down
// to row 8. To add a letter, draw it the same way and add it to GLYPHS.

import { COLORS } from "../engine/screen";

const GLYPHS: Record<string, string> = {
  A: ".###. #...# #...# ##### #...# #...# #...#",
  B: "####. #...# #...# ####. #...# #...# ####.",
  C: ".###. #...# #.... #.... #.... #...# .###.",
  D: "####. #...# #...# #...# #...# #...# ####.",
  E: "##### #.... #.... ####. #.... #.... #####",
  F: "##### #.... #.... ####. #.... #.... #....",
  G: ".###. #...# #.... #.### #...# #...# .####",
  H: "#...# #...# #...# ##### #...# #...# #...#",
  I: "### .#. .#. .#. .#. .#. ###",
  J: "..### ...#. ...#. ...#. ...#. #..#. .##..",
  K: "#...# #..#. #.#.. ##... #.#.. #..#. #...#",
  L: "#.... #.... #.... #.... #.... #.... #####",
  M: "#...# ##.## #.#.# #.#.# #...# #...# #...#",
  N: "#...# ##..# #.#.# #.#.# #..## #...# #...#",
  O: ".###. #...# #...# #...# #...# #...# .###.",
  P: "####. #...# #...# ####. #.... #.... #....",
  Q: ".###. #...# #...# #...# #.#.# #..#. .##.#",
  R: "####. #...# #...# ####. #.#.. #..#. #...#",
  S: ".###. #...# #.... .###. ....# #...# .###.",
  T: "##### ..#.. ..#.. ..#.. ..#.. ..#.. ..#..",
  U: "#...# #...# #...# #...# #...# #...# .###.",
  V: "#...# #...# #...# #...# #...# .#.#. ..#..",
  W: "#...# #...# #...# #.#.# #.#.# #.#.# .#.#.",
  X: "#...# #...# .#.#. ..#.. .#.#. #...# #...#",
  Y: "#...# #...# .#.#. ..#.. ..#.. ..#.. ..#..",
  Z: "##### ....# ...#. ..#.. .#... #.... #####",
  a: "..... ..... .###. ....# .#### #...# .####",
  b: "#.... #.... ####. #...# #...# #...# ####.",
  c: "..... ..... .#### #.... #.... #.... .####",
  d: "....# ....# .#### #...# #...# #...# .####",
  e: "..... ..... .###. #...# ##### #.... .###.",
  f: "..## .#.. #### .#.. .#.. .#.. .#..",
  g: "..... ..... .#### #...# #...# #...# .#### ....# .###.",
  h: "#.... #.... ####. #...# #...# #...# #...#",
  i: "# . # # # # #",
  j: "..# ... ..# ..# ..# ..# ..# #.# .#.",
  k: "#... #... #..# #.#. ##.. #.#. #..#",
  l: "# # # # # # #",
  m: "..... ..... ##.#. #.#.# #.#.# #.#.# #.#.#",
  n: "..... ..... ####. #...# #...# #...# #...#",
  o: "..... ..... .###. #...# #...# #...# .###.",
  p: "..... ..... ####. #...# #...# #...# ####. #.... #....",
  q: "..... ..... .#### #...# #...# #...# .#### ....# ....#",
  r: ".... .... #.## ##.. #... #... #...",
  s: "..... ..... .#### #.... .###. ....# ####.",
  t: ".#.. .#.. #### .#.. .#.. .#.. ..##",
  u: "..... ..... #...# #...# #...# #...# .####",
  v: "..... ..... #...# #...# #...# .#.#. ..#..",
  w: "..... ..... #...# #...# #.#.# #.#.# .#.#.",
  x: "..... ..... #...# .#.#. ..#.. .#.#. #...#",
  y: "..... ..... #...# #...# #...# #...# .#### ....# .###.",
  z: "..... ..... ##### ...#. ..#.. .#... #####",
  é: "...#. ..#.. .###. #...# ##### #.... .###.",
  "0": ".###. #...# #..## #.#.# ##..# #...# .###.",
  "1": "..#.. .##.. ..#.. ..#.. ..#.. ..#.. .###.",
  "2": ".###. #...# ....# ...#. ..#.. .#... #####",
  "3": "####. ....# ....# .###. ....# ....# ####.",
  "4": "...#. ..##. .#.#. #..#. ##### ...#. ...#.",
  "5": "##### #.... ####. ....# ....# #...# .###.",
  "6": ".###. #.... #.... ####. #...# #...# .###.",
  "7": "##### ....# ...#. ..#.. .#... .#... .#...",
  "8": ".###. #...# #...# .###. #...# #...# .###.",
  "9": ".###. #...# #...# .#### ....# ....# .###.",
  ".": ". . . . . . #",
  ",": ". . . . . . # #",
  "!": "# # # # # . #",
  "?": ".###. #...# ....# ...#. ..#.. ..... ..#..",
  "'": "# #",
  '"': "#.# #.#",
  ":": ". . # . . . #",
  "-": "... ... ... ###",
  "+": "... ... .#. ### .#.",
  "/": "....# ...#. ...#. ..#.. .#... .#... #....",
  "(": ".# #. #. #. #. #. .#",
  "<": "...# ..#. .#.. #... .#.. ..#. ...#",
  ">": "#... .#.. ..#. ...# ..#. .#.. #...",
  "[": "## #. #. #. #. #. ##",
  "]": "## .# .# .# .# .# ##",
  ")": "#. .# .# .# .# .# #.",
  "&": ".##.. #..#. #.#.. .#... #.#.# #..#. .##.#",
  "×": "..... ..... #...# .#.#. ..#.. .#.#. #...#",
};

const SPACE_WIDTH = 3;
const GAP = 1;
/** Height of one line of text, including the gap below it. */
export const LINE_HEIGHT = 12;

type Glyph = { width: number; pixels: [number, number][] };
const glyphs = new Map<string, Glyph>();
for (const [char, art] of Object.entries(GLYPHS)) {
  const rows = art.split(" ");
  const pixels: [number, number][] = [];
  rows.forEach((row, y) => [...row].forEach((c, x) => c === "#" && pixels.push([x, y])));
  glyphs.set(char, { width: Math.max(...rows.map((r) => r.length)), pixels });
}

function glyphFor(char: string): Glyph | null {
  if (char === " ") return null;
  return glyphs.get(char) ?? glyphs.get(char.toUpperCase()) ?? glyphs.get("?")!;
}

/** How many pixels wide `text` is at `scale`. */
export function measureText(text: string, scale = 1): number {
  let width = 0;
  for (const char of text) {
    const glyph = glyphFor(char);
    width += (glyph ? glyph.width : SPACE_WIDTH) + GAP;
  }
  return Math.max(0, width - GAP) * scale;
}

/**
 * Draws `text` with its top-left corner at x, y. Like the GBA games, text gets a soft shadow down
 * and to the right unless `shadow` is null.
 */
export function drawText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  { color = COLORS.ink, shadow = COLORS.inkShadow as string | null, scale = 1 } = {},
) {
  if (shadow) {
    paint(ctx, text, x + scale, y, shadow, scale);
    paint(ctx, text, x, y + scale, shadow, scale);
    paint(ctx, text, x + scale, y + scale, shadow, scale);
  }
  paint(ctx, text, x, y, color, scale);
}

function paint(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, color: string, scale: number) {
  ctx.fillStyle = color;
  let left = Math.round(x);
  const top = Math.round(y);
  for (const char of text) {
    const glyph = glyphFor(char);
    if (!glyph) {
      left += (SPACE_WIDTH + GAP) * scale;
      continue;
    }
    for (const [px, py] of glyph.pixels) ctx.fillRect(left + px * scale, top + py * scale, scale, scale);
    left += (glyph.width + GAP) * scale;
  }
}

/** Splits text into lines no wider than `width` pixels, breaking between words. */
export function wrapText(text: string, width: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    let line = "";
    for (const word of paragraph.split(" ")) {
      const next = line ? `${line} ${word}` : word;
      if (line && measureText(next) > width) {
        lines.push(line);
        line = word;
      } else line = next;
    }
    lines.push(line);
  }
  return lines;
}
