import { useEffect, useRef, useState } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router";
import { useAuth } from "../lib/auth";
import { sprite } from "../lib/sprites";
import { getTheme, setTheme, type Theme } from "../lib/theme";
import { Assistant } from "./Assistant";
import { ErrorBoundary } from "./ErrorBoundary";

function ThemePicker() {
  const [theme, setLocal] = useState<Theme>(getTheme);
  useEffect(() => {
    const sync = () => setLocal(getTheme());
    window.addEventListener("trainer-hub:theme", sync);
    return () => window.removeEventListener("trainer-hub:theme", sync);
  }, []);
  return (
    <label className="theme-picker">
      Theme{" "}
      <select value={theme} onChange={(e) => setTheme(e.target.value as Theme)}>
        <option value="system">Match my device</option>
        <option value="light">Light</option>
        <option value="dark">Dark</option>
      </select>
    </label>
  );
}

function AccountMenu() {
  const { user, ready, logout } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);
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
  // Braces matter: newer Chrome makes scrollTo return a Promise, and React would treat a
  // returned value as a clean-up function and crash on the next page change.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);

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
            <NavLink to="/play">Play</NavLink>
            <NavLink to="/arcade">Arcade</NavLink>
          </nav>
          <AccountMenu />
        </div>
      </header>
      <main className="site-main">
        <ErrorBoundary resetKey={pathname}>
          <Outlet />
        </ErrorBoundary>
      </main>
      <ErrorBoundary quiet>
        <Assistant />
      </ErrorBoundary>
      <footer className="site-footer">
        <p>
          Trainer Hub is an unofficial fan site. Pokémon and all related names and images are trademarks of Nintendo,
          Creatures Inc., GAME FREAK and The Pokémon Company. Not affiliated with or endorsed by them.
        </p>
        <p>
          Card data from <a href="https://pokemontcg.io/">pokemontcg.io</a>. Pokémon data and sprites from{" "}
          <a href="https://pokeapi.co/">PokeAPI</a>.
        </p>
        <ThemePicker />
      </footer>
    </div>
  );
}
