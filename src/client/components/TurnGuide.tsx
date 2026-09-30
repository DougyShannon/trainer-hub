import { useState } from "react";

// "What can I do now?" for the game tables: every option in a turn and whether you can do it right
// now. Tap an option's name to read how; tap its green "Can do" to raise the cards in your hand that
// do it (or to open your Active Pokémon, for attacking and retreating).

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
  // Rows start as just their header; tap a header to read how to do it.
  const [expanded, setExpanded] = useState<string | null>(null);
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
              const isOpen = expanded === r.what;
              const mark = MARK[r.state];
              return (
                <li key={r.what} className={`guide-row g-${r.state}${on ? " picked" : ""}${isOpen ? " open" : ""}`}>
                  <div className="guide-top">
                    <button type="button" className="guide-name" aria-expanded={isOpen} onClick={() => setExpanded(isOpen ? null : r.what)}>
                      <span className="guide-caret" aria-hidden="true">
                        {isOpen ? "▾" : "▸"}
                      </span>
                      <strong>{r.what}</strong>
                    </button>
                    {mark &&
                      (raises || shows ? (
                        <button
                          type="button"
                          className={`guide-mark m-${r.state} tap`}
                          aria-pressed={raises ? on : undefined}
                          title={raises ? (on ? "Put the cards back" : "Show the cards in your hand") : r.show!.label}
                          onClick={() => (raises ? onPick!(on ? null : r) : r.show!.run())}
                        >
                          {on ? "Showing" : mark}
                        </button>
                      ) : (
                        <span className={`guide-mark m-${r.state}`}>{mark}</span>
                      ))}
                  </div>
                  {isOpen && (
                    <div className="guide-more">
                      <span className="small">{r.how}</span>
                      {r.note && <span className="small muted">{r.note}</span>}
                      {raises && (
                        <span className="small muted">
                          Tap "Can do" to raise {r.cards!.length === 1 ? "the card" : `the ${r.cards!.length} cards`} in your hand.
                        </span>
                      )}
                      {shows && <span className="small muted">Tap "Can do" to {r.show!.label.toLowerCase()}.</span>}
                    </div>
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
