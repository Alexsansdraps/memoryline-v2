/// <reference lib="dom" />
import { createSignal, For, Match, onCleanup, onMount, Show, Switch, type JSX } from "solid-js";
import { Portal } from "solid-js/web";
import {
  DIMENSIONS_FORMAT,
  dimensionsFormat,
  POSTER_FORMATS,
  type PosterFormat,
} from "@memoryline/types";
import type { MessagesConfigurateur } from "../messages";

/**
 * L'affiche au mur (26/11, Alexandra : « 2 c bien »).
 *
 * La question qu'on se pose avant d'acheter n'est pas « A4 ou A3 » mais
 * « est-ce que ça rend bien chez moi ». Trois pièces dessinées À L'ÉCHELLE
 * — un salon, une chambre d'enfant, une entrée —, l'affiche telle qu'elle est
 * composée accrochée au-dessus du meuble, et un quatrième choix : la photo de
 * son propre mur.
 *
 * L'échelle est réelle : chaque pièce est dessinée en centimètres (le
 * viewBox EST en centimètres), et l'affiche y prend la largeur de son format,
 * cadre compris. Une A4 au-dessus d'une enfilade de 120 cm paraît petite
 * parce qu'elle l'est : c'est la réponse honnête, et c'est ce qui fait choisir
 * l'A3 ou un cadre en connaissance de cause.
 *
 * La photo du mur ne quitte pas l'appareil : elle est lue sur place
 * (URL.createObjectURL), jamais envoyée. On y place l'affiche du doigt et on
 * règle sa taille — l'échelle d'une photo, on ne peut pas la deviner.
 *
 * Rien n'est enregistré : c'est un aperçu. Seul le format peut changer d'ici,
 * par la même fonction que l'étape « Format ».
 */

/** Largeur ajoutée par un cadre de chaque côté, en centimètres. */
const BAGUETTE_CM = 3;

interface Piece {
  id: "salon" | "chambre" | "entree";
  /** Largeur et hauteur du pan de mur montré, en centimètres. */
  l: number;
  h: number;
  /** Centre de l'affiche et bas de l'affiche (cadre compris), en cm. */
  x: number;
  bas: number;
  /** Largeur du meuble, dite sous l'image pour donner l'échelle. */
  meuble: number;
  dessin: () => JSX.Element;
}

/** Un léger jour venu d'en haut à gauche, commun aux trois pièces. */
function Lumiere(props: { id: string; l: number; h: number }) {
  return (
    <>
      <defs>
        <radialGradient id={`ml-mur-jour-${props.id}`} cx="0.25" cy="0.1" r="0.9">
          <stop offset="0" stop-color="#ffffff" stop-opacity="0.35" />
          <stop offset="1" stop-color="#000000" stop-opacity="0.08" />
        </radialGradient>
      </defs>
      <rect x="0" y="0" width={props.l} height={props.h} fill={`url(#ml-mur-jour-${props.id})`} />
    </>
  );
}

