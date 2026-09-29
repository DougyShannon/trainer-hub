import { useEffect, useState, useSyncExternalStore, type PointerEvent } from "react";
import type { CardRef } from "../../shared/game-types";

// Game cards are small on the table, so hovering one with a mouse shows it full size beside
// the pointer. Phones and tablets have no hover; tapping a card opens the details panel instead.

type Damage = { taken: number; hp: number | null };
type Zoom = { card: CardRef; rect: DOMRect; damage?: Damage } | null;

let zoom: Zoom = null;
const listeners = new Set<() => void>();
const set = (z: Zoom) => {
  zoom = z;
  listeners.forEach((l) => l());
};
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

// No zooming while a card is being dragged; it would cover where you're dropping it.
let blocked = false;
export const blockZoom = (on: boolean) => {
  blocked = on;
  if (on) set(null);
};

/** Pointer handlers to spread onto anything showing a face-up card. */
export function zoomHandlers(card: CardRef | null, damage?: Damage) {
  if (!card?.image) return {};
  return {
    onPointerEnter: (e: PointerEvent<HTMLElement>) => {
      if (e.pointerType === "mouse" && !blocked) set({ card, rect: e.currentTarget.getBoundingClientRect(), damage });
    },
    onPointerLeave: () => set(null),
  };
}


const WIDTH = 300;
const HEIGHT = Math.round((WIDTH * 342) / 245);
const GAP = 14;

/** Render once per table. */
export function CardZoom() {
  const z = useSyncExternalStore(subscribe, () => zoom);
  const [broken, setBroken] = useState<string | null>(null);

  // Cards move and panels open under the pointer; don't leave a zoom stuck on screen.
  useEffect(() => {
    const hide = () => set(null);
    window.addEventListener("scroll", hide, true);
    window.addEventListener("pointerdown", hide);
    return () => {
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("pointerdown", hide);
      set(null);
    };
  }, []);

  if (!z) return null;
  const src = z.card.imageLarge ?? z.card.image;
  if (!src || broken === src) return null;

  const vw = window.innerWidth;
  const vh = window.innerHeight;
  // Beside the card, on whichever side has room; otherwise above or below it.
  let left = z.rect.right + GAP;
  if (left + WIDTH > vw - 8) left = z.rect.left - GAP - WIDTH;
  let top = z.rect.top + z.rect.height / 2 - HEIGHT / 2;
  if (left < 8) {
    left = Math.min(Math.max(8, z.rect.left + z.rect.width / 2 - WIDTH / 2), vw - WIDTH - 8);
    top = z.rect.top - GAP - HEIGHT >= 8 ? z.rect.top - GAP - HEIGHT : z.rect.bottom + GAP;
  }
  top = Math.min(Math.max(8, top), vh - HEIGHT - 8);

  return (
    <div className="card-zoom" style={{ left, top, width: WIDTH, height: HEIGHT }} aria-hidden="true">
      <img src={src} alt="" onError={() => setBroken(src)} />
      {z.damage && (
        <span className={`zoom-dmg${z.damage.hp !== null && z.damage.taken >= z.damage.hp ? " ko" : ""}`}>
          <span className="zoom-dmg-num">{z.damage.taken}</span>
          <span className="zoom-dmg-label">damage</span>
        </span>
      )}
      {z.damage && z.damage.hp !== null && <span className="zoom-hp-left">{Math.max(0, z.damage.hp - z.damage.taken)} HP left</span>}
    </div>
  );
}
