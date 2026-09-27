import { useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router";
import { send } from "../lib/api";
import { useAuth } from "../lib/auth";
import { sprite } from "../lib/sprites";

// Starter Pokémon (plus Pikachu and Eevee) offered as a first avatar.
const STARTERS = [25, 133, 1, 4, 7, 152, 155, 158, 252, 255, 258, 387, 390, 393, 495, 498, 501, 650, 653, 656, 722, 725, 728, 810, 813, 816, 906, 909, 912];

function useNext() {
  const [params] = useSearchParams();
  const next = params.get("next") ?? "";
  // Only follow links back into this site.
  return next.startsWith("/") && !next.startsWith("//") ? next : "/decks";
}

export function LoginPage() {
  const { user, refresh } = useAuth();
  const navigate = useNavigate();
  const next = useNext();
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to={next} replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await send("POST", "/api/auth/login", { login, password });
      await refresh();
      navigate(next, { replace: true });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-page">
      <form className="auth-card" onSubmit={submit}>
        <h1>Welcome back, Trainer</h1>
        <label>
          <span>Email or trainer name</span>
          <input id="login" autoComplete="username" value={login} onChange={(e) => setLogin(e.target.value)} required />
        </label>
        <label>
          <span>Password</span>
          <input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>
        {error && <p className="form-error" role="alert">{error}</p>}
        <button type="submit" disabled={busy}>
          {busy ? "Logging in…" : "Log in"}
        </button>
        <p className="muted small">
          New here? <Link to={`/signup?next=${encodeURIComponent(next)}`}>Create an account</Link>
        </p>
      </form>
    </div>
  );
}

export function SignupPage() {
  const { user, refresh } = useAuth();
  const navigate = useNavigate();
  const next = useNext();
  const [trainerName, setTrainerName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [avatarDex, setAvatarDex] = useState(25);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to={next} replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await send("POST", "/api/auth/signup", { trainerName, email, password, avatarDex });
      await refresh();
      navigate(next, { replace: true });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-page">
      <form className="auth-card" onSubmit={submit}>
        <h1>Become a Trainer</h1>
        <p className="muted">Save your decks, show off your favourite Pokémon, and soon, battle other players.</p>
        <label>
          <span>Trainer name</span>
          <input
            id="trainer-name"
            autoComplete="nickname"
            value={trainerName}
            onChange={(e) => setTrainerName(e.target.value)}
            pattern="[A-Za-z0-9_\-]{3,20}"
            title="3 to 20 characters: letters, numbers, - and _"
            required
          />
          <small className="muted">3 to 20 letters, numbers, - or _. Other players will see this.</small>
        </label>
        <label>
          <span>Email</span>
          <input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label>
          <span>Password</span>
          <input id="new-password" type="password" autoComplete="new-password" minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} required />
          <small className="muted">At least 8 characters.</small>
        </label>
        <fieldset className="starter-pick">
          <legend>Choose your partner Pokémon</legend>
          <div className="starter-grid">
            {STARTERS.map((dex) => (
              <button
                key={dex}
                type="button"
                className={dex === avatarDex ? "active" : ""}
                aria-pressed={dex === avatarDex}
                onClick={() => setAvatarDex(dex)}
              >
                <img src={sprite(dex)} alt={`Pokémon #${dex}`} width={56} height={56} />
              </button>
            ))}
          </div>
          <small className="muted">You can pick any Pokémon later in Settings.</small>
        </fieldset>
        {error && <p className="form-error" role="alert">{error}</p>}
        <button type="submit" disabled={busy}>
          {busy ? "Creating your account…" : "Create account"}
        </button>
        <p className="muted small">
          Already have an account? <Link to={`/login?next=${encodeURIComponent(next)}`}>Log in</Link>
        </p>
      </form>
    </div>
  );
}
