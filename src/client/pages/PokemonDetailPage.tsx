import { Fragment, useRef, useState } from "react";
import { Link, useParams } from "react-router";
import { useApi, type PokemonDetail } from "../lib/api";
import { animatedSprite, artwork, cry, dexNumber, shinyArtwork, sprite } from "../lib/sprites";
import { CardThumb, ErrorBox, GAME_TYPES, Loading, TypeBadge } from "../components/ui";
import typeChart from "../../shared/type-chart.json";
import { NotFoundPage } from "./NotFoundPage";

const STAT_LABELS: [keyof PokemonDetail["stats"], string][] = [
  ["hp", "HP"],
  ["attack", "Attack"],
  ["defense", "Defense"],
  ["spAttack", "Sp. Atk"],
  ["spDefense", "Sp. Def"],
  ["speed", "Speed"],
];

const chart = typeChart as Record<string, Record<string, number>>;

/** How much damage each attacking type does to a Pokémon with these types. */
function defensiveMatchups(types: string[]) {
  const groups: Record<string, string[]> = { "4": [], "2": [], "0.5": [], "0.25": [], "0": [] };
  for (const attacker of GAME_TYPES) {
    const factor = types.reduce((m, t) => m * (chart[attacker]?.[t] ?? 1), 1);
    groups[String(factor)]?.push(attacker);
  }
  return groups;
}

function evolutionStages(chain: PokemonDetail["evolutionChain"]) {
  const byId = new Map(chain.map((p) => [p.id, p]));
  const depth = (id: number): number => {
    const from = byId.get(id)?.evolvesFrom;
    return from && byId.has(from) ? depth(from) + 1 : 0;
  };
  const stages: PokemonDetail["evolutionChain"][] = [];
  for (const p of chain) (stages[depth(p.id)] ??= []).push(p);
  return stages;
}

