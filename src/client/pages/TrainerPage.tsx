import { Link, useParams } from "react-router";
import { useApi, type DeckSummary, type PokemonSummary, type Trainer } from "../lib/api";
import { artwork, sprite } from "../lib/sprites";
import { DeckTile } from "../components/DeckTile";
import { ErrorBox, Loading } from "../components/ui";
import { NotFoundPage } from "./NotFoundPage";

type Profile = { trainer: Trainer; isMe: boolean; decks: (DeckSummary & { coverImage?: string | null })[] };

export function TrainerPage() {
  const { name } = useParams();
  const { data, error, loading } = useApi<Profile>(`/api/trainers/${name}`, { fresh: true });
  const pokemon = useApi<PokemonSummary[]>("/api/pokemon");

  if (loading && !data) return <Loading label="Loading trainer" />;
  if (error === "Trainer not found") return <NotFoundPage what="trainer" />;
  if (error || !data) return <ErrorBox message={error ?? "Unknown error"} />;

  const { trainer, isMe, decks } = data;
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
              <dd>Coming soon</dd>
            </div>
          </dl>
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
