import { useEffect, useRef, useState, type DragEvent, type PointerEvent as ReactPointerEvent } from "react";
import { blockZoom } from "./CardZoom";

// Drag a card from your hand onto the table, with a mouse or a finger. On touch screens the hand
// only scrolls sideways (touch-action: pan-x), so pulling a card upwards starts a drag while a
// sideways swipe still scrolls. Anything that can take a card is marked with data-drop="<target>".

type Drag<T> = { item: T; image: string | null; name: string; x: number; y: number };

const MOVE_PX = 6;

export function useCardDrag<T>({
  canDrop,
  onDrop,
}: {
  canDrop: (item: T, target: string) => boolean;
  onDrop: (item: T, target: string) => void;
}) {
  const [drag, setDragState] = useState<Drag<T> | null>(null);
  const dragRef = useRef<Drag<T> | null>(null);
  const setDrag = (d: Drag<T> | null) => {
    dragRef.current = d;
    setDragState(d);
  };
  const [over, setOver] = useState<string | null>(null);
  const pending = useRef<{ item: T; image: string | null; name: string; x: number; y: number } | null>(null);
  const swallowClick = useRef(false);
  const live = useRef({ canDrop, onDrop });
  live.current = { canDrop, onDrop };

  const targetAt = (x: number, y: number) => {
    const el = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-drop]");
    return el?.dataset.drop ?? null;
  };

  useEffect(() => {
    const move = (e: PointerEvent) => {
      const p = pending.current;
      if (!p) return;
      const drag = dragRef.current;
      const far = Math.hypot(e.clientX - p.x, e.clientY - p.y) > MOVE_PX;
      if (!drag) {
        if (!far) return;
        blockZoom(true);
        setDrag({ item: p.item, image: p.image, name: p.name, x: e.clientX, y: e.clientY });
        return;
      }
      setDrag({ ...drag, x: e.clientX, y: e.clientY });
      const t = targetAt(e.clientX, e.clientY);
      setOver(t && live.current.canDrop(drag.item, t) ? t : null);
    };
    const up = (e: PointerEvent) => {
      const drag = dragRef.current;
      if (drag) {
        const t = targetAt(e.clientX, e.clientY);
        if (t && live.current.canDrop(drag.item, t)) live.current.onDrop(drag.item, t);
        swallowClick.current = true;
        setTimeout(() => (swallowClick.current = false), 50);
      }
      cancel();
    };
    const cancel = () => {
      blockZoom(false);
      pending.current = null;
      setDrag(null);
      setOver(null);
    };
    // While dragging on a touch screen, stop the page from scrolling under your finger.
    const noScroll = (e: TouchEvent) => {
      if (dragRef.current) e.preventDefault();
    };
    const click = (e: MouseEvent) => {
      if (swallowClick.current) {
        e.stopPropagation();
        e.preventDefault();
        swallowClick.current = false;
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("touchmove", noScroll, { passive: false });
    window.addEventListener("click", click, true);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("touchmove", noScroll);
      window.removeEventListener("click", click, true);
    };
  }, []);

  /** Spread onto the element you drag from. */
  const source = (item: T, card: { name: string; image: string | null }) => ({
    onPointerDown: (e: ReactPointerEvent<HTMLElement>) => {
      if (e.button !== 0) return;
      pending.current = { item, image: card.image, name: card.name, x: e.clientX, y: e.clientY };
    },
    onDragStart: (e: DragEvent) => e.preventDefault(),
  });

  /** What a drop target should look like right now: "" (normal), "ok" (you can drop here) or "over". */
  const dropState = (target: string): "" | "ok" | "over" => {
    if (!drag || !canDrop(drag.item, target)) return "";
    return over === target ? "over" : "ok";
  };

  const ghost = drag ? (
    <div className="drag-ghost" style={{ left: drag.x, top: drag.y }} aria-hidden="true">
      {drag.image ? <img src={drag.image} alt="" /> : <span className="gcard-text">{drag.name}</span>}
    </div>
  ) : null;

  return { dragging: drag?.item ?? null, source, dropState, ghost };
}
