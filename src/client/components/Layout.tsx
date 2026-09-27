import { useEffect, useRef, useState } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router";
import { useAuth } from "../lib/auth";
import { sprite } from "../lib/sprites";

function AccountMenu() {
  const { user, ready, logout } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [open]);

  if (!ready) return <div className="account" />;
  if (!user) {
    const next = encodeURIComponent(pathname === "/login" || pathname === "/signup" ? "/decks" : pathname);
    return (
      <div className="account">
        <Link to={`/login?next=${next}`} className="nav-link">
          Log in
        </Link>
        <Link to={`/signup?next=${next}`} className="primary-btn small">
          Sign up
        </Link>
      </div>
    );
  }
  return (
    <div className="account" ref={ref}>
      <button type="button" className="account-btn" aria-expanded={open} aria-haspopup="menu" onClick={() => setOpen(!open)}>
        <img src={sprite(user.avatarDex)} alt="" width={36} height={36} />
        <span>{user.trainerName}</span>
      </button>
      {open && (
        <div className="account-menu" role="menu">
          <Link role="menuitem" to={`/trainer/${user.trainerName}`}>
            My profile
          </Link>
          <Link role="menuitem" to="/decks">
            My decks
          </Link>
          <Link role="menuitem" to="/me/settings">
            Settings
          </Link>
          <button
            type="button"
            role="menuitem"
            onClick={async () => {
              await logout();
              navigate("/");
            }}
          >
            Log out
          </button>
        </div>
      )}
    </div>
  );
}

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
            <NavLink to="/decks">Decks</NavLink>
            <span className="nav-soon" title="Coming in a later step">Play</span>
          </nav>
          <AccountMenu />
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
