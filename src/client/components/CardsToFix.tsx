import { useEffect, useState } from "react";
import { send, useApi, type CardPage, type CardSummary } from "../lib/api";

// The "Cards to fix" list, opened with the Add button on the game screen. Anyone signed in can add
// a card the game can't play for them yet; the list is kept on the site for everyone, and a site
// owner takes a card off once it has been fixed.

type FixEntry = { id: number; name: string; cardId: string; kind: string; image: string | null; setName: string | null; by: string; addedAt: string };
type FixList = { admin: boolean; signedIn: boolean; cards: FixEntry[] };

const when = (sqlTime: string) =>
  new Date(sqlTime.replace(" ", "T") + "Z").toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });

/** Card search results, one per name (reprints share their effect). */
function useCardSearch(text: string) {
  const [query, setQuery] = useState(text.trim());
  useEffect(() => {
    const t = setTimeout(() => setQuery(text.trim()), 300);
    return () => clearTimeout(t);
  }, [text]);
  const { data, loading, error } = useApi<CardPage>(query.length >= 2 ? `/api/cards?q=${encodeURIComponent(query)}` : null);
  const seen = new Set<string>();
  const cards = (data?.cards ?? []).filter((c) => !seen.has(c.name.toLowerCase()) && seen.add(c.name.toLowerCase())).slice(0, 12);
  return { cards, loading: loading && query.length >= 2, error, ready: query.length >= 2 };
}

export function CardsToFix({ start = "", close }: { start?: string; close: () => void }) {
  const [reloadKey, setReloadKey] = useState(0);
  const { data, error } = useApi<FixList>("/api/cards-to-fix", { fresh: true, reloadKey });
  const [text, setText] = useState(start);
  const search = useCardSearch(text);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ text: string; bad?: boolean } | null>(null);
  const listed = new Set((data?.cards ?? []).map((c) => c.name.toLowerCase()));

  const add = async (card: CardSummary) => {
    setBusy(card.id);
    setNote(null);
    try {
      await send("POST", "/api/cards-to-fix", { cardId: card.id });
      setNote({ text: `Saved ${card.name} to the list.` });
      setText("");
    } catch (e) {
      setNote({ text: (e as Error).message, bad: true });
    } finally {
      setBusy(null);
      setReloadKey((k) => k + 1);
    }
  };

  const remove = async (entry: FixEntry) => {
    setBusy(`fix-${entry.id}`);
    setNote(null);
    try {
      await send("DELETE", `/api/cards-to-fix/${entry.id}`);
      setNote({ text: `Took ${entry.name} off the list.` });
    } catch (e) {
      setNote({ text: (e as Error).message, bad: true });
    } finally {
      setBusy(null);
      setReloadKey((k) => k + 1);
    }
  };

  return (
    <div className="modal-backdrop" onClick={close}>
      <div className="modal cards-to-fix" role="dialog" aria-modal="true" aria-label="Cards to fix" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Cards to fix</h2>
          <button type="button" className="icon-btn" aria-label="Close" onClick={close}>
            ×
          </button>
        </div>
        <p className="small muted">Found a card the game can't play for you yet? Search for it and save it here so it gets fixed. Everyone sees this list.</p>

        {data && !data.signedIn ? (
          <p className="small">Log in to add cards to the list.</p>
        ) : (
          <div className="fix-search">
            <input
              type="search"
              value={text}
              autoFocus
              placeholder="Search for a card by name"
              aria-label="Search for a card by name"
              onChange={(e) => setText(e.target.value)}
            />
            {search.loading && <p className="small muted">Searching…</p>}
            {search.error && <p className="small error-text">{search.error}</p>}
            {search.ready && !search.loading && !search.cards.length && <p className="small muted">No cards called that.</p>}
            {search.cards.length > 0 && (
              <ul className="fix-results">
                {search.cards.map((c) => {
                  const already = listed.has(c.name.toLowerCase());
                  return (
                    <li key={c.id}>
                      {c.image ? <img src={c.image} alt="" loading="lazy" /> : <span className="fix-thumb" />}
                      <span>
                        <strong>{c.name}</strong>
                        <span className="small muted">
                          {[c.supertype, ...c.subtypes].join(" · ")} · {c.setName}
                        </span>
                      </span>
                      <button type="button" className="primary-btn small" disabled={already || !!busy} onClick={() => add(c)}>
                        {already ? "On the list" : busy === c.id ? "Saving…" : "Save"}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}
        {note && <p className={`small ${note.bad ? "error-text" : "ok-text"}`}>{note.text}</p>}

        <h3 className="fix-count">
          {data
            ? data.cards.length
              ? `${data.cards.length} ${data.cards.length === 1 ? "card" : "cards"} on the list`
              : "Nothing on the list yet"
            : "The list"}
        </h3>
        {error && <p className="small error-text">{error}</p>}
        {!data && !error && <p className="small muted">Loading…</p>}
        {data && data.cards.length > 0 && (
          <ul className="fix-list">
            {data.cards.map((f) => (
              <li key={f.id}>
                {f.image ? <img src={f.image} alt="" loading="lazy" /> : <span className="fix-thumb" />}
                <span>
                  <strong>{f.name}</strong>
                  <span className="small muted">{f.kind}</span>
                  <span className="small">
                    Added by {f.by} · {when(f.addedAt)}
                  </span>
                </span>
                {data.admin && (
                  <button
                    type="button"
                    className="secondary-btn small"
                    disabled={!!busy}
                    onClick={() => remove(f)}
                    title="Take it off the list once the card is fixed"
                  >
                    {busy === `fix-${f.id}` ? "Removing…" : "Fixed: remove"}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
