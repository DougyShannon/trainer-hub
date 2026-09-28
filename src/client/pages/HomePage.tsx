import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { useApi, type PokemonSummary, type SetInfo } from "../lib/api";
import { artwork, dexNumber } from "../lib/sprites";
import { TypeBadge } from "../components/ui";

// Same Pokémon for everyone on a given day.
function pokemonOfTheDay(list: PokemonSummary[]) {
  const day = Math.floor(Date.now() / 86_400_000);
  return list[(day * 2654435761) % list.length];
}

export function HomePage() {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const sets = useApi<SetInfo[]>("/api/sets");
  const pokemon = useApi<PokemonSummary[]>("/api/pokemon");

  const latestSet = sets.data?.[0];
  const cardCount = sets.data?.reduce((sum, s) => sum + s.card_count, 0);
  const featured = pokemon.data?.length ? pokemonOfTheDay(pokemon.data) : null;

  return (
    <div className="home">
      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">Fan-made Pokémon TCG hub</p>
          <h1>Look up any card. Learn every Pokémon.</h1>
          <p className="lede">
            Search {cardCount ? cardCount.toLocaleString() : "every"} cards from {sets.data?.length ?? "every"} sets,
            explore all {pokemon.data?.length ?? "1,025"} Pokémon, and build 60-card decks with the rules checked for you.
            Live games against other players are on the way.
          </p>
          <form
            className="hero-search"
            onSubmit={(e) => {
              e.preventDefault();
              navigate(query.trim() ? `/cards?q=${encodeURIComponent(query.trim())}` : "/cards");
            }}
          >
            <label htmlFor="home-search" className="sr-only">
              Search cards
            </label>
            <input
              id="home-search"
              type="search"
              placeholder="Search cards, e.g. Charizard"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <button type="submit">Search cards</button>
          </form>
        </div>

        {featured && (
          <Link to={`/pokedex/${featured.slug}`} className="potd">
            <span className="eyebrow">Pokémon of the day</span>
            <img src={artwork(featured.id)} alt={featured.name} width={220} height={220} />
            <span className="potd-name">
              <span className="dex-no">{dexNumber(featured.id)}</span> {featured.name}
            </span>
            <span className="type-row">
              {featured.types.map((t) => (
                <TypeBadge key={t} type={t} />
              ))}
            </span>
          </Link>
        )}
      </section>

      <section className="home-tiles">
        <Link to="/cards" className="tile">
          <h2>Card database</h2>
          <p>Filter by type, set, rarity, HP and format. Every card has its attacks, weakness and legality.</p>
        </Link>
        <Link to="/pokedex" className="tile">
          <h2>Pokédex</h2>
          <p>Stats, abilities, evolutions, type matchups, sprites and every TCG card for each Pokémon.</p>
        </Link>
        <Link to="/decks/new" className="tile">
          <h2>Deck builder</h2>
          <p>Build a 60-card deck with the rules checked as you go. Import and export TCG Live lists.</p>
        </Link>
        {latestSet && (
          <Link to={`/cards?set=${latestSet.id}`} className="tile">
            <span className="eyebrow">Newest set</span>
            <h2>{latestSet.name}</h2>
            <p>
              {latestSet.series} · released {new Date(latestSet.release_date).toLocaleDateString(undefined, { dateStyle: "medium" })} ·{" "}
              {latestSet.card_count} cards
            </p>
          </Link>
        )}
      </section>

      <section className="coming">
        <h2>Coming next</h2>
        <ul>
          <li>
            <strong>Match records</strong> and ratings on trainer profiles.
          </li>
          <li>
            <strong>Live games</strong> against other players at a shared table.
          </li>
        </ul>
      </section>
    </div>
  );
}
