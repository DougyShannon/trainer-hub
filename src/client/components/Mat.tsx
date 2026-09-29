import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Link } from "react-router";
import { BACKDROPS, MATS, backdropById, layoutOf, type Mat, type Spot } from "../boards/library";
import { setBoardPrefs, useBoardPrefs, type BoardLayout, type BoardPrefs } from "../boards/prefs";

/** Everything that goes on one player's half mat, drawn by the table that owns the cards. */
export type MatParts = {
  tag: ReactNode;
  active: ReactNode;
  bench: ReactNode[];
  deck: ReactNode;
  discard: ReactNode;
  /** One face-down card per Prize card left (up to 6). */
  prizes: ReactNode[];
  stadium?: ReactNode;
  lostZone?: ReactNode;
};

/**
 * One player's half of the table, drawn on a play mat picture with the cards on its printed spots.
 * The opponent's mat is turned upside down, like sitting across the table, but their cards stay upright.
 */
export function HalfMat({ mat, flipped, parts, label, cover }: { mat: Mat; flipped?: boolean; parts: MatParts; label: string; cover?: ReactNode }) {
  const layout = layoutOf(mat);
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const watch = new ResizeObserver(() => setWidth(el.clientWidth));
    watch.observe(el);
    return () => watch.disconnect();
  }, []);

  // Your own mat is the bottom one, so bring it (and your hand under it) into view when the table opens.
  useEffect(() => {
    const el = box.current;
    if (flipped || !el || !width) return;
    const hand = el.closest(".board")?.querySelector(".my-hand")?.getBoundingClientRect().height ?? 0;
    const bottom = el.getBoundingClientRect().bottom + hand + 16;
    if (bottom > window.innerHeight) window.scrollBy({ top: bottom - window.innerHeight });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flipped, width > 0]);

  // Cards are sized from the mat's width, so they always fit the printed spots.
  const cw = (width * layout.card) / 100;
  const at = ([x, y]: Spot, node: ReactNode, key: string, cls = "") =>
    node ? (
      <div
        key={key}
        className={`mat-spot ${cls}`}
        style={{ left: `${flipped ? 100 - x : x}%`, top: `${flipped ? 100 - y : y}%`, ...(cls === "small" ? ({ "--cw": `${(cw * 0.7).toFixed(1)}px` } as CSSProperties) : {}) }}
      >
        {node}
      </div>
    ) : null;

  const style = { aspectRatio: String(mat.aspect), "--aspect": mat.aspect, "--cw": `${cw.toFixed(1)}px` } as CSSProperties;
  // A bigger Bench (Area Zero Underdepths) has more Pokémon than the mat has spots: they sit in a row beside it.
  const extra = parts.bench.slice(layout.bench.length).filter(Boolean);
  const extraRow = extra.length > 0 && (
    <div className="bench mat-extra-bench" style={{ "--cw": `${cw.toFixed(1)}px` } as CSSProperties}>
      {extra}
    </div>
  );
  return (
    <>
      {flipped && extraRow}
      <section ref={box} className={`mat${flipped ? " flipped" : ""}`} style={style} aria-label={label}>
        <div className="mat-art" style={{ backgroundImage: `url("${mat.image}")` }} aria-hidden="true" />
        {width > 0 && (
          <>
            {parts.prizes.slice(0, 6).map((p, i) => at(layout.prizes[i], p, `prize${i}`, i % 2 ? "under" : ""))}
            {at(layout.stadium, parts.stadium, "stadium")}
            {at(layout.deck, parts.deck, "deck")}
            {at(layout.discard, parts.discard, "discard")}
            {at(layout.lostZone, parts.lostZone, "lost", "small")}
            {parts.bench.slice(0, layout.bench.length).map((b, i) => at(layout.bench[i], b, `bench${i}`))}
            {at(layout.active, parts.active, "active", "active")}
            {at(layout.tag, parts.tag, "tag", "tag")}
          </>
        )}
        {cover && <div className="mat-cover">{cover}</div>}
      </section>
      {!flipped && extraRow}
    </>
  );
}