export function PokemonDetailPage() {
  const { slug } = useParams();
  const { data: p, error, loading } = useApi<PokemonDetail>(`/api/pokemon/${slug}`);
  const [shiny, setShiny] = useState(false);
  const [showAllCards, setShowAllCards] = useState(false);
  const audio = useRef<HTMLAudioElement | null>(null);

  if (loading && !p) return <Loading label="Loading Pokémon" />;
  if (error === "Pokémon not found") return <NotFoundPage what="Pokémon" />;
  if (error || !p) return <ErrorBox message={error ?? "Unknown error"} />;

  const total = STAT_LABELS.reduce((sum, [k]) => sum + (p.stats[k] ?? 0), 0);
  const matchups = defensiveMatchups(p.types);
  const stages = evolutionStages(p.evolutionChain);

  const playCry = () => {
    audio.current?.pause();
    audio.current = new Audio(cry(p.id));
    audio.current.play().catch(() => undefined);
  };

  return (
    <div className="mon">
      <nav className="mon-nav" aria-label="Previous and next Pokémon">
        {p.previous ? (
          <Link to={`/pokedex/${p.previous.slug}`}>
            ← {dexNumber(p.previous.id)} {p.previous.name}
          </Link>
        ) : (
          <span />
        )}
        <Link to="/pokedex">All Pokémon</Link>
        {p.next ? (
          <Link to={`/pokedex/${p.next.slug}`}>
            {dexNumber(p.next.id)} {p.next.name} →
          </Link>
        ) : (
          <span />
        )}
      </nav>

      <section className={`mon-hero t-bg-${p.types[0]}`}>
        <div className="mon-art">
          <img src={shiny ? shinyArtwork(p.id) : artwork(p.id)} alt={`${shiny ? "Shiny " : ""}${p.name}`} width={320} height={320} />
          <div className="mon-art-buttons">
            <button type="button" aria-pressed={shiny} onClick={() => setShiny(!shiny)}>
              {shiny ? "Show normal colours" : "Show shiny"}
            </button>
            <button type="button" onClick={playCry}>
              Play cry
            </button>
          </div>
        </div>
        <div className="mon-intro">
          <p className="dex-no big">{dexNumber(p.id)}</p>
          <h1>{p.name}</h1>
          <p className="genus">{p.genus}</p>
          <div className="type-row">
            {p.types.map((t) => (
              <TypeBadge key={t} type={t} />
            ))}
            {p.isLegendary && <span className="tag">Legendary</span>}
            {p.isMythical && <span className="tag">Mythical</span>}
          </div>
          {p.flavorText && <p className="flavor">{p.flavorText}</p>}
          <dl className="facts compact">
            <div>
              <dt>Height</dt>
              <dd>{p.height != null ? `${(p.height / 10).toFixed(1)} m` : "Unknown"}</dd>
            </div>
            <div>
              <dt>Weight</dt>
              <dd>{p.weight != null ? `${(p.weight / 10).toFixed(1)} kg` : "Unknown"}</dd>
            </div>
            <div>
              <dt>Generation</dt>
              <dd>{p.generation}</dd>
            </div>
          </dl>
          <div className="mini-sprites" aria-label="Sprites">
            <img src={sprite(p.id)} alt={`${p.name} pixel sprite`} width={96} height={96} />
            <img src={animatedSprite(p.id)} alt={`${p.name} animated sprite`} width={96} height={96} />
          </div>
        </div>
      </section>

      <div className="mon-grid">
        <section className="panel">
          <h2>Base stats</h2>
          <table className="stats">
            <tbody>
              {STAT_LABELS.map(([k, label]) => (
                <tr key={k}>
                  <th scope="row">{label}</th>
                  <td className="num">{p.stats[k]}</td>
                  <td className="bar-cell">
                    <span className="bar" style={{ width: `${Math.min(100, (p.stats[k] / 255) * 100)}%` }} data-level={p.stats[k] >= 100 ? "high" : p.stats[k] >= 60 ? "mid" : "low"} />
                  </td>
                </tr>
              ))}
              <tr className="total">
                <th scope="row">Total</th>
                <td className="num">{total}</td>
                <td />
              </tr>
            </tbody>
          </table>
        </section>

        <section className="panel">
          <h2>Abilities</h2>
          <ul className="abilities">
            {p.abilities.map((a) => (
              <li key={a.name}>
                <strong>{a.name}</strong>
                {a.hidden && <span className="tag">Hidden</span>}
                {a.effect && <p>{a.effect}</p>}
              </li>
            ))}
          </ul>
        </section>

        <section className="panel">
          <h2>Type matchups</h2>
          <p className="muted small">Damage this Pokémon takes in the video games.</p>
          {(
            [
              ["4", "Takes 4×"],
              ["2", "Takes 2×"],
              ["0.5", "Takes ½"],
              ["0.25", "Takes ¼"],
              ["0", "No damage"],
            ] as const
          ).map(([k, label]) =>
            matchups[k].length ? (
              <div className="matchup" key={k}>
                <span className="matchup-label">{label}</span>
                <span className="type-row">
                  {matchups[k].map((t) => (
                    <TypeBadge key={t} type={t} />
                  ))}
                </span>
              </div>
            ) : null,
          )}
        </section>

        {p.evolutionChain.length > 1 && (
          <section className="panel">
            <h2>Evolution</h2>
            <div className="evo">
              {stages.map((stage, i) => (
                <Fragment key={i}>
                {i > 0 && <span className="evo-arrow" aria-hidden="true">↓</span>}
                <div className="evo-stage">
                  {stage.map((e) => (
                    <Link key={e.id} to={`/pokedex/${e.slug}`} className={`evo-mon ${e.id === p.id ? "current" : ""}`}>
                      <img src={sprite(e.id)} alt="" width={72} height={72} />
                      <span>{e.name}</span>
                    </Link>
                  ))}
                </div>
                </Fragment>
              ))}
            </div>
          </section>
        )}
      </div>

      <section className="related">
        <h2>
          {p.name} TCG cards <span className="muted">({p.cards.length})</span>
        </h2>
        {p.cards.length ? (
          <div className="card-grid small">
            {(showAllCards ? p.cards : p.cards.slice(0, 21)).map((c) => (
              <CardThumb key={c.id} card={c} />
            ))}
          </div>
        ) : (
          <p className="muted">No cards of {p.name} have been printed yet.</p>
        )}
        {p.cards.length > 21 && !showAllCards && (
          <button type="button" className="more-btn" onClick={() => setShowAllCards(true)}>
            Show all {p.cards.length} cards
          </button>
        )}
      </section>
    </div>
  );
}
