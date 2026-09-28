import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useLocation } from "react-router";
import { send, useApi, type CardSummary, type DeckSummary } from "../lib/api";
import { useAuth } from "../lib/auth";

const KEY = "trainer-hub:add-to-deck";
const readSaved = () => {
  try {
    return localStorage.getItem(KEY) ?? "";
  } catch {
    return "";
  }
};

type Target = { deck: DeckSummary | null; add: (card: CardSummary) => void; busy: string | null };
const TargetContext = createContext<Target | null>(null);

/**
 * "Adding to: [deck]" bar for pages that list cards. Pick one of your decks once, then the
 * + buttons on each card (AddToDeckButton) drop a copy straight into it.
 */
export function DeckTarget({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { pathname } = useLocation();
  const [reloadKey, setReloadKey] = useState(0);
  const { data: decks } = useApi<DeckSummary[]>(user ? "/api/decks/mine" : null, { fresh: true, reloadKey });
  const [deckId, setDeckId] = useState(readSaved);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ text: string; bad?: boolean } | null>(null);
  const justMade = useRef<string | null>(null); // a new deck the list hasn't caught up with yet

  const deck = decks?.find((d) => d.id === deckId) ?? null;

  // Default to the most recently edited deck.
  useEffect(() => {
    if (!decks?.length || decks.some((d) => d.id === deckId)) return;
    if (deckId && deckId === justMade.current) return;
    setDeckId(decks[0].id);
  }, [decks, deckId]);

  useEffect(() => {
    if (!note) return;
    const t = setTimeout(() => setNote(null), 4000);
    return () => clearTimeout(t);
  }, [note]);

  const choose = async (value: string) => {
    if (value === "new") {
      const name = window.prompt("Name your new deck");
      if (!name?.trim()) return;
      const made = await send<{ id: string }>("POST", "/api/decks", { name: name.trim(), cards: [] });
      value = made.id;
      justMade.current = made.id;
      setReloadKey((k) => k + 1);
    }
    setDeckId(value);
    try {
      localStorage.setItem(KEY, value);
    } catch {
      // Storage blocked: the choice lasts for this visit.
    }
  };

  const add = async (card: CardSummary) => {
    if (!deck || busy) return;
    setBusy(card.id);
    try {
      const res = await send<{ deckName: string; cardCount: number; copies: number }>("POST", `/api/decks/${deck.id}/add`, { cardId: card.id });
      setNote({ text: `Added ${card.name} to ${res.deckName}: ${res.copies} in the deck, ${res.cardCount}/60 cards.` });
      setReloadKey((k) => k + 1);
    } catch (e) {
      setNote({ text: (e as Error).message, bad: true });
    } finally {
      setBusy(null);
    }
  };

  return (
    <TargetContext.Provider value={{ deck, add, busy }}>
      <div className="deck-target">
        {!user ? (
          <p className="muted small">
            <Link to={`/login?next=${encodeURIComponent(pathname)}`}>Log in</Link> to add these cards straight to your decks.
          </p>
        ) : (
          <>
            <label htmlFor="deck-target">Add cards to</label>
            <select id="deck-target" value={deck?.id ?? ""} onChange={(e) => choose(e.target.value).catch((err) => setNote({ text: (err as Error).message, bad: true }))}>
              {!decks?.length && <option value="">Choose a deck</option>}
              {decks?.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name} ({d.cardCount}/60)
                </option>
              ))}
              <option value="new">+ New deck…</option>
            </select>
            {deck && (
              <Link to={`/decks/${deck.id}/edit`} className="small">
                Open deck
              </Link>
            )}
          </>
        )}
        {note && (
          <p className={`deck-target-note small${note.bad ? " bad" : ""}`} role="status">
            {note.text}
          </p>
        )}
      </div>
      {children}
    </TargetContext.Provider>
  );
}

/** The + button on a card. Renders nothing outside a DeckTarget or before a deck is chosen. */
export function AddToDeckButton({ card }: { card: CardSummary }) {
  const target = useContext(TargetContext);
  if (!target?.deck) return null;
  return (
    <button
      type="button"
      className="add-to-deck"
      onClick={() => target.add(card)}
      disabled={!!target.busy}
      aria-label={`Add ${card.name} (${card.setName} ${card.number}) to ${target.deck.name}`}
      title={`Add to ${target.deck.name}`}
    >
      {target.busy === card.id ? "…" : "+"}
    </button>
  );
}
