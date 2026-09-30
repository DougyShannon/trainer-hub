import { useEffect, useRef, useState } from "react";

/**
 * For the hand along the bottom of a game table: put the returned ref on an empty element just after
 * it. `stuck` is true while that spot is below the bottom of the screen, which means the hand is
 * pinned to the bottom of the screen rather than sitting in its own place under the board.
 */
export function useStuckHand() {
  const end = useRef<HTMLDivElement>(null);
  const [stuck, setStuck] = useState(false);
  useEffect(() => {
    const el = end.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => setStuck(!e.isIntersecting && e.boundingClientRect.top > 0));
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return { end, stuck };
}

/**
 * How far down the table the player's own half of the board starts, so the column beside the board
 * can start level with it (less scrolling). 0 when the column sits under the board on narrow screens.
 */
export function useOwnSideTop(deps: unknown[]) {
  const layout = useRef<HTMLDivElement>(null);
  const [top, setTop] = useState(0);
  useEffect(() => {
    const root = layout.current;
    if (!root) return;
    const measure = () => {
      const own = root.querySelector(".board .play-area")?.lastElementChild;
      const wide = window.matchMedia("(min-width: 1001px)").matches;
      setTop(wide && own ? Math.max(0, Math.round(own.getBoundingClientRect().top - root.getBoundingClientRect().top)) : 0);
    };
    measure();
    const board = root.querySelector(".board");
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    if (board) ro?.observe(board);
    window.addEventListener("resize", measure);
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", measure);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return { layout, top };
}