const PIECES: Piece[] = [
  {
    id: "salon",
    l: 190,
    h: 170,
    x: 95,
    bas: 68,
    meuble: 120,
    dessin: () => (
      <>
        <rect x="0" y="0" width="190" height="150" fill="#e8e2d8" />
        {/* Parquet */}
        <rect x="0" y="150" width="190" height="20" fill="#b48a62" />
        <For each={[157, 163]}>
          {(y) => <line x1="0" x2="190" y1={y} y2={y} stroke="#000" stroke-opacity="0.07" stroke-width="0.4" />}
        </For>
        <For each={[22, 61, 104, 143, 176]}>
          {(x) => <line x1={x} x2={x - 3} y1="150" y2="170" stroke="#000" stroke-opacity="0.06" stroke-width="0.4" />}
        </For>
        <rect x="0" y="146" width="190" height="4" fill="#f3efe8" />
        {/* Ombre de l'enfilade au sol */}
        <ellipse cx="95" cy="151" rx="66" ry="2.4" fill="#000" fill-opacity="0.16" />
        {/* Enfilade de 120 cm */}
        <rect x="35" y="90" width="120" height="48" rx="1.2" fill="#8b6a4e" />
        <rect x="35" y="90" width="120" height="2.2" fill="#a07e60" />
        <For each={[75, 115]}>
          {(x) => <line x1={x} x2={x} y1="93" y2="137" stroke="#000" stroke-opacity="0.2" stroke-width="0.4" />}
        </For>
        <For each={[55, 95, 135]}>
          {(x) => <rect x={x - 3} y="112" width="6" height="0.9" rx="0.45" fill="#d9c3a5" />}
        </For>
        <For each={[40, 150]}>
          {(x) => <rect x={x - 1} y="138" width="2" height="12" fill="#5d4633" />}
        </For>
        {/* Lampe */}
        <rect x="44" y="72" width="2" height="18" fill="#6b6259" />
        <ellipse cx="45" cy="89.5" rx="6" ry="1.2" fill="#6b6259" />
        <path d="M34 72 L56 72 L52 58 L38 58 Z" fill="#d8c7ab" />
        <path d="M34 72 L56 72 L55 69 L35 69 Z" fill="#000" fill-opacity="0.08" />
        {/* Vase et branches */}
        <path d="M136 90 C131 88 131 80 134 76 L138 76 C141 80 141 88 136 90 Z" fill="#c9b9a6" />
        <path d="M136 77 C134 66 129 60 124 55 M136 77 C138 64 143 58 149 53 M136 77 C136 68 137 62 136 56" stroke="#6d5a46" stroke-width="0.5" fill="none" />
        <For each={[[124, 55], [127, 58], [149, 53], [146, 56], [136, 56], [133, 62], [140, 61]]}>
          {([cx, cy]) => <ellipse cx={cx} cy={cy} rx="1.6" ry="0.9" fill="#8a9a6e" />}
        </For>
        {/* Livres */}
        <rect x="100" y="86" width="16" height="2" fill="#7c8a96" />
        <rect x="101" y="84" width="14" height="2" fill="#c97b5d" />
        <rect x="102" y="82" width="12" height="2" fill="#e4d6bd" />
        <Lumiere id="salon" l={190} h={150} />
      </>
    ),
  },
  {
    id: "chambre",
    l: 170,
    h: 170,
    x: 85,
    bas: 62,
    meuble: 90,
    dessin: () => (
      <>
        <rect x="0" y="0" width="170" height="150" fill="#dfe4d9" />
        {/* Moquette */}
        <rect x="0" y="150" width="170" height="20" fill="#cfc6b8" />
        <rect x="0" y="147" width="170" height="3" fill="#f2f0ea" />
        {/* Tête de lit arrondie, 90 cm */}
        <path d="M40 150 L40 92 Q40 80 52 80 L118 80 Q130 80 130 92 L130 150 Z" fill="#c9a98a" />
        <path d="M44 150 L44 94 Q44 84 54 84 L116 84 Q126 84 126 94 L126 150 Z" fill="#d6b897" />
        {/* Oreiller, couette */}
        <rect x="52" y="103" width="66" height="13" rx="5" fill="#f7f4ee" />
        <path d="M36 118 Q85 112 134 118 L136 150 L34 150 Z" fill="#f0d9cf" />
        <path d="M36 118 Q85 112 134 118 L134 124 Q85 118 36 124 Z" fill="#fff" fill-opacity="0.5" />
        <For each={[60, 85, 110]}>
          {(x) => <line x1={x} x2={x + 1} y1="124" y2="150" stroke="#000" stroke-opacity="0.05" stroke-width="0.4" />}
        </For>
        <ellipse cx="85" cy="151" rx="54" ry="2" fill="#000" fill-opacity="0.12" />
        {/* Table de chevet et veilleuse */}
        <rect x="140" y="108" width="24" height="40" rx="1" fill="#eee7dc" />
        <rect x="140" y="108" width="24" height="1.8" fill="#fbf8f2" />
        <rect x="149" y="124" width="6" height="0.9" rx="0.45" fill="#b8a993" />
        <circle cx="152" cy="101" r="6" fill="#f6e3b4" />
        <rect x="149" y="106" width="6" height="2" fill="#c8b48c" />
        {/* Guirlande de fanions */}
        <path d="M8 22 Q30 34 52 24" stroke="#9a8f80" stroke-width="0.4" fill="none" />
        <For each={[[14, 25.5, "#e7b7a3"], [24, 28.5, "#a9c2b4"], [34, 29, "#efd7a0"], [44, 27, "#b8c4d8"]] as const}>
          {([x, y, c]) => <path d={`M${x - 3} ${y} L${x + 3} ${y} L${x} ${y + 6} Z`} fill={c} />}
        </For>
        <Lumiere id="chambre" l={170} h={150} />
      </>
    ),
  },
  {
    id: "entree",
    l: 150,
    h: 180,
    x: 75,
    bas: 58,
    meuble: 90,
    dessin: () => (
      <>
        <rect x="0" y="0" width="150" height="160" fill="#d3dadf" />
        {/* Carreaux */}
        <rect x="0" y="160" width="150" height="20" fill="#ece8e1" />
        <For each={[0, 1, 2, 3, 4, 5, 6]}>
          {(i) => <line x1={i * 25} x2={i * 25 - 6} y1="160" y2="180" stroke="#000" stroke-opacity="0.08" stroke-width="0.4" />}
        </For>
        <line x1="0" x2="150" y1="169" y2="169" stroke="#000" stroke-opacity="0.08" stroke-width="0.4" />
        <rect x="0" y="157" width="150" height="3" fill="#eef1f3" />
        <ellipse cx="75" cy="161" rx="48" ry="1.8" fill="#000" fill-opacity="0.14" />
        {/* Console de 90 cm, fine, avec une tablette basse */}
        <rect x="30" y="80" width="90" height="3.5" rx="0.6" fill="#3f3a35" />
        <For each={[33, 117]}>
          {(x) => <rect x={x - 0.9} y="83" width="1.8" height="77" fill="#3f3a35" />}
        </For>
        <rect x="32" y="138" width="86" height="2" fill="#3f3a35" />
        {/* Panier sur la tablette */}
        <path d="M44 138 L46 122 L72 122 L74 138 Z" fill="#c6a77d" />
        <For each={[126, 130, 134]}>
          {(y) => <line x1="45.5" x2="72.5" y1={y} y2={y} stroke="#8d7150" stroke-opacity="0.5" stroke-width="0.4" />}
        </For>
        {/* Coupe et plante */}
        <path d="M86 80 Q94 74 102 80 Z" fill="#e9e1d4" />
        <rect x="46" y="68" width="10" height="12" rx="1.5" fill="#f1ede6" />
        <path d="M51 68 C47 58 42 56 38 54 M51 68 C52 56 56 52 60 48 M51 68 C50 60 50 56 51 50" stroke="#5f7a55" stroke-width="0.7" fill="none" />
        <For each={[[38, 54], [41, 57], [60, 48], [57, 51], [51, 50], [50, 56]]}>
          {([cx, cy]) => <ellipse cx={cx} cy={cy} rx="2.2" ry="1.1" fill="#6f8b62" />}
        </For>
        {/* Patère */}
        <circle cx="136" cy="70" r="1.6" fill="#3f3a35" />
        <circle cx="144" cy="70" r="1.6" fill="#3f3a35" />
        <Lumiere id="entree" l={150} h={160} />
      </>
    ),
  },
];

