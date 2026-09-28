import { Link, useParams } from "react-router";
import { useApi, type DeckSummary, type PokemonSummary, type RecentGame, type Trainer } from "../lib/api";
import { artwork, sprite } from "../lib/sprites";
import { DeckTile } from "../components/DeckTile";
import { ErrorBox, Loading } from "../components/ui";
import { NotFoundPage } from "./NotFoundPage";
import { timeAgo } from "./PlayPage";
import { OPPONENTS } from "../../shared/practice/opponents";

type Profile = {
  trainer: Trainer;
  isMe: boolean;
  decks: (DeckSummary & { coverImage?: string | null })[];
  record: { played: number; wins: number; losses: number };
  recentGames: RecentGame[];
  /** Practice ladder levels this trainer has beaten. */
  badges: number[];
};

export function TrainerPage() {
  const { name } = useParams();
  const { data, error, loading } = useApi<Profile>(`/api/trainers/${name}`, { fresh: true });
  const pokemon = useApi<PokemonSummary[]>("/api/pokemon");

  if (loading && !data) return <Loading label="Loading trainer" />;
  if (error === "Trainer not found") return <NotFoundPage what="trainer" />;
  if (error || !data) return <ErrorBox message={error ?? "Unknown error"} />;

  const { trainer, isMe, decks, record, recentGames } = data;
  const badges = OPPONENTS.filter((o) => data.badges?.includes(o.level));
  const favourite = pokemon.data?.find((p) => p.id === trainer.favouriteDex);
  const joined = new Date(trainer.createdAt.replace(" ", "T") + "Z").toLocaleDateString(undefined, { month: "long", year: "numeric" });

  return (
    <div className="trainer">
      <section className="trainer-card">
        <div className="trainer-avatar">
          <img src={artwork(trainer.avatarDex)} alt="" width={180} height={180} />
        </div>
        <div className="trainer-info">
          <p className="eyebrow">Trainer</p>
          <h1>{trainer.trainerName}</h1>
          <p className="muted">
            Joined {joined}
            {trainer.country && ` · ${trainer.country}`}
          </p>
          {trainer.bio && <p className="trainer-bio">{trainer.bio}</p>}
          {favourite && (
            <Link to={`/pokedex/${favourite.slug}`} className="dex-chip">
              <img src={sprite(favourite.id)} alt="" width={48} height={48} />
              Favourite: {favourite.name}
            </Link>
          )}
          <dl className="facts compact">
            <div>
              <dt>{isMe ? "Decks" : "Public decks"}</dt>
              <dd>{decks.length}</dd>
            </div>
            <div>
              <dt>Games played</dt>
              <dd>{record.played}</dd>
            </div>
            <div>
              <dt>Wins / losses</dt>
              <dd>
                {record.wins} / {record.losses}
              </dd>
            </div>
          </dl>
          {(badges.length > 0 || isMe) && (
            <div className="badge-case" aria-label="Practice badges">
              {OPPONENTS.map((o) => (
                <span key={o.level} className={`badge-slot${badges.includes(o) ? " earned" : ""}`} title={badges.includes(o) ? o.badge : `${o.badge} (not yet earned)`}>
                  <img src={sprite(o.ace)} alt="" width={40} height={40} />
                </span>
              ))}
              <Link to="/play/practice" className="small">
                {badges.length} of {OPPONENTS.length} practice badges
              </Link>
            </div>
          )}
          {isMe && (
            <div className="row-actions">
              <Link to="/me/settings" className="secondary-btn">
                Edit profile
              </Link>
              <Link to="/decks/new" className="primary-btn">
                Build a deck
              </Link>
            </div>
          )}
        </div>
      </section>

      {recentGames.length > 0 && (
        <section className="related">
          <h2>Recent games</h2>
          <ul className="game-list wide">
            {recentGames.map((g) => (
              <li key={g.id}>
                <span className={`legal ${g.won ? "yes" : "no"}`}>{g.won ? "Won" : "Lost"}</span>
                <span>
                  vs{" "}
                  {g.opponentAvatar ? <Link to={`/trainer/${g.opponent}`}>{g.opponent}</Link> : g.opponent} with {g.deckName}
                </span>
                <span className="game-meta">
                  {g.turns} turns · {g.endReason} · {timeAgo(g.finishedAt)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="related">
        <h2>{isMe ? "Your decks" : "Decks"}</h2>
        {decks.length ? (
          <div className="deck-grid">
            {decks.map((d) => (
              <DeckTile key={d.id} deck={d} to={isMe ? `/decks/${d.id}/edit` : `/decks/${d.id}`} />
            ))}
          </div>
        ) : (
          <p className="muted">{isMe ? "You haven't built any decks yet." : `${trainer.trainerName} hasn't shared any decks yet.`}</p>
        )}
      </section>
    </div>
  );
}