/** A card pile on a mat (Deck, Discard, Lost Zone) with its name and count over the card. */
export function MatPile({ label, count, children }: { label: string; count: number; children: ReactNode }) {
  return (
    <div className="mat-pile">
      {children}
      <span className="mat-count">
        {label} <strong>{count}</strong>
      </span>
    </div>
  );
}

/** Class and style for the full board with the chosen background behind it. */
export function backdropProps(prefs: BoardPrefs): { className: string; style?: CSSProperties } {
  const bg = backdropById(prefs.backdrop);
  return bg ? { className: " has-backdrop", style: { "--board-bg": `url("${bg.image}")` } as CSSProperties } : { className: "" };
}

// ----- Choosing a board -----

function LayoutChoice({ value, onChange }: { value: BoardLayout; onChange: (l: BoardLayout) => void }) {
  const option = (id: BoardLayout, name: string, blurb: string) => (
    <button type="button" className={`layout-choice${value === id ? " on" : ""}`} aria-pressed={value === id} onClick={() => onChange(id)}>
      <span className={`layout-mini ${id}`} aria-hidden="true">
        <span />
        <span />
      </span>
      <span>
        <strong>{name}</strong>
        <span className="small muted">{blurb}</span>
      </span>
    </button>
  );
  return (
    <div className="layout-choices" role="group" aria-label="Board layout">
      {option("full", "Full board", "One board for both players. Fits the whole game on screen.")}
      {option("mats", "Two half mats", "A play mat each, theirs upside down at the top. Bigger cards; best on a computer or tablet.")}
    </div>
  );
}

/** Pick the board layout and the picture for it. Used on the Play page and from the Board button at a table. */
export function BoardChooser() {
  const prefs = useBoardPrefs();
  return (
    <div className="board-chooser">
      <LayoutChoice value={prefs.layout} onChange={(layout) => setBoardPrefs({ layout })} />
      {prefs.layout === "mats" ? (
        <>
          <h3 className="small">Your play mat</h3>
          <div className="mat-grid">
            {MATS.map((m) => (
              <button key={m.id} type="button" className={`mat-pick${prefs.mat === m.id ? " on" : ""}`} aria-pressed={prefs.mat === m.id} onClick={() => setBoardPrefs({ mat: m.id })}>
                <img src={m.thumb ?? m.image} alt="" loading="lazy" style={{ aspectRatio: String(m.aspect) }} />
                <span>{m.name}</span>
              </button>
            ))}
          </div>
          <p className="small muted">Your opponent sees your mat on your side too, and you see theirs.</p>
        </>
      ) : (
        <>
          <h3 className="small">Board background</h3>
          <div className="mat-grid">
            <button type="button" className={`mat-pick${!prefs.backdrop ? " on" : ""}`} aria-pressed={!prefs.backdrop} onClick={() => setBoardPrefs({ backdrop: "" })}>
              <span className="mat-plain" />
              <span>Plain (venue colours)</span>
            </button>
            {BACKDROPS.map((b) => (
              <button key={b.id} type="button" className={`mat-pick${prefs.backdrop === b.id ? " on" : ""}`} aria-pressed={prefs.backdrop === b.id} onClick={() => setBoardPrefs({ backdrop: b.id })}>
                <img src={b.thumb ?? b.image} alt="" loading="lazy" />
                <span>{b.name}</span>
              </button>
            ))}
          </div>
        </>
      )}
      <p className="small muted">
        Saved on this device. Want your own picture? <Link to="/play/mats">Add a board</Link>.
      </p>
    </div>
  );
}

/** The Board button at the top right of a game table, which opens the chooser. */
export function BoardButton() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  return (
    <>
      <button type="button" className="secondary-btn small board-btn" onClick={() => setOpen(true)} title="Change the board layout or background">
        Board
      </button>
      {open && (
        <div className="modal-backdrop" onClick={() => setOpen(false)}>
          <div className="modal" role="dialog" aria-modal="true" aria-label="Choose your board" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h2>Choose your board</h2>
              <button type="button" className="icon-btn" onClick={() => setOpen(false)} aria-label="Close">
                ×
              </button>
            </div>
            <BoardChooser />
          </div>
        </div>
      )}
    </>
  );
}