export function ApercuAuMur(props: {
  format: PosterFormat;
  /** Un cadre est-il choisi ? Il ajoute sa baguette autour de l'affiche. */
  encadree: boolean;
  /** L'affiche telle qu'elle est composée (le même aperçu que la colonne). */
  affiche: () => JSX.Element;
  onFormat: (format: PosterFormat) => void;
  onClose: () => void;
  messages: MessagesConfigurateur;
}) {
  const m = () => props.messages;
  const [choix, setChoix] = createSignal<Piece["id"] | "photo">("salon");
  const piece = () => PIECES.find((p) => p.id === choix());

  /** Largeur et hauteur de l'affiche accrochée, cadre compris, en cm. */
  const tailleCm = () => {
    const d = DIMENSIONS_FORMAT[props.format] ?? DIMENSIONS_FORMAT.A4;
    const plus = props.encadree ? 2 * BAGUETTE_CM : 0;
    return { l: d.l / 10 + plus, h: d.h / 10 + plus };
  };

  // --- Photo du mur (reste sur l'appareil) ---
  const [photo, setPhoto] = createSignal<string | null>(null);
  const [rapportPhoto, setRapportPhoto] = createSignal(4 / 3);
  /** Centre de l'affiche sur la photo, en fractions ; largeur en fraction. */
  const [pos, setPos] = createSignal({ x: 0.5, y: 0.42 });
  const [largeurPhoto, setLargeurPhoto] = createSignal(0.26);
  let saisie: HTMLInputElement | undefined;
  let zonePhoto: HTMLDivElement | undefined;
  const liberer = () => {
    const u = photo();
    if (u) URL.revokeObjectURL(u);
  };
  onCleanup(liberer);
  const choisirPhoto = (fichier: File | undefined) => {
    if (!fichier || !fichier.type.startsWith("image/")) return;
    liberer();
    const url = URL.createObjectURL(fichier);
    const img = new Image();
    img.onload = () => {
      if (img.naturalWidth && img.naturalHeight)
        setRapportPhoto(img.naturalWidth / img.naturalHeight);
      setPhoto(url);
      setPos({ x: 0.5, y: 0.42 });
    };
    img.src = url;
  };

  // Glisser l'affiche sur la photo, au doigt ou à la souris.
  let glisse: { id: number; dx: number; dy: number } | null = null;
  const pointer = (e: PointerEvent) => {
    const r = zonePhoto?.getBoundingClientRect();
    return r ? { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height } : null;
  };
  const borner = (v: number) => Math.min(0.98, Math.max(0.02, v));
  const debut = (e: PointerEvent) => {
    const p = pointer(e);
    if (!p) return;
    glisse = { id: e.pointerId, dx: pos().x - p.x, dy: pos().y - p.y };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    e.preventDefault();
  };
  const bouge = (e: PointerEvent) => {
    if (!glisse || e.pointerId !== glisse.id) return;
    const p = pointer(e);
    if (p) setPos({ x: borner(p.x + glisse.dx), y: borner(p.y + glisse.dy) });
  };
  const fin = () => {
    glisse = null;
  };
  /** Les flèches déplacent aussi l'affiche, pour qui n'a pas de souris. */
  const clavier = (e: KeyboardEvent) => {
    const pas = 0.02;
    const d = { ArrowLeft: [-pas, 0], ArrowRight: [pas, 0], ArrowUp: [0, -pas], ArrowDown: [0, pas] }[
      e.key
    ];
    if (!d) return;
    e.preventDefault();
    setPos((p) => ({ x: borner(p.x + d[0]!), y: borner(p.y + d[1]!) }));
  };

  // --- Fenêtre : Échap ferme, le focus revient où il était ---
  let fermer: HTMLButtonElement | undefined;
  const avant = typeof document !== "undefined" ? (document.activeElement as HTMLElement | null) : null;
  onMount(() => {
    fermer?.focus();
    const touche = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        props.onClose();
      }
    };
    // En capture : la fenêtre du module, dessous, ferme aussi sur Échap.
    document.addEventListener("keydown", touche, true);
    onCleanup(() => {
      document.removeEventListener("keydown", touche, true);
      avant?.focus?.();
    });
  });

  const onglet = (actif: boolean): JSX.CSSProperties => ({
    padding: "7px 12px",
    "border-radius": "999px",
    border: actif ? "2px solid #4f46e5" : "1px solid #d1d5db",
    background: actif ? "#eef2ff" : "#fff",
    "font-size": "14px",
    "font-weight": "600",
    cursor: "pointer",
    "white-space": "nowrap",
  });

  const echelle = () => {
    const p = piece();
    if (!p) return "";
    return m()
      .murEchelle.replace("{affiche}", `${props.format} · ${dimensionsFormat(props.format, m().locale)}`)
      .replace("{meuble}", String(p.meuble));
  };

  return (
    <Portal>
      <div
        class="ml-mur"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ml-mur-titre"
        onClick={(e) => {
          if (e.target === e.currentTarget) props.onClose();
        }}
        style={{
          position: "fixed",
          inset: "0",
          "z-index": "120",
          background: "rgba(17, 24, 39, 0.6)",
          display: "flex",
          "align-items": "center",
          "justify-content": "center",
          padding: "16px",
          "font-family": "var(--font-sans, system-ui, sans-serif)",
          color: "#111827",
        }}
      >
        <div
          style={{
            background: "#fff",
            "border-radius": "12px",
            width: "min(100%, 860px)",
            "max-height": "100%",
            overflow: "auto",
            padding: "16px",
            "box-sizing": "border-box",
          }}
        >
          <div style={{ display: "flex", "align-items": "center", gap: "12px", "margin-bottom": "12px" }}>
            <h2 id="ml-mur-titre" style={{ "font-size": "18px", "font-weight": "700", margin: "0", flex: "1" }}>
              {m().murTitre}
            </h2>
            <button
              ref={fermer}
              type="button"
              onClick={() => props.onClose()}
              aria-label={m().murFermer}
              title={m().murFermer}
              style={{
                width: "36px",
                height: "36px",
                "border-radius": "999px",
                border: "1px solid #d1d5db",
                background: "#fff",
                "font-size": "20px",
                "line-height": "1",
                cursor: "pointer",
              }}
            >
              ×
            </button>
          </div>

          {/* Les pièces, puis « Mon mur » ; le format à droite. */}
          <div style={{ display: "flex", "flex-wrap": "wrap", gap: "8px", "margin-bottom": "12px" }}>
            <For each={PIECES}>
              {(p) => (
                <button
                  type="button"
                  aria-pressed={choix() === p.id}
                  onClick={() => setChoix(p.id)}
                  style={onglet(choix() === p.id)}
                >
                  {p.id === "salon" ? m().murSalon : p.id === "chambre" ? m().murChambre : m().murEntree}
                </button>
              )}
            </For>
            <button
              type="button"
              aria-pressed={choix() === "photo"}
              onClick={() => setChoix("photo")}
              style={onglet(choix() === "photo")}
            >
              {m().murPhoto}
            </button>
            <span style={{ flex: "1" }} />
            <span role="group" aria-label={m().etapeFormat} style={{ display: "inline-flex", gap: "6px" }}>
              <For each={POSTER_FORMATS}>
                {(f) => (
                  <button
                    type="button"
                    aria-pressed={props.format === f}
                    onClick={() => props.onFormat(f)}
                    style={onglet(props.format === f)}
                  >
                    {f}
                  </button>
                )}
              </For>
            </span>
          </div>

          <Switch>
            <Match when={piece()}>
              {(p) => (
                <>
                  <div
                    style={{
                      position: "relative",
                      // Assez haute pour un ordinateur portable, entière sur un téléphone.
                      width: `min(100%, calc(62vh * ${p().l / p().h}))`,
                      margin: "0 auto",
                      "aspect-ratio": `${p().l} / ${p().h}`,
                      "border-radius": "8px",
                      overflow: "hidden",
                      // L'aperçu vit dans sa propre pile : ses calques (z 300
                      // pour le filigrane) ne passent pas devant les boutons.
                      isolation: "isolate",
                    }}
                  >
                    <svg
                      viewBox={`0 0 ${p().l} ${p().h}`}
                      aria-hidden="true"
                      style={{ position: "absolute", inset: "0", width: "100%", height: "100%", display: "block" }}
                    >
                      {p().dessin()}
                    </svg>
                    <div
                      style={{
                        position: "absolute",
                        width: `${(tailleCm().l / p().l) * 100}%`,
                        left: `${((p().x - tailleCm().l / 2) / p().l) * 100}%`,
                        top: `${((p().bas - tailleCm().h) / p().h) * 100}%`,
                        filter: "drop-shadow(0 1.5px 2px rgba(0,0,0,.25))",
                      }}
                    >
                      {props.affiche()}
                    </div>
                  </div>
                  <p style={{ "font-size": "13px", color: "#6b7280", margin: "10px 0 0", "text-align": "center" }}>
                    {echelle()}
                  </p>
                </>
              )}
            </Match>
            <Match when={choix() === "photo"}>
              <input
                ref={saisie}
                type="file"
                accept="image/*"
                style={{ display: "none" }}
                onChange={(e) => {
                  choisirPhoto(e.currentTarget.files?.[0]);
                  e.currentTarget.value = "";
                }}
              />
              <Show
                when={photo()}
                fallback={
                  <button
                    type="button"
                    onClick={() => saisie?.click()}
                    style={{
                      display: "block",
                      width: "100%",
                      padding: "48px 16px",
                      border: "2px dashed #c7c9d1",
                      "border-radius": "10px",
                      background: "#fafafa",
                      "font-size": "15px",
                      "font-weight": "600",
                      cursor: "pointer",
                    }}
                  >
                    {m().murPhotoChoisir}
                    <span style={{ display: "block", "font-size": "13px", "font-weight": "400", color: "#6b7280", "margin-top": "6px" }}>
                      {m().murPhotoPrivee}
                    </span>
                  </button>
                }
              >
                {(url) => (
                  <>
                    <div
                      ref={zonePhoto}
                      style={{
                        position: "relative",
                        width: `min(100%, calc(62vh * ${rapportPhoto()}))`,
                        margin: "0 auto",
                        "aspect-ratio": String(rapportPhoto()),
                        "border-radius": "8px",
                        overflow: "hidden",
                        isolation: "isolate",
                        background: `center / cover no-repeat url("${url()}")`,
                        "touch-action": "none",
                      }}
                    >
                      <div
                        tabIndex={0}
                        role="img"
                        aria-label={m().murPhotoAide}
                        onPointerDown={debut}
                        onPointerMove={bouge}
                        onPointerUp={fin}
                        onPointerCancel={fin}
                        onKeyDown={clavier}
                        style={{
                          position: "absolute",
                          width: `${largeurPhoto() * 100}%`,
                          left: `${pos().x * 100}%`,
                          top: `${pos().y * 100}%`,
                          transform: "translate(-50%, -50%)",
                          cursor: "grab",
                          "touch-action": "none",
                          filter: "drop-shadow(0 2px 3px rgba(0,0,0,.3))",
                        }}
                      >
                        {props.affiche()}
                      </div>
                    </div>
                    <div style={{ display: "flex", "flex-wrap": "wrap", "align-items": "center", gap: "12px", "margin-top": "10px" }}>
                      <label style={{ display: "flex", "align-items": "center", gap: "8px", flex: "1", "min-width": "200px", "font-size": "14px" }}>
                        {m().murTaille}
                        <input
                          type="range"
                          min="0.08"
                          max="0.7"
                          step="0.01"
                          value={largeurPhoto()}
                          onInput={(e) => setLargeurPhoto(Number(e.currentTarget.value))}
                          style={{ flex: "1" }}
                        />
                      </label>
                      <button type="button" onClick={() => saisie?.click()} style={onglet(false)}>
                        {m().murPhotoAutre}
                      </button>
                    </div>
                    <p style={{ "font-size": "13px", color: "#6b7280", margin: "8px 0 0" }}>
                      {m().murPhotoAide} {m().murPhotoPrivee}
                    </p>
                  </>
                )}
              </Show>
            </Match>
          </Switch>
        </div>
      </div>
    </Portal>
  );
}
