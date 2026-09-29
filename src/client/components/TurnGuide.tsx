import { useState } from "react";

// "What can I do now?" for the game tables: every option in a turn, whether you can do it right
// now, and exactly which buttons to press to do it. Tap an option to raise the cards in your hand
// that do it (or to open your Active Pokémon, for attacking and retreating).

export type GuideRow = {
  what: string;
  how: string;
  /** ready: you can do it now; done: used up this turn; blocked: not right now; info: always true */
  state: "ready" | "done" | "blocked" | "info";
  note?: string | null;
  show?: { label: string; run: () => void };
  /** The cards in your hand that do this, raised when the row is tapped. */
  cards?: string[];
};

const MARK: Record<GuideRow["state"], string> = { ready: "Can do", done: "Done", blocked: "Not now", info: "" };

export function TurnGuide({
  title,
  intro,
  rows,
  picked,
  onPick,
}: {
  title: string;
  intro?: string;
  rows: GuideRow[];
  /** The row whose cards are raised in your hand right now. */
  picked?: string | null;
  onPick?: (row: GuideRow | null) => void;
}) {
  const [open, setOpen] = useState(true);
  return (
    <section className="turn-guide" aria-label={title}>
      <button type="button" className="turn-guide-head" aria-expanded={open} onClick={() => setOpen(!open)}>
        <strong>{title}</strong>
        <span className="muted small">{open ? "Hide" : "Show"}</span>
      </button>
      {open && (
        <>
          {intro && <p className="small muted">{intro}</p>}
          <ol className="guide-list">
            {rows.map((r) => {
              const raises = r.state === "ready" && !!r.cards?.length && !!onPick;
              const shows = r.state === "ready" && !!r.show && !raises;
              const on = raises && picked === r.what;
              const body = (
                <>
                  <div className="guide-top">
                    <strong>{r.what}</strong>
                    {MARK[r.state] && <span className={`guide-mark m-${r.state}`}>{MARK[r.state]}</span>}
                  </div>
                  <span className="small">{r.how}</span>
                  {r.note && <span className="small muted">{r.note}</span>}
                  {raises && (
                    <span className="guide-tap small">
                      {on ? "Showing these cards in your hand. Tap again to put them back." : `Tap to show ${r.cards!.length === 1 ? "the card" : `the ${r.cards!.length} cards`} in your hand`}
                    </span>
                  )}
                  {shows && <span className="guide-tap small">Tap to {r.show!.label.toLowerCase()}</span>}
                </>
              );
              return (
                <li key={r.what} className={`guide-row g-${r.state}${raises || shows ? " tappable" : ""}${on ? " picked" : ""}`}>
                  {raises || shows ? (
                    <button type="button" className="guide-btn" aria-pressed={raises ? on : undefined} onClick={() => (raises ? onPick!(on ? null : r) : r.show!.run())}>
                      {body}
                    </button>
                  ) : (
                    body
                  )}
                </li>
              );
            })}
          </ol>
        </>
      )}
    </section>
  );
}
