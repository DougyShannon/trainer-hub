import { Link } from "react-router";
import type { CardSummary } from "../lib/api";

export const TCG_TYPES = ["Grass", "Fire", "Water", "Lightning", "Psychic", "Fighting", "Darkness", "Metal", "Fairy", "Dragon", "Colorless"];

export const GAME_TYPES = [
  "normal", "fire", "water", "electric", "grass", "ice", "fighting", "poison", "ground",
  "flying", "psychic", "bug", "rock", "ghost", "dragon", "dark", "steel", "fairy",
];

const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** A video-game type, such as "grass" or "psychic". */
export function TypeBadge({ type }: { type: string }) {
  return <span className={`type-badge t-${type}`}>{capitalise(type)}</span>;
}

const ENERGY_LETTER: Record<string, string> = {
  Grass: "G", Fire: "R", Water: "W", Lightning: "L", Psychic: "P", Fighting: "F",
  Darkness: "D", Metal: "M", Fairy: "Y", Dragon: "N", Colorless: "C", Free: "–",
};

/** A TCG Energy symbol, drawn as a coloured coin with the standard letter. */
export function Energy({ type }: { type: string }) {
  return (
    <span className={`energy e-${type.toLowerCase()}`} title={`${type} Energy`} aria-label={`${type} Energy`}>
      {ENERGY_LETTER[type] ?? "?"}
    </span>
  );
}

export function CardThumb({ card }: { card: CardSummary }) {
  return (
    <Link to={`/cards/${card.id}`} className="card-thumb">
      {card.image ? (
        <img src={card.image} alt={card.name} loading="lazy" width={245} height={342} />
      ) : (
        <div className="card-missing">{card.name}</div>
      )}
      <span className="card-thumb-name">{card.name}</span>
      <span className="card-thumb-meta">
        {card.setName} · {card.number}
      </span>
    </Link>
  );
}

export function Loading({ label = "Loading" }: { label?: string }) {
  return (
    <div className="loading" role="status">
      <span className="spinner" aria-hidden="true" />
      {label}…
    </div>
  );
}

export function ErrorBox({ message }: { message: string }) {
  return (
    <div className="error-box" role="alert">
      <strong>That didn't load.</strong> {message}. Try refreshing the page.
    </div>
  );
}
