import { useEffect, useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate } from "react-router";
import { send } from "../lib/api";
import { useAuth } from "../lib/auth";
import { PokemonPicker } from "../components/PokemonPicker";
import { Loading } from "../components/ui";

function Status({ error, saved }: { error: string | null; saved: string | null }) {
  if (error) return <p className="form-error" role="alert">{error}</p>;
  if (saved) return <p className="form-ok" role="status">{saved}</p>;
  return null;
}

export function SettingsPage() {
  const { user, ready, refresh, logout } = useAuth();
  const navigate = useNavigate();

  const [trainerName, setTrainerName] = useState("");
  const [bio, setBio] = useState("");
  const [country, setCountry] = useState("");
  const [avatarDex, setAvatarDex] = useState<number | null>(25);
  const [favouriteDex, setFavouriteDex] = useState<number | null>(null);
  const [profileMsg, setProfileMsg] = useState<{ error: string | null; saved: string | null }>({ error: null, saved: null });

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [passwordMsg, setPasswordMsg] = useState<{ error: string | null; saved: string | null }>({ error: null, saved: null });

  const [deletePassword, setDeletePassword] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    setTrainerName(user.trainerName);
    setBio(user.bio);
    setCountry(user.country);
    setAvatarDex(user.avatarDex);
    setFavouriteDex(user.favouriteDex);
  }, [user]);

  if (!ready) return <Loading />;
  if (!user) return <Navigate to="/login?next=/me/settings" replace />;

  const saveProfile = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await send("PUT", "/api/me", { trainerName, bio, country, avatarDex, favouriteDex });
      await refresh();
      setProfileMsg({ error: null, saved: "Profile saved." });
    } catch (err) {
      setProfileMsg({ error: (err as Error).message, saved: null });
    }
  };

  const changePassword = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await send("PUT", "/api/me/password", { currentPassword, newPassword });
      setCurrentPassword("");
      setNewPassword("");
      setPasswordMsg({ error: null, saved: "Password changed. Other devices have been logged out." });
    } catch (err) {
      setPasswordMsg({ error: (err as Error).message, saved: null });
    }
  };

  const deleteAccount = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await send("DELETE", "/api/me", { password: deletePassword });
      await logout();
      navigate("/", { replace: true });
    } catch (err) {
      setDeleteError((err as Error).message);
    }
  };

  return (
    <div className="settings">
      <div className="page-head">
        <h1>Settings</h1>
        <Link to={`/trainer/${user.trainerName}`}>View your profile</Link>
      </div>

      <form className="panel settings-section" onSubmit={saveProfile}>
        <h2>Profile</h2>
        <div className="form-grid">
          <label>
            <span>Trainer name</span>
            <input id="s-trainer" value={trainerName} onChange={(e) => setTrainerName(e.target.value)} required />
          </label>
          <label>
            <span>Country or region</span>
            <input id="s-country" value={country} maxLength={60} onChange={(e) => setCountry(e.target.value)} placeholder="e.g. Australia" />
          </label>
        </div>
        <label>
          <span>About you</span>
          <textarea id="s-bio" value={bio} maxLength={300} rows={3} onChange={(e) => setBio(e.target.value)} placeholder="Favourite deck, favourite set, how long you've played…" />
          <small className="muted">{300 - bio.length} characters left</small>
        </label>
        <div className="form-grid">
          <div className="field">
            <span className="field-label">Avatar</span>
            <PokemonPicker id="s-avatar" value={avatarDex} onChange={setAvatarDex} />
          </div>
          <div className="field">
            <span className="field-label">Favourite Pokémon</span>
            <PokemonPicker id="s-favourite" value={favouriteDex} onChange={setFavouriteDex} allowNone />
          </div>
        </div>
        <Status {...profileMsg} />
        <button type="submit">Save profile</button>
      </form>

      <form className="panel settings-section" onSubmit={changePassword}>
        <h2>Password</h2>
        <p className="muted small">Signed in as {user.email}</p>
        <div className="form-grid">
          <label>
            <span>Current password</span>
            <input id="s-current" type="password" autoComplete="current-password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} required />
          </label>
          <label>
            <span>New password</span>
            <input id="s-new" type="password" autoComplete="new-password" minLength={8} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required />
          </label>
        </div>
        <Status {...passwordMsg} />
        <button type="submit">Change password</button>
      </form>

      <form className="panel settings-section danger-zone" onSubmit={deleteAccount}>
        <h2>Delete account</h2>
        <p className="muted">This permanently deletes your profile and all your decks. It can't be undone.</p>
        {!confirmDelete ? (
          <button type="button" className="danger-btn" onClick={() => setConfirmDelete(true)}>
            Delete my account
          </button>
        ) : (
          <>
            <label>
              <span>Enter your password to confirm</span>
              <input id="s-delete" type="password" autoComplete="current-password" value={deletePassword} onChange={(e) => setDeletePassword(e.target.value)} required />
            </label>
            {deleteError && <p className="form-error" role="alert">{deleteError}</p>}
            <div className="row-actions">
              <button type="submit" className="danger-btn">
                Permanently delete account
              </button>
              <button type="button" className="secondary-btn" onClick={() => setConfirmDelete(false)}>
                Keep my account
              </button>
            </div>
          </>
        )}
      </form>
    </div>
  );
}
