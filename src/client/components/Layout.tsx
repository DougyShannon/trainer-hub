import { useEffect } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router";

export function Layout() {
  const { pathname } = useLocation();
  useEffect(() => window.scrollTo(0, 0), [pathname]);

  return (
    <div className="shell">
      <header className="site-header">
        <div className="site-header-inner">
          <Link to="/" className="logo">
            <img src="/favicon.svg" alt="" width={26} height={26} />
            Trainer Hub
          </Link>
          <nav className="site-nav" aria-label="Main">
            <NavLink to="/cards">Cards</NavLink>
            <NavLink to="/pokedex">Pokédex</NavLink>
            <span className="nav-soon" title="Coming in a later step">Decks</span>
            <span className="nav-soon" title="Coming in a later step">Play</span>
          </nav>
        </div>
      </header>
      <main className="site-main">
        <Outlet />
      </main>
      <footer className="site-footer">
        <p>
          Trainer Hub is an unofficial fan site. Pokémon and all related names and images are trademarks of Nintendo,
          Creatures Inc., GAME FREAK and The Pokémon Company. Not affiliated with or endorsed by them.
        </p>
        <p>
          Card data from <a href="https://pokemontcg.io/">pokemontcg.io</a>. Pokémon data and sprites from{" "}
          <a href="https://pokeapi.co/">PokeAPI</a>.
        </p>
      </footer>
    </div>
  );
}
