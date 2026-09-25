/// <reference lib="dom" />
import { Show, type JSX } from "solid-js";

/** Bouton stylé Tailwind-friendly, autonome (inline styles de secours). */
export function Button(props: {
  children: JSX.Element;
  onClick?: () => void;
  variant?: "primary" | "secondary" | "ghost";
  disabled?: boolean;
  type?: "button" | "submit";
  class?: string;
  /**
   * L'infobulle, et ce que lit un lecteur d'écran.
   *
   * Un bouton dont le contenu est un dessin — la copie d'un personnage, par
   * exemple — n'a aucun texte à annoncer : sans ces deux-là, il se lit
   * « bouton » et rien d'autre.
   */
  title?: string;
  "aria-label"?: string;
}) {
  const variant = () => props.variant ?? "primary";
  const cls = () => {
    const base =
      "ml-cfg-btn inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-medium transition disabled:opacity-50 disabled:cursor-not-allowed";
    const v =
      variant() === "primary"
        ? "bg-indigo-600 text-white hover:bg-indigo-700"
        : variant() === "secondary"
          ? "bg-gray-100 text-gray-800 hover:bg-gray-200 border border-gray-300"
          : "bg-transparent text-gray-600 hover:bg-gray-100";
    return `${base} ${v} ${props.class ?? ""}`;
  };
  const bg = () =>
    variant() === "primary"
      ? "#4f46e5"
      : variant() === "secondary"
        ? "#f3f4f6"
        : "transparent";
  const color = () => (variant() === "primary" ? "#ffffff" : "#1f2937");
  return (
    <button
      type={props.type ?? "button"}
      class={cls()}
      title={props.title}
      aria-label={props["aria-label"]}
      disabled={props.disabled}
      onClick={() => props.onClick?.()}
      style={{
        background: bg(),
        color: color(),
        border:
          variant() === "secondary" ? "1px solid #d1d5db" : "1px solid transparent",
        "border-radius": "6px",
        padding: "8px 16px",
        "font-size": "14px",
        "font-weight": "500",
        cursor: props.disabled ? "not-allowed" : "pointer",
        opacity: props.disabled ? "0.5" : "1",
      }}
    >
      {props.children}
    </button>
  );
}

/**
 * Anneau posé autour de la couleur choisie : un liseré clair, puis le violet
 * des sélections. Le liseré sépare l'anneau de la pastille — sans lui, un
 * violet choisi se fondait dans son propre contour.
 */
export const ANNEAU_COULEUR_CHOISIE = "0 0 0 2px #fafafa, 0 0 0 4px #4f46e5";

/**
 * Vrai si une coche sombre se lit mieux qu'une blanche sur cette couleur.
 *
 * Luminance relative au sens WCAG : vers 0,18, le contraste avec le blanc et
 * celui avec l'encre se valent. Au-dessus (peau claire, jaune, blanc), la
 * coche est sombre ; en dessous (bleu, bordeaux, noir), elle est blanche. Une
 * valeur illisible est traitée comme claire : une coche sombre sur fond
 * inconnu reste visible sur le fond clair du panneau.
 */
export function couleurClaire(hex: string): boolean {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return true;
  let h = m[1]!;
  if (h.length === 3) h = h.replace(/./g, (c) => c + c);
  const lineaire = (debut: number) => {
    const c = parseInt(h.slice(debut, debut + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const luminance =
    0.2126 * lineaire(0) + 0.7152 * lineaire(2) + 0.0722 * lineaire(4);
  return luminance > 0.18;
}

/** Coche dessinée sur une couleur, dans la teinte qui s'y lit le mieux. */
export function CocheCouleur(props: { fond: string }) {
  const claire = () => couleurClaire(props.fond);
  return (
    <svg
      viewBox="0 0 20 20"
      width="22"
      height="22"
      aria-hidden="true"
      style={{
        display: "block",
        // Un halo de la teinte opposée : sur une couleur moyenne, la coche
        // garde un bord net quelle que soit la teinte retenue.
        filter: claire()
          ? "drop-shadow(0 0 1px rgba(255,255,255,.9))"
          : "drop-shadow(0 0 1px rgba(0,0,0,.6))",
      }}
    >
      <polyline
        points="4.5 10.5 8.5 14.5 15.5 6"
        fill="none"
        stroke={claire() ? "#111827" : "#ffffff"}
        stroke-width="2.8"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  );
}

/**
 * Pastille de couleur cliquable — la même partout : couleur du texte à
 * l'étape 1, peau, vêtements, cheveux et accessoires des personnages.
 *
 * 40 px : c'est la taille minimale d'une cible au doigt, et le stand se tient
 * sur une tablette. À 22 px, les pastilles des personnages se touchaient à
 * côté et se voyaient à peine (retour cliente). Le contour est assez sombre
 * pour qu'une pastille BLANCHE se détache du panneau blanc, et la couleur
 * choisie porte une coche en plus de son anneau : un anneau seul se perd sur
 * une rangée de couleurs vives.
 */
export function PastilleCouleur(props: {
  couleur: string;
  actif: boolean;
  /** Nom de la couleur, ou sa valeur : infobulle et lecteur d'écran. */
  libelle: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={() => props.onClick()}
      aria-pressed={props.actif}
      aria-label={props.libelle}
      title={props.libelle}
      // Un choix, donc un item que le bord bas peut couper en deux
      // (cf. la règle de la demi-rangée, Defilement.tsx).
      data-item
      style={{
        flex: "0 0 auto",
        width: "40px",
        height: "40px",
        "border-radius": "9999px",
        background: props.couleur,
        border: "1px solid rgba(17, 24, 39, 0.32)",
        "box-shadow": props.actif ? ANNEAU_COULEUR_CHOISIE : "none",
        cursor: "pointer",
        padding: "0",
        display: "inline-flex",
        "align-items": "center",
        "justify-content": "center",
      }}
    >
      <Show when={props.actif}>
        <CocheCouleur fond={props.couleur} />
      </Show>
    </button>
  );
}

export function Field(props: { label: string; children: JSX.Element }) {
  return (
    <label
      class="ml-cfg-field"
      style={{ display: "block", "margin-bottom": "12px" }}
    >
      <span
        style={{
          display: "block",
          "font-size": "13px",
          "font-weight": "600",
          color: "#374151",
          "margin-bottom": "4px",
        }}
      >
        {props.label}
      </span>
      {props.children}
    </label>
  );
}
