/**
 * The game log with the newest turn first. Each turn keeps its own lines in the order they happened,
 * under its "Turn N" heading, so a turn still reads top to bottom.
 */
export function newestTurnFirst<T extends { kind?: string }>(log: T[]): T[] {
  const turns: T[][] = [[]];
  for (const line of log) {
    if (line.kind === "turn" && turns[turns.length - 1].length) turns.push([]);
    turns[turns.length - 1].push(line);
  }
  return turns.reverse().flat();
}
