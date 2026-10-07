import { Link } from "react-router";
import { useApi, type DeckSummary } from "../lib/api";
import { useAuth } from "../lib/auth";
import { DeckTile } from "../components/DeckTile";
import { ErrorBox, Loading, PageLogo } from "../components/ui";

export function DecksPage() {
  const { user, ready } = useAuth();
  const { data, error, loading } = useApi<DeckSummary[]>(user ? "/api/decks/mine" : null, { fresh: true });

  if (!ready) return <Loading />;

  return (
    <div className="decks-page">
      <div className="page-head">
        <h1 className="with-logo">
          <PageLogo />
          {user ? "My decks" : "Deck builder"}
        </h1>
        <div className="row-actions">
          <Link to="/decks/new?import=1" className="secondary-btn">
            Import a list
          </Link>
          <Link to="/decks/new" className="primary-btn">
            Build a new deck
          </Link>
        </div>
      </div>

      {!user && (
        <div className="panel intro-panel">
          <h2>Build a 60-card deck from every card ever printed</h2>
          <p>
            The builder checks the official deck rules as you go: 60 cards, no more than 4 of a card, at least one Basic Pokémon, and
            Standard or Expanded legality. You can start without an account.
          </p>
          <p>
            <Link to="/signup?next=/decks">Create an account</Link> or <Link to="/login?next=/decks">log in</Link> to save decks and share
            them on your profile.
          </p>
        </div>
      )}

      {user && error && <ErrorBox message={error} />}
      {user && loading && !data && <Loading label="Loading your decks" />}
      {user && data && data.length === 0 && (
        <div className="empty-state">
          <h2>No decks yet</h2>
          <p>Build one from scratch, or paste a list from Pokémon TCG Live or Limitless.</p>
        </div>
      )}
      {user && data && data.length > 0 && (
        <div className="deck-grid">
          {data.map((d) => (
            <DeckTile key={d.id} deck={d} to={`/decks/${d.id}/edit`} />
          ))}
        </div>
      )}
    </div>
  );
}
