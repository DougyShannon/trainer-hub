import { Link } from "react-router";
import type { DeckSummary } from "../lib/api";
import { FORMAT_LABELS } from "../../shared/deck-rules";

export function DeckTile({ deck, to }: { deck: DeckSummary; to: string }) {
  return (
    <Link to={to} className="deck-tile">
      <span className="deck-cover">
        {deck.coverImage ? <img src={deck.coverImage} alt="" loading="lazy" /> : <span className="deck-cover-empty" />}
      </span>
      <span className="deck-tile-body">
        <strong>{deck.name}</strong>
        <span className="deck-tile-meta">
          <span className={`legal ${deck.isValid ? "yes" : "no"}`}>{deck.isValid ? "Ready to play" : "Not legal yet"}</span>
          <span>{FORMAT_LABELS[deck.format]}</span>
          <span>{deck.cardCount} cards</span>
          {deck.isPublic && <span>Public</span>}
        </span>
      </span>
    </Link>
  );
}
