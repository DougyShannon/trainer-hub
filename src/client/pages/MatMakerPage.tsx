import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from "react";
import { Link, useNavigate } from "react-router";
import { MATS, STANDARD_LAYOUT, layoutOf, loadUploadedBoards, type MatLayout, type Spot } from "../boards/library";
import { setBoardPrefs, useBoardPrefs } from "../boards/prefs";
import { send } from "../lib/api";
import { useAuth } from "../lib/auth";

type SpotKey = { part: "active" | "stadium" | "deck" | "discard" | "lostZone" | "tag" } | { part: "bench" | "prizes"; index: number };

const SPOTS: { key: SpotKey; label: string }[] = [
  { key: { part: "active" }, label: "Active" },
  { key: { part: "stadium" }, label: "Stadium" },
  { key: { part: "deck" }, label: "Deck" },
  { key: { part: "discard" }, label: "Discard" },
  { key: { part: "lostZone" }, label: "Lost Zone" },
  ...[0, 1, 2, 3, 4].map((i) => ({ key: { part: "bench" as const, index: i }, label: `Bench ${i + 1}` })),
  ...[0, 1, 2, 3, 4, 5].map((i) => ({ key: { part: "prizes" as const, index: i }, label: `Prize ${i + 1}` })),
  { key: { part: "tag" }, label: "Name" },
];

const round = (n: number) => Math.round(n * 2) / 2;
const spotOf = (l: MatLayout, k: SpotKey): Spot => ("index" in k ? l[k.part][k.index] : l[k.part]);

function withSpot(l: MatLayout, k: SpotKey, s: Spot): MatLayout {
  if (k.part === "bench" || k.part === "prizes") {
    const list = [...l[k.part]] as Spot[];
    list[k.index] = s;
    return { ...l, [k.part]: list };
  }
  return { ...l, [k.part]: s };
}

/**
 * Shrinks a picture to at most `width` pixels wide and returns it as a data URL, as WebP where the
 * browser can make one (Safari can't, so JPEG there).
 */
async function shrink(url: string, width: number, quality: number): Promise<string> {
  const img = new Image();
  img.src = url;
  await img.decode();
  const scale = Math.min(1, width / img.naturalWidth);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(img.naturalWidth * scale);
  canvas.height = Math.round(img.naturalHeight * scale);
  canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
  const webp = canvas.toDataURL("image/webp", quality);
  return webp.startsWith("data:image/webp") ? webp : canvas.toDataURL("image/jpeg", quality);
}

/** The picture and a small copy, small enough for the site to keep (under 1.5 MB). */
async function pictures(url: string) {
  let image = await shrink(url, 1600, 0.85);
  if (image.length > 1_900_000) image = await shrink(url, 1200, 0.75);
  if (image.length > 1_900_000) image = await shrink(url, 1000, 0.6);
  const thumb = await shrink(url, 360, 0.75);
  return { image, thumb };
}

