export type Direction = "up" | "down" | "left" | "right";

/** How a step in each direction changes the tile column (x) and row (y). */
export const STEP: Record<Direction, { x: number; y: number }> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};
