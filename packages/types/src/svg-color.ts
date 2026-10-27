/**
 * Recoloration des SVG d'assets par zones (§18.1 D).
 *
 * Les SVG Memory Line définissent leurs couleurs via des classes CSS
 * `.st0{fill:#BA6821;}` dans un bloc <style>. Recolorier = remplacer la
 * valeur `fill` de chaque classe ciblée. Pure string-transform → fonctionne
 * côté navigateur (configurateur) ET côté serveur (worker PDF), sans DOM.
 */

/** Extrait les zones { st0: "#BA6821", … } d'un SVG (mêmes règles que le seed). */
export function extractColorZones(svg: string): Record<string, string> {
  const zones: Record<string, string> = {};
  const re = /\.(st\d+)\s*\{\s*fill\s*:\s*(#[0-9a-fA-F]{3,8})/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(svg)) !== null) zones[m[1]!] = m[2]!.toUpperCase();
  return zones;
}

/**
 * Applique des couleurs personnalisées à un SVG.
 * `overrides` : { st0: "#ff0000", … } — seules les zones présentes sont changées.
 * Réécrit la déclaration `fill` dans le bloc <style> pour chaque classe ciblée.
 */
export function recolorSvg(
  svg: string,
  overrides: Record<string, string>,
): string {
  let out = svg;
  for (const [zone, color] of Object.entries(overrides)) {
    if (!/^#[0-9a-fA-F]{3,8}$/.test(color)) continue; // garde-fou: hex only
    // .st0{fill:#XXXXXX} -> .st0{fill:<color>}  (tolère espaces/casse)
    const re = new RegExp(
      `(\\.${zone}\\s*\\{[^}]*?fill\\s*:\\s*)#[0-9a-fA-F]{3,8}`,
      "g",
    );
    out = out.replace(re, `$1${color}`);
  }
  return out;
}

/** Normalise un id de zone (sécurité : seules les clés stN sont acceptées). */
export function isValidZone(zone: string): boolean {
  return /^st\d+$/.test(zone);
}

/* -------------------------------------------------------------------------- */
/*  Couleurs namespacées par couche (base / slot)                              */
/* -------------------------------------------------------------------------- */

/**
 * Les zones `.stN` n'ont PAS la même sémantique d'une couche à l'autre : la
 * base et les variantes de slots (vêtements, pantalon, cheveux…) réutilisent
 * les mêmes numéros. Une map plate { st0: "#hex" } recolore donc TOUTES les
 * couches à la fois (crosstalk : choisir un rouge vêtements teinte aussi le
 * pantalon et les cheveux). Les couleurs d'un personnage sont donc stockées
 * sous des clés namespacées `<scope>:<zone>` (ex. "clothes:st0", "base:st1"),
 * où le scope est {@link BASE_COLOR_SCOPE} pour le SVG de base ou le nom du
 * slot pour une variante.
 */
export const BASE_COLOR_SCOPE = "base";

/** Clé de couleur namespacée pour une zone d'une couche donnée. */
export function colorKey(scope: string, zone: string): string {
  return `${scope}:${zone}`;
}

/**
 * Extrait, pour UNE couche (scope), la map plate { stN: "#hex" } à passer à
 * {@link recolorSvg}. Les clés plates sans `:` (anciens configs / paniers
 * sauvegardés avant le namespacing) s'appliquent à toutes les couches
 * (comportement historique) ; les clés namespacées du scope les surchargent.
 */
export function colorsForScope(
  colors: Record<string, string> | undefined | null,
  scope: string,
): Record<string, string> {
  const out: Record<string, string> = {};
  if (!colors) return out;
  for (const [key, hex] of Object.entries(colors)) {
    if (!key.includes(":")) out[key] = hex; // legacy plat -> toutes les couches
  }
  const prefix = `${scope}:`;
  for (const [key, hex] of Object.entries(colors)) {
    if (key.startsWith(prefix)) out[key.slice(prefix.length)] = hex;
  }
  return out;
}

/**
 * Scope les règles CSS d'un SVG destiné à être INLINÉ dans le DOM.
 *
 * Problème : chaque SVG exporté définit ses couleurs via un bloc
 * `<style>.st0{fill:…}</style>`. Une fois plusieurs SVG inlinés dans la même
 * page (base + vêtements + cheveux…), ces règles sont GLOBALES au document :
 * le dernier bloc `<style>` gagne pour toutes les couches → les recolorations
 * ne s'affichent pas (ou s'appliquent aux mauvaises couches).
 *
 * Solution : on pose `data-svg-scope="<uid>"` sur la balise <svg> racine et on
 * préfixe chaque sélecteur du bloc <style> par `[data-svg-scope="<uid>"] ` —
 * les règles ne matchent plus que les éléments de CE svg, et leur spécificité
 * bat les règles non préfixées d'un éventuel SVG tiers.
 *
 * Inutile côté serveur (le worker PDF rasterise chaque couche isolément) ;
 * indispensable côté navigateur avant toute injection innerHTML.
 */
export function scopeSvgStyles(svg: string, uid: string): string {
  const safe = uid.replace(/[^a-zA-Z0-9_-]/g, "-");
  let out = svg.replace(
    /<svg\b([^>]*)>/,
    (_m, attrs: string) => `<svg${attrs} data-svg-scope="${safe}">`,
  );
  out = out.replace(
    /(<style[^>]*>)([\s\S]*?)(<\/style>)/g,
    (_m, open: string, css: string, close: string) => {
      const scoped = css.replace(
        /(^|\})\s*([^{}@][^{}]*)\{/g,
        (_m2, brace: string, selectors: string) => {
          const prefixed = selectors
            .split(",")
            .map((s) => `[data-svg-scope="${safe}"] ${s.trim()}`)
            .join(",");
          return `${brace}${prefixed}{`;
        },
      );
      return open + scoped + close;
    },
  );
  return out;
}

/* -------------------------------------------------------------------------- */
/*  Calage des pièces sur un personnage                                        */
/* -------------------------------------------------------------------------- */

/**
 * Décalage et taille d'une pièce (coupe, vêtement…) SUR UN PERSONNAGE donné.
 *
 * Toutes les pièces sont dessinées dans le même cadre 500×1000 et simplement
 * superposées : elles tombent juste sur la morphologie pour laquelle elles ont
 * été dessinées. Sur un enfant ou un animal, la coupe flotte ou la casquette
 * mange le front. Ce réglage rattrape l'écart, par personnage et par
 * emplacement.
 *
 * `dx` et `dy` sont en POURCENTS du cadre du personnage (positif = vers la
 * droite / vers le bas), `scale` un facteur (1 = taille d'origine).
 */
export interface CalagePiece {
  dx: number;
  dy: number;
  scale: number;
}

/** Aucun calage : la pièce est posée telle qu'elle a été dessinée. */
export const CALAGE_NEUTRE: CalagePiece = { dx: 0, dy: 0, scale: 1 };

/** Vrai si le calage ne change rien — inutile de toucher au SVG. */
export function calageNeutre(c: CalagePiece | null | undefined): boolean {
  return !c || (c.dx === 0 && c.dy === 0 && c.scale === 1);
}

/**
 * Bornes d'un calage, communes au back-office (souris, clavier), à l'API et
 * au rendu.
 *
 * Le décalage va jusqu'à toute la largeur ou toute la hauteur du cadre. Il
 * s'arrêtait à la moitié, et une coupe dessinée pour Femme 6 — assise, sa tête
 * au tiers du cadre — ne montait pas jusqu'à la tête d'une femme de dos : une
 * pièce réduite se rapproche du BAS du cadre (l'agrandissement part du
 * bas-centre), il faut donc la remonter d'autant plus (27/10/2026).
 */
export const BORNES_CALAGE = {
  decalage: 100,
  tailleMin: 0.2,
  tailleMax: 3,
} as const;

/** Complète un calage partiel (venu de la base) avec les valeurs neutres. */
export function calagePropre(brut: unknown): CalagePiece {
  const o = (brut ?? {}) as Record<string, unknown>;
  const nombre = (v: unknown, defaut: number, min: number, max: number) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : defaut;
  };
  const { decalage, tailleMin, tailleMax } = BORNES_CALAGE;
  return {
    dx: nombre(o.dx, 0, -decalage, decalage),
    dy: nombre(o.dy, 0, -decalage, decalage),
    scale: nombre(o.scale, 1, tailleMin, tailleMax),
  };
}

/**
 * Où tombe le cadre 500×1000 du personnage dans le repère d'un fichier : pour
 * chaque axe, un point du fichier `v` se pose en `echelle × (v − min) + marge`
 * dans le cadre.
 */
export interface RepereFichier {
  minX: number;
  minY: number;
  echelleX: number;
  echelleY: number;
  margeX: number;
  margeY: number;
}

/** Un fichier dessiné au format du cadre : rien à convertir. */
const REPERE_DU_CADRE: RepereFichier = {
  minX: 0,
  minY: 0,
  echelleX: 1,
  echelleY: 1,
  margeX: 0,
  margeY: 0,
};

/**
 * Lit, sur la balise <svg> d'ouverture, comment le fichier se pose dans le
 * cadre 500×1000 : son viewBox, puis son `preserveAspectRatio` (par défaut
 * `xMidYMid meet`, centré sans déborder). C'est ainsi que le posent les trois
 * rendus : l'écran de calage du back-office (une <image> 500×1000), la
 * boutique (le SVG remplit un cadre 1:2) et l'impression (chaque couche à la
 * même largeur, centrée sur le même point).
 *
 * Sans viewBox lisible, le fichier est pris pour un 500×1000.
 */
export function repereDuFichier(ouverture: string): RepereFichier {
  const attribut = (nom: string) =>
    new RegExp(`\\s${nom}\\s*=\\s*["']([^"']*)["']`).exec(ouverture)?.[1];
  const [minX = NaN, minY = NaN, largeur = NaN, hauteur = NaN, ...reste] = (
    attribut("viewBox") ?? ""
  )
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  if (
    reste.length > 0 ||
    ![minX, minY, largeur, hauteur].every(Number.isFinite) ||
    largeur <= 0 ||
    hauteur <= 0
  )
    return REPERE_DU_CADRE;
  const [alignement = "xMidYMid", mode = "meet"] = (
    attribut("preserveAspectRatio") ?? ""
  )
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  let echelleX = 500 / largeur;
  let echelleY = 1000 / hauteur;
  if (alignement !== "none") {
    const e =
      mode === "slice"
        ? Math.max(echelleX, echelleY)
        : Math.min(echelleX, echelleY);
    echelleX = e;
    echelleY = e;
  }
  // Part de la place libre laissée avant le dessin : 0 collé, ½ centré, 1 au bout.
  const part = (debut: string, bout: string) =>
    alignement === "none"
      ? 0
      : alignement.includes(debut)
        ? 0
        : alignement.includes(bout)
          ? 1
          : 0.5;
  return {
    minX,
    minY,
    echelleX,
    echelleY,
    margeX: (500 - largeur * echelleX) * part("xMin", "xMax"),
    margeY: (1000 - hauteur * echelleY) * part("YMin", "YMax"),
  };
}

/**
 * Transformation SVG correspondant à un calage, écrite dans le repère du
 * fichier de la pièce.
 *
 * Le calage se règle au back-office dans le CADRE du personnage (500×1000) :
 * décalage en % de sa largeur et de sa hauteur, agrandissement depuis son
 * BAS-CENTRE (250, 1000) — agrandir depuis le coin haut-gauche décollerait la
 * pièce du personnage. Une pièce dessinée en 500×1000 a le même repère que le
 * cadre ; une pièce dessinée dans un autre format (1024×1536, par exemple) y
 * est réduite et centrée, et le décalage comme le point d'ancrage doivent être
 * ramenés dans SON repère. Sans cette conversion, un t-shirt calé au
 * back-office tombait plus bas et plus à droite sur la boutique et à
 * l'impression (27 octobre).
 */
export function transformCalage(
  c: CalagePiece,
  repere: RepereFichier = REPERE_DU_CADRE,
): string {
  const tx = (c.dx / 100) * 500;
  const ty = (c.dy / 100) * 1000;
  // Le bas-centre du cadre, et le décalage, exprimés dans le fichier.
  const ax = repere.minX + (250 - repere.margeX) / repere.echelleX;
  const ay = repere.minY + (1000 - repere.margeY) / repere.echelleY;
  const fx = tx / repere.echelleX;
  const fy = ty / repere.echelleY;
  return `translate(${fx} ${fy}) translate(${ax} ${ay}) scale(${c.scale}) translate(${-ax} ${-ay})`;
}

/**
 * Applique un calage à un SVG de pièce : son contenu est enveloppé dans un
 * groupe transformé.
 *
 * Le viewBox n'est pas touché — la pièce reste dans le même cadre que la base
 * du personnage, seule son occupation à l'intérieur change. C'est la MÊME
 * fonction qui sert à l'écran et à l'impression : les deux ne peuvent pas
 * diverger.
 */
export function appliquerCalage(
  svg: string,
  calage: CalagePiece | null | undefined,
): string {
  if (!svg || calageNeutre(calage)) return svg;
  const ouverture = /<svg\b[^>]*>/.exec(svg);
  if (!ouverture) return svg;
  const debut = ouverture.index + ouverture[0].length;
  const fin = svg.lastIndexOf("</svg>");
  if (fin <= debut) return svg;
  const dedans = svg.slice(debut, fin);
  const transformation = transformCalage(
    calagePropre(calage),
    repereDuFichier(ouverture[0]),
  );
  return (
    svg.slice(0, debut) +
    `<g transform="${transformation}">${dedans}</g>` +
    svg.slice(fin)
  );
}

/**
 * Calage à appliquer à une pièce précise sur un personnage.
 *
 * Deux niveaux, du plus précis au plus général :
 *   1. `"hair:3"` — cette coupe-là sur ce personnage ;
 *   2. `"hair"`   — toutes les coupes sur ce personnage.
 *
 * Le premier niveau existe parce qu'une coupe longue et une casquette ne se
 * calent pas de la même façon ; le second évite d'avoir à régler vingt-sept
 * coupes une par une quand un simple décalage d'ensemble suffit.
 */
export function calagePour(
  table: Partial<Record<string, CalagePiece>> | null | undefined,
  slot: string,
  position: number | null | undefined,
): CalagePiece | undefined {
  if (!table) return undefined;
  if (position != null) {
    const precis = table[`${slot}:${position}`];
    if (precis) return precis;
  }
  return table[slot];
}