/** Line up the card spots on a new play mat picture, then upload it so everyone can use it. */
export function MatMakerPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  useBoardPrefs(); // draw again when the uploaded mats load or change
  const [src, setSrc] = useState(MATS[0].image);
  const [own, setOwn] = useState(false);
  const [name, setName] = useState("My mat");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ id: string; name: string } | null>(null);
  const [aspect, setAspect] = useState(MATS[0].aspect);
  const [layout, setLayout] = useState<MatLayout>(layoutOf(MATS[0]));
  const [dragging, setDragging] = useState<SpotKey | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const local = useRef<string | null>(null);

  useEffect(() => () => void (local.current && URL.revokeObjectURL(local.current)), []);

  const pick = (url: string, mine: boolean) => {
    setSrc(url);
    setOwn(mine);
    setDone(null);
    setError(null);
  };

  const fromComputer = (f: File | undefined) => {
    if (!f) return;
    if (local.current) URL.revokeObjectURL(local.current);
    local.current = URL.createObjectURL(f);
    pick(local.current, true);
    setName(
      f.name
        .replace(/\.[a-z0-9]+$/i, "")
        .replace(/[-_]+/g, " ")
        .replace(/^\w/, (c) => c.toUpperCase()),
    );
    setLayout(STANDARD_LAYOUT);
  };

  const move = (e: PointerEvent, key: SpotKey) => {
    const rect = box.current?.getBoundingClientRect();
    if (!rect) return;
    const x = round(Math.min(100, Math.max(0, ((e.clientX - rect.left) / rect.width) * 100)));
    const y = round(Math.min(100, Math.max(0, ((e.clientY - rect.top) / rect.height) * 100)));
    setLayout((l) => withSpot(l, key, [x, y]));
  };

  const upload = async () => {
    setBusy(true);
    setError(null);
    try {
      const { image, thumb } = await pictures(src);
      const { id } = await send<{ id: string }>("POST", "/api/boards", { name: name.trim(), aspect, layout, image, thumb });
      await loadUploadedBoards();
      setDone({ id, name: name.trim() });
    } catch (e) {
      setError(e instanceof Error ? e.message : "The upload didn't work. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string, label: string) => {
    if (!window.confirm(`Remove "${label}" from the site for everyone?`)) return;
    try {
      await send("DELETE", `/api/boards/${id}`);
      await loadUploadedBoards();
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "That didn't work. Please try again.");
    }
  };

  const uploaded = MATS.filter((m) => m.uploaded);
  const cardH = (layout.card * aspect * 342) / 245;

  return (
    <div className="mat-maker">
      <div className="page-head">
        <div>
          <h1>Add a board</h1>
          <p className="muted">
            Add your own play mat in three steps: choose a picture, drag the boxes onto the card spots, then press Upload. Everyone on the site can then pick it
            as their mat.
          </p>
        </div>
        <Link to="/play" className="secondary-btn">
          Back to Play
        </Link>
      </div>

      <section className="panel">
        <h2>1. Pick the picture</h2>
        <p className="muted small">
          A play mat is one player's side, wider than it is tall, with the Active spot at the top. Choose a picture from your computer or phone. The site's own
          mats below are just for a look at how the boxes line up.
        </p>
        <div className="maker-row">
          <label className="secondary-btn small">
            Choose a picture…
            <input type="file" accept="image/*" hidden onChange={(e) => fromComputer(e.target.files?.[0])} />
          </label>
          {MATS.filter((m) => !m.uploaded).map((m) => (
            <button
              key={m.id}
              type="button"
              className="chip-btn"
              onClick={() => {
                pick(m.image, false);
                setLayout(layoutOf(m));
                setName(m.name);
              }}
            >
              {m.name}
            </button>
          ))}
        </div>
      </section>

      <section className="panel">
        <h2>2. Drag the boxes onto the card spots</h2>
        <div className="maker-row">
          <label className="small">
            Card size{" "}
            <input type="range" min={5} max={16} step={0.1} value={layout.card} onChange={(e) => setLayout({ ...layout, card: Number(e.target.value) })} />{" "}
            {layout.card}%
          </label>
          <button type="button" className="secondary-btn small" onClick={() => setLayout(STANDARD_LAYOUT)}>
            Start from the usual layout
          </button>
        </div>
        <div ref={box} className="maker-mat" style={{ aspectRatio: String(aspect) }}>
          <img
            src={src}
            alt="The mat you're lining up"
            draggable={false}
            onLoad={(e) => {
              const img = e.currentTarget;
              if (img.naturalHeight) setAspect(Math.round((img.naturalWidth / img.naturalHeight) * 1000) / 1000);
            }}
          />
          {SPOTS.map(({ key, label }) => {
            const [x, y] = spotOf(layout, key);
            const tag = key.part === "tag";
            const style = {
              left: `${x}%`,
              top: `${y}%`,
              width: tag ? `${layout.card * 2.4}%` : `${key.part === "lostZone" ? layout.card * 0.7 : layout.card}%`,
              height: tag ? `${cardH * 0.4}%` : `${key.part === "lostZone" ? cardH * 0.7 : cardH}%`,
            } as CSSProperties;
            const on = dragging && dragging.part === key.part && ("index" in dragging ? "index" in key && dragging.index === key.index : true);
            return (
              <div
                key={label}
                className={`maker-spot${tag ? " tag" : ""}${on ? " on" : ""}`}
                style={style}
                onPointerDown={(e) => {
                  e.currentTarget.setPointerCapture(e.pointerId);
                  setDragging(key);
                }}
                onPointerMove={(e) => on && move(e, key)}
                onPointerUp={() => setDragging(null)}
                onPointerCancel={() => setDragging(null)}
              >
                {label}
              </div>
            );
          })}
        </div>
      </section>

      <section className="panel">
        <h2>3. Upload it</h2>
        {done ? (
          <>
            <p>
              <strong>{done.name}</strong> is on the site. Anyone can now pick it under "Two half mats" on the Play page.
            </p>
            <div className="maker-row">
              <button
                type="button"
                className="primary-btn small"
                onClick={() => {
                  setBoardPrefs({ layout: "mats", mat: done.id });
                  navigate("/play");
                }}
              >
                Use it as my mat
              </button>
              <button type="button" className="secondary-btn small" onClick={() => setDone(null)}>
                Add another
              </button>
            </div>
          </>
        ) : !user ? (
          <p className="small">
            <Link to="/login">Log in</Link> to upload your board.
          </p>
        ) : !own ? (
          <p className="small muted">Choose your own picture in step 1 first.</p>
        ) : (
          <>
            <div className="maker-row">
              <label className="small">
                Name <input value={name} maxLength={30} onChange={(e) => setName(e.target.value)} />
              </label>
              <button type="button" className="primary-btn" disabled={busy || !name.trim()} onClick={upload}>
                {busy ? "Uploading…" : "Upload"}
              </button>
            </div>
            {error && <p className="error-box small">{error}</p>}
          </>
        )}
      </section>

      {uploaded.length > 0 && (
        <section className="panel">
          <h2>Boards players have added</h2>
          <div className="mat-grid">
            {uploaded.map((m) => (
              <div key={m.id} className="mat-pick">
                <img src={m.thumb ?? m.image} alt="" loading="lazy" style={{ aspectRatio: String(m.aspect) }} />
                <span>
                  {m.name} <span className="muted">by {m.uploaded!.by}</span>
                </span>
                {m.uploaded!.mine && (
                  <button type="button" className="secondary-btn small" onClick={() => remove(m.id, m.name)}>
                    Remove
                  </button>
                )}
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
