import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { send, useApi, type DeckDetail } from "../lib/api";
import { useAuth } from "../lib/auth";
import { basicCount, countOf, groupEntries, SECTIONS } from "../lib/deck";
import { checkDeck, FORMAT_LABELS, openingBasicChance } from "../../shared/deck-rules";
import { sprite } from "../lib/sprites";
import { ErrorBox, Loading } from "../components/ui";
import { ExportModal, HandModal } from "./DeckBuilderPage";
import { NotFoundPage } from "./NotFoundPage";

export function DeckViewPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { data: deck, error, loading } = useApi<DeckDetail>(`/api/decks/${id}`, { fresh: true });
  const [modal, setModal] = useState<"export" | "hand" | null>(null);
  const [copyError, setCopyError] = useState<string | null>(null);

  const groups = useMemo(() => groupEntries(deck?.cards ?? []), [deck]);
  const problems = useMemo(() => (deck ? checkDeck(deck.cards, deck.format) : []), [deck]);

  if (loading && !deck) return <Loading label="Loading deck" />;
  if (error === "Deck not found") return <NotFoundPage what="deck" />;
  if (error || !deck) return <ErrorBox message={error ?? "Unknown error"} />;

  const total = countOf(deck.cards);
  const copy = async () => {
    if (!user) {
      navigate(`/login?next=${encodeURIComponent(`/decks/${deck.id}`)}`);
      return;
    }
    try {
      const res = await send<{ id: string }>("POST", `/api/decks/${deck.id}/copy`);
      navigate(`/decks/${res.id}/edit`);
    } catch (err) {
      setCopyError((err as Error).message);
    }
  };

  return (
    <div className="deck-view">
      <div className="page-head">
        <div>
          <p className="eyebrow">
            {FORMAT_LABELS[deck.format]} deck · {total} cards
          </p>
          <h1>{deck.name}</h1>
          <Link to={`/trainer/${deck.owner.trainerName}`} className="owner-link">
            <img src={sprite(deck.owner.avatarDex)} alt="" width={40} height={40} />
            {deck.owner.trainerName}
          </Link>
        </div>
        <div className="row-actions">
          <button type="button" className="secondary-btn" onClick={() => setModal("hand")} disabled={total < 7}>
            Draw a sample hand
          </button>
          <button type="button" className="secondary-btn" onClick={() => setModal("export")}>
            Export
          </button>
          {deck.isOwner ? (
            <Link to={`/decks/${deck.id}/edit`} className="primary-btn">
              Edit deck
            </Link>
          ) : (
            <button type="button" className="primary-btn" onClick={copy}>
              Copy to my decks
            </button>
          )}
        </div>
      </div>
      {copyError && <p className="form-error">{copyError}</p>}

      {problems.length ? (
        <ul className="problems">
          {problems.map((p) => (
            <li key={p.rule}>{p.message}</li>
          ))}
        </ul>
      ) : (
        <p className="form-ok">
          Ready to play in {FORMAT_LABELS[deck.format]}. {Math.round(openingBasicChance(total, basicCount(deck.cards)) * 100)}% chance of a Basic
          Pokémon in the opening hand.
        </p>
      )}

      {SECTIONS.map((section) =>
        groups[section].length ? (
          <section key={section} className="related">
            <h2>
              {section} <span className="muted">({countOf(groups[section])})</span>
            </h2>
            <div className="card-grid small">
              {groups[section].map(({ card, count }) => (
                <Link key={card.id} to={`/cards/${card.id}`} className="card-thumb stacked">
                  <span className="stack-count">×{count}</span>
                  <img src={card.image ?? ""} alt={card.name} loading="lazy" width={245} height={342} />
                  <span className="card-thumb-name">{card.name}</span>
                  <span className="card-thumb-meta">
                    {card.setCode ?? card.setName} {card.number}
                  </span>
                </Link>
              ))}
            </div>
          </section>
        ) : null,
      )}

      {modal === "export" && <ExportModal entries={deck.cards} onClose={() => setModal(null)} />}
      {modal === "hand" && <HandModal entries={deck.cards} onClose={() => setModal(null)} />}
    </div>
  );
}
