import { useState } from "react";
import type { Seat } from "../../shared/game-types";
import { MANUAL_CONDITIONS, MANUAL_OPS, manualBlocked, type ManualOp } from "../../shared/practice/manual";
import type { PAction, PCard, PState } from "../../shared/practice/types";

// The "By hand" panel for practice and live games. When a card does something the game can't do for
// you yet (an older Supporter, an Ability, a Special Energy), it opens by itself: you read the card
// and do what it says with these moves, the same as on a real table. Each move goes in the game log.

export type ByHandFor = { card: PCard | null; text: string[]; why: string } | null;

const COUNTS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const DAMAGE = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 120, 150, 200];
const COND_LABEL: Record<string, string> = { asleep: "Asleep", burned: "Burned", confused: "Confused", paralyzed: "Paralyzed", poisoned: "Poisoned" };

export function ByHandPanel({
  state,
  me,
  act,
  about,
  close,
  report,
}: {
  state: PState;
  me: Seat;
  act: (a: PAction) => void;
  about: ByHandFor;
  close: () => void;
  /** Opens the "Cards to fix" list with this card's name filled in. */
  report: (name: string) => void;
}) {
  const [amounts, setAmounts] = useState<Partial<Record<ManualOp, number>>>({
    draw: 2,
    discardDeckTop: 1,
    oppShuffleDraw: 4,
    heal: 30,
    damage: 30,
    condition: 2,
  });
  const setAmount = (op: ManualOp, n: number) => setAmounts((a) => ({ ...a, [op]: n }));
  const groups = [...new Set(MANUAL_OPS.map((o) => o.group))];

  const run = (op: ManualOp) => act({ type: "byHand", op, amount: amounts[op] });

  return (
    <div className="modal-backdrop" onClick={close}>
      <div className="modal by-hand" role="dialog" aria-modal="true" aria-label="Do it by hand" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Do it by hand</h2>
          <button type="button" className="icon-btn" aria-label="Close" onClick={close}>
            ×
          </button>
        </div>
        {about?.card ? (
          <div className="by-hand-card">
            {about.card.image && <img src={about.card.image} alt={about.card.name} />}
            <div>
              <p className="small muted">{about.why}</p>
              <strong>{about.card.name}</strong>
              {about.text.map((t, i) => (
                <p key={i} className="small">
                  {t}
                </p>
              ))}
              <button type="button" className="secondary-btn small" onClick={() => report(about.card!.name)}>
                Add {about.card.name} to Cards to fix
              </button>
            </div>
          </div>
        ) : (
          <p className="small muted">
            Use these when a card says to do something the game doesn't do for you. Read the card, then do what it says here. Everything you do shows in the
            game log.
          </p>
        )}
        {groups.map((g) => (
          <section key={g} className="by-hand-group">
            <h3 className="small">{g}</h3>
            <div className="by-hand-ops">
              {MANUAL_OPS.filter((o) => o.group === g).map((o) => {
                const blocked = manualBlocked(state, me, o.op);
                return (
                  <div key={o.op} className="by-hand-op">
                    <button type="button" className="secondary-btn small" disabled={!!blocked} title={blocked ?? undefined} onClick={() => run(o.op)}>
                      {o.label}
                    </button>
                    {o.amount === "count" && (
                      <select aria-label="How many cards" value={amounts[o.op]} onChange={(e) => setAmount(o.op, Number(e.target.value))}>
                        {COUNTS.filter((n) => n > 0 || o.op === "oppShuffleDraw").map((n) => (
                          <option key={n} value={n}>
                            {n}
                          </option>
                        ))}
                      </select>
                    )}
                    {o.amount === "damage" && (
                      <select aria-label="How much damage" value={amounts[o.op]} onChange={(e) => setAmount(o.op, Number(e.target.value))}>
                        {DAMAGE.map((n) => (
                          <option key={n} value={n}>
                            {n}
                          </option>
                        ))}
                      </select>
                    )}
                    {o.op === "condition" && (
                      <select aria-label="Which Special Condition" value={amounts[o.op]} onChange={(e) => setAmount(o.op, Number(e.target.value))}>
                        {MANUAL_CONDITIONS.map((c, i) => (
                          <option key={c} value={i}>
                            {COND_LABEL[c]}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        ))}
        <div className="row-actions">
          <button type="button" className="primary-btn" onClick={close}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
