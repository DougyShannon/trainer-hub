// Turns the letter-grid pictures (see player.ts) into small images the game can stamp onto the
// screen quickly. Each picture is only built once.

const cache = new Map<string, HTMLCanvasElement>();

/** The picture `rows` as an image, flipped left-to-right when `flip` is true. */
export function sprite(key: string, rows: string[], palette: Record<string, string>, flip = false): HTMLCanvasElement {
  const id = `${key}${flip ? ":flip" : ""}`;
  const found = cache.get(id);
  if (found) return found;
  const width = Math.max(...rows.map((r) => r.length));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = rows.length;
  const ctx = canvas.getContext("2d")!;
  rows.forEach((row, y) =>
    [...row].forEach((char, x) => {
      const color = palette[char];
      if (!color) return;
      ctx.fillStyle = color;
      ctx.fillRect(flip ? width - 1 - x : x, y, 1, 1);
    }),
  );
  cache.set(id, canvas);
  return canvas;
}
