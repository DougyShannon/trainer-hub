import { Link } from "react-router";
import type { CardRef } from "../../shared/game-types";
import { useApi, type CardDetail } from "../lib/api";
import { Energy } from "./ui";

// The full text of a card for the game tables' side panel: what it's weak to, its attacks and
// what it evolves from and into. Cards on the table only carry a name and picture, so the rest
// comes from the card API (and is cached after the first look).

export function useCardDetail(cardId: string | null) {
  return useApi<CardDetail>(cardId ? `/api/cards/${encodeURIComponent(cardId)}` : null).data;
}

/** Card type, HP and evolution line, for beside the card picture. */
export function CardSummary({ card, detail }: { card: CardRef; detail: CardDetail | null }) {
  const pokemon = card.supertype === "Pokémon";
  const evolvesTo = detail?.details.evolvesTo ?? [];
  return (
    <div className="card-summary small">
      <span className="muted">
        {card.supertype}
        {card.subtypes.length > 0 && ` · ${card.subtypes.join(" · ")}`}
      </span>
      {pokemon && (detail?.hp ?? card.hp) && (
        <span className="card-summary-hp">
          <strong>{detail?.hp ?? card.hp} HP</strong>
          {detail?.types.map((t) => <Energy key={t} type={t} />)}
        </span>
      )}
      {pokemon && detail && (
        <span>
          {detail.evolvesFrom ? (
            <>
              Evolves from <strong>{detail.evolvesFrom}</strong>
            </>
          ) : card.subtypes.includes("Basic") ? (
            "Basic Pokémon: goes straight into play"
          ) : null}
        </span>
      )}
      {pokemon && evolvesTo.length > 0 && (
        <span>
          Evolves into <strong>{evolvesTo.join(", ")}</strong>
        </span>
      )}
      <Link to={`/cards/${card.cardId}`} target="_blank" rel="noreferrer">
        Full card page
      </Link>
    </div>
  );
}

/** Abilities, attacks, rules text and Weakness / Resistance / Retreat. */
export function CardText({
  detail,
  attacks = true,
  stats = true,
  rules = true,
}: {
  detail: CardDetail | null;
  attacks?: boolean;
  stats?: boolean;
  rules?: boolean;
}) {
  if (!detail) return <p className="small muted">Loading card text…</p>;
  const d = detail.details;
  const pokemon = detail.supertype === "Pokémon";
  const hasAny = (attacks && (d.abilities?.length || d.attacks?.length)) || (rules && d.rules?.length) || (stats && pokemon);
  if (!hasAny) return null;
  return (
    <div className="card-text">
      {attacks &&
        d.abilities?.map((a) => (
          <div key={a.name} className="practice-attack ability">
            <strong>
              {a.type}: {a.name}
            </strong>
            <span className="small">{a.text}</span>
          </div>
        ))}
      {attacks && d.attacks && d.attacks.length > 0 && (
        <>
          <h3 className="card-text-head">Attacks</h3>
          {d.attacks.map((a, i) => (
            <div key={a.name + i} className="practice-attack">
              <div className="practice-attack-head">
                <span className="type-row">
                  {(a.cost?.length ? a.cost : ["Free"]).map((c, j) => (
                    <Energy key={j} type={c} />
                  ))}
                </span>
                <strong>{a.name}</strong>
                {a.damage && <span className="practice-dmg">{a.damage}</span>}
              </div>
              {a.text && <span className="small">{a.text}</span>}
            </div>
          ))}
        </>
      )}
      {rules && d.rules?.map((r, i) => (
        <p key={i} className="small card-rule">
          {r}
        </p>
      ))}
      {stats && pokemon && (
        <dl className="wrr compact">
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
    </div>
  );
}
