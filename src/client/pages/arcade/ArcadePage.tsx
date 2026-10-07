import { Link } from "react-router";
import { useBest } from "../../lib/best";
import { PageLogo } from "../../components/ui";
import { artwork } from "../../lib/sprites";

export function ArcadePage() {
  const [whoBest] = useBest("whos-that-pokemon");
  const [quizBest] = useBest("type-quiz");
  return (
    <div className="arcade">
      <div className="page-head">
        <div>
          <h1 className="with-logo">
            <PageLogo />
            Arcade
          </h1>
          <p className="muted">Quick games to play between matches. No account needed.</p>
        </div>
      </div>
      <div className="arcade-grid">
        <Link to="/arcade/whos-that-pokemon" className="arcade-tile">
          <span className="arcade-art silhouette">
            <img src={artwork(25)} alt="" width={200} height={200} />
          </span>
          <span className="arcade-body">
            <strong>Who's That Pokémon?</strong>
            <span>Name the Pokémon from its silhouette, then hear its cry. Pick a generation or try every one.</span>
            {whoBest > 0 && <span className="arcade-best">Your best streak: {whoBest}</span>}
          </span>
        </Link>
        <Link to="/arcade/type-quiz" className="arcade-tile">
          <span className="arcade-art quiz">
            <span className="type-badge t-fire">Fire</span>
            <span className="arcade-vs">vs</span>
            <span className="type-badge t-grass">Grass</span>
          </span>
          <span className="arcade-body">
            <strong>Type Matchup Quiz</strong>
            <span>Ten questions on which moves are super effective, including dual types for 4× and ¼× damage.</span>
            {quizBest > 0 && <span className="arcade-best">Your best: {quizBest}/10</span>}
          </span>
        </Link>
      </div>
    </div>
  );
}
