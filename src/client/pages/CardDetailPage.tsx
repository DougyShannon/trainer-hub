import { Link, useParams } from "react-router";
import { useApi, type CardDetail } from "../lib/api";
import { CardThumb, Energy, ErrorBox, Loading } from "../components/ui";
import { sprite } from "../lib/sprites";
import { NotFoundPage } from "./NotFoundPage";

export function CardDetailPage() {
  const { id } = useParams();
  const { data: card, error, loading } = useApi<CardDetail>(`/api/cards/${id}`);

  if (loading && !card) return <Loading label="Loading card" />;
  if (error === "Card not found") return <NotFoundPage what="card" />;
  if (error || !card) return <ErrorBox message={error ?? "Unknown error"} />;

  const d = card.details;
  const isPokemon = card.supertype === "Pokémon";

  return (
    <div className="card-detail">
      <p className="crumbs">
        <Link to="/cards">Cards</Link> / <Link to={`/cards?set=${card.set.id}`}>{card.set.name}</Link> / {card.name}
      </p>

      <div className="card-detail-grid">
        <div className="card-image">
          {card.imageLarge || card.image ? (
            <img src={card.imageLarge ?? card.image ?? ""} alt={card.name} width={480} height={670} />
          ) : (
            <div className="card-missing large">{card.name}</div>
          )}
        </div>

        <div className="card-info">
          <div className="card-title">
            <div>
              <p className="eyebrow">
                {card.supertype}
                {card.subtypes.length > 0 && ` · ${card.subtypes.join(" · ")}`}
              </p>
              <h1>{card.name}</h1>
              {card.evolvesFrom && <p className="muted">Evolves from {card.evolvesFrom}</p>}
            </div>
            {isPokemon && (
              <div className="hp">
                {card.hp && (
                  <>
                    <small>HP</small>
                    {card.hp}
                  </>
                )}
                <span className="type-row">
                  {card.types.map((t) => (
                    <Energy key={t} type={t} />
                  ))}
                </span>
              </div>
            )}
          </div>

          {d.ancientTrait && (
            <div className="effect ancient">
              <h3>Ancient Trait: {d.ancientTrait.name}</h3>
              <p>{d.ancientTrait.text}</p>
            </div>
          )}

          {d.abilities?.map((a) => (
            <div className="effect ability" key={a.name}>
              <h3>
                <span className="ability-tag">{a.type}</span> {a.name}
              </h3>
              <p>{a.text}</p>
            </div>
          ))}

          {d.attacks?.map((a, i) => (
            <div className="effect attack" key={`${a.name}-${i}`}>
              <div className="attack-head">
                <span className="cost">
                  {(a.cost?.length ? a.cost : ["Free"]).map((c, j) => (
                    <Energy key={j} type={c} />
                  ))}
                </span>
                <h3>{a.name}</h3>
                {a.damage && <span className="damage">{a.damage}</span>}
              </div>
              {a.text && <p>{a.text}</p>}
            </div>
          ))}

          {d.rules?.map((r, i) => (
            <p className="rule" key={i}>
              {r}
            </p>
          ))}

          {isPokemon && (
            <dl className="wrr">
              <div>
                <dt>Weakness</dt>
                <dd>
                  {d.weaknesses?.length
                    ? d.weaknesses.map((w) => (
                        <span key={w.type}>
                          <Energy type={w.type} /> {w.value}
                        </span>
                      ))
                    : "None"}
                </dd>
              </div>
              <div>
                <dt>Resistance</dt>
                <dd>
                  {d.resistances?.length
                    ? d.resistances.map((r) => (
                        <span key={r.type}>
                          <Energy type={r.type} /> {r.value}
                        </span>
                      ))
                    : "None"}
                </dd>
              </div>
              <div>
                <dt>Retreat</dt>
                <dd>{d.retreatCost?.length ? d.retreatCost.map((c, i) => <Energy key={i} type={c} />) : "Free"}</dd>
              </div>
            </dl>
          )}

          {d.flavorText && <p className="flavor">{d.flavorText}</p>}

          <dl className="facts">
            <div>
              <dt>Set</dt>
              <dd>
                <Link to={`/cards?set=${card.set.id}`} className="set-link">
                  {card.set.symbol && <img src={card.set.symbol} alt="" width={18} height={18} />}
                  {card.set.name}
                </Link>
              </dd>
            </div>
            <div>
              <dt>Number</dt>
              <dd>
                {card.number} / {card.set.printedTotal}
              </dd>
            </div>
            <div>
              <dt>Rarity</dt>
              <dd>{card.rarity ?? "Not listed"}</dd>
            </div>
            <div>
              <dt>Released</dt>
              <dd>{new Date(card.set.releaseDate).toLocaleDateString(undefined, { dateStyle: "medium" })}</dd>
            </div>
            <div>
              <dt>Illustrator</dt>
              <dd>{card.artist ?? "Not listed"}</dd>
            </div>
            <div>
              <dt>Regulation mark</dt>
              <dd>{card.regulationMark ?? "None"}</dd>
            </div>
            <div>
              <dt>Standard</dt>
              <dd>
                <span className={`legal ${card.legal.standard ? "yes" : "no"}`}>{card.legal.standard ? "Legal" : "Not legal"}</span>
              </dd>
            </div>
            <div>
              <dt>Expanded</dt>
              <dd>
                <span className={`legal ${card.legal.expanded ? "yes" : "no"}`}>{card.legal.expanded ? "Legal" : "Not legal"}</span>
              </dd>
            </div>
          </dl>

          {card.pokemon.length > 0 && (
            <div className="dex-links">
              <h2>In the Pokédex</h2>
              <div className="dex-link-row">
                {card.pokemon.map((p) => (
                  <Link key={p.id} to={`/pokedex/${p.slug}`} className="dex-chip">
                    <img src={sprite(p.id)} alt="" width={48} height={48} />
                    {p.name}
                  </Link>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {card.otherPrintings.length > 0 && (
        <section className="related">
          <h2>Other cards named {card.name}</h2>
          <div className="card-grid small">
            {card.otherPrintings.map((c) => (
              <CardThumb key={c.id} card={c} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
