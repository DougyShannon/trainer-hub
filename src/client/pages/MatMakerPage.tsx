import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from "react";
import { Link } from "react-router";
import { MATS, STANDARD_LAYOUT, layoutOf, type MatLayout, type Spot } from "../boards/library";

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
const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "my-mat";
const spotText = ([x, y]: Spot) => `[${x}, ${y}]`;

function withSpot(l: MatLayout, k: SpotKey, s: Spot): MatLayout {
  if (k.part === "bench" || k.part === "prizes") {
    const list = [...l[k.part]] as Spot[];
    list[k.index] = s;
    return { ...l, [k.part]: list };
  }
  return { ...l, [k.part]: s };
}

/** The line to paste into src/client/boards/library.ts for this mat. */
function entryCode(name: string, file: string, aspect: number, layout: MatLayout) {
  const id = slug(name);
  const base = `{ id: "${id}", name: "${name.replace(/"/g, "'") || "My mat"}", image: "/art/mats/${file}", aspect: ${aspect.toFixed(3)}`;
  if (JSON.stringify(layout) === JSON.stringify(STANDARD_LAYOUT)) return `  ${base} },`;
  return [
    `  ${base},`,
    `    layout: {`,
    `      card: ${layout.card},`,
    `      active: ${spotText(layout.active)}, stadium: ${spotText(layout.stadium)}, deck: ${spotText(layout.deck)}, discard: ${spotText(layout.discard)},`,
    `      lostZone: ${spotText(layout.lostZone)}, tag: ${spotText(layout.tag)},`,
    `      bench: [${layout.bench.map(spotText).join(", ")}],`,
    `      prizes: [${layout.prizes.map(spotText).join(", ")}],`,
    `    },`,
    `  },`,
  ].join("\n");
}

/** Line up the card spots on a new play mat picture and get the line that adds it to the site. */
export function MatMakerPage() {
  const [src, setSrc] = useState(MATS[0].image);
  const [file, setFile] = useState("my-mat.webp");
  const [name, setName] = useState("My mat");
  const [aspect, setAspect] = useState(MATS[0].aspect);
  const [layout, setLayout] = useState<MatLayout>(layoutOf(MATS[0]));
  const [dragging, setDragging] = useState<SpotKey | null>(null);
  const [copied, setCopied] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const local = useRef<string | null>(null);

  useEffect(() => () => void (local.current && URL.revokeObjectURL(local.current)), []);

  const pick = (url: string) => {
    setSrc(url);
    setCopied(false);
  };

  const fromComputer = (f: File | undefined) => {
    if (!f) return;
    if (local.current) URL.revokeObjectURL(local.current);
    local.current = URL.createObjectURL(f);
    pick(local.current);
    setFile(f.name.toLowerCase().replace(/\s+/g, "-"));
    setName(f.name.replace(/\.[a-z0-9]+$/i, "").replace(/[-_]+/g, " ").replace(/^\w/, (c) => c.toUpperCase()));
    setLayout(STANDARD_LAYOUT);
  };

  const move = (e: PointerEvent, key: SpotKey) => {
    const rect = box.current?.getBoundingClientRect();
    if (!rect) return;
    const x = round(Math.min(100, Math.max(0, ((e.clientX - rect.left) / rect.width) * 100)));
    const y = round(Math.min(100, Math.max(0, ((e.clientY - rect.top) / rect.height) * 100)));
    setLayout((l) => withSpot(l, key, [x, y]));
    setCopied(false);
  };

  const code = entryCode(name, file, aspect, layout);
  const cardH = (layout.card * aspect * 342) / 245;

  return (
    <div className="mat-maker">
      <div className="page-head">
        <div>
          <h1>Add a board</h1>
          <p className="muted">
            Line up the card spots on a new play mat picture. The site puts each card in the middle of its box, so drag
            every box onto the matching spot printed on the mat.
          </p>
        </div>
        <Link to="/play" className="secondary-btn">
          Back to Play
        </Link>
      </div>

      <section className="panel">
        <h2>1. Pick the picture</h2>
        <p className="muted small">
          A half mat is one player's side, wider than it is tall, with the Active spot at the top. Try one from your
          computer first (it stays on your computer), or start from one of the site's mats.
        </p>
        <div className="maker-row">
          <label className="secondary-btn small">
            Choose a picture…
            <input type="file" accept="image/*" hidden onChange={(e) => fromComputer(e.target.files?.[0])} />
          </label>
          {MATS.map((m) => (
            <button
              key={m.id}
              type="button"
              className="chip-btn"
              onClick={() => {
                pick(m.image);
                setLayout(layoutOf(m));
                setName(m.name);
                setFile(m.image.split("/").pop()!);
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
            <input
              type="range"
              min={5}
              max={16}
              step={0.1}
              value={layout.card}
              onChange={(e) => {
                setLayout({ ...layout, card: Number(e.target.value) });
                setCopied(false);
              }}
            />{" "}
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
        <h2>3. Add it to the site</h2>
        <div className="maker-row">
          <label className="small">
            Name{" "}
            <input value={name} maxLength={30} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="small">
            File name in public/art/mats{" "}
            <input value={file} maxLength={60} onChange={(e) => setFile(e.target.value.trim())} />
          </label>
        </div>
        <p className="muted small">
          Upload the picture to <code>public/art/mats</code> on GitHub with this file name, then paste this line into{" "}
          <code>src/client/boards/library.ts</code> just above <code>// Add new half mats here</code>. The guide
          "Adding game boards" walks through every click.
        </p>
        <pre className="maker-code">{code}</pre>
        <button
          type="button"
          className="primary-btn small"
          onClick={() =>
            navigator.clipboard
              ?.writeText(code)
              .then(() => setCopied(true))
              .catch(() => setCopied(false))
          }
        >
          {copied ? "Copied" : "Copy the line"}
        </button>
      </section>
    </div>
  );
}
