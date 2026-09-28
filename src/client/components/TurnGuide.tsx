import { useState } from "react";

// "What can I do now?" for the game tables: every option in a turn, whether you can do it right
// now, and exactly which buttons to press to do it.

export type GuideRow = {
  what: string;
  how: string;
  /** ready: you can do it now; done: used up this turn; blocked: not right now; info: always true */
  state: "ready" | "done" | "blocked" | "info";
  note?: string | null;
  show?: { label: string; run: () => void };
};

const MARK: Record<GuideRow["state"], string> = { ready: "Can do", done: "Done", blocked: "Not now", info: "" };

export function TurnGuide({ title, intro, rows }: { title: string; intro?: string; rows: GuideRow[] }) {
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
            {rows.map((r) => (
              <li key={r.what} className={`guide-row g-${r.state}`}>
                <div className="guide-top">
                  <strong>{r.what}</strong>
                  {MARK[r.state] && <span className={`guide-mark m-${r.state}`}>{MARK[r.state]}</span>}
                </div>
                <span className="small">{r.how}</span>
                {r.note && <span className="small muted">{r.note}</span>}
                {r.show && r.state === "ready" && (
                  <button type="button" className="link-btn guide-show" onClick={r.show.run}>
                    {r.show.label}
                  </button>
                )}
              </li>
            ))}
          </ol>
        </>
      )}
    </section>
  );
}
