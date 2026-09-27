import { Link } from "react-router";

export function NotFoundPage({ what = "page" }: { what?: string }) {
  return (
    <div className="empty-state">
      <h1>We couldn't find that {what}</h1>
      <p>
        Try the <Link to="/cards">card search</Link> or the <Link to="/pokedex">Pokédex</Link>.
      </p>
    </div>
  );
}
