/**
 * Normalisation des couleurs d'un SVG, quel que soit l'outil qui l'a produit.
 *
 * Tout le moteur de couleurs (recolorSvg, extractColorZones, le fichier
 * d'impression) lit les couleurs dans des classes `.stN{fill:#…}` du bloc
 * <style>, comme les exporte Illustrator. Les dessins générés par IA puis
 * vectorisés, et ceux exportés de Canva, écrivent au contraire la couleur sur
 * chaque forme : `fill="#9b9898"`, ou `style="fill:#9b9898"`. Aucune zone n'y
 * était trouvée, et le client ne pouvait rien recolorer.
 *
 * La normalisation réécrit ces couleurs en classes : chaque couleur distincte
 * devient une zone `.stN`, et le reste du moteur fonctionne sans changer. Elle
 * regroupe aussi les nuances presque identiques (cf. couleurs-groupes.ts).
 *
 * Ce qu'elle ne touche pas :
 *   - les zones `.stN` déjà présentes (fichiers Illustrator) : mêmes noms,
 *     mêmes couleurs — les paniers qui les citent restent justes ;
 *   - les couleurs des masques, découpes, dégradés et filtres : elles ne se
 *     voient pas telles quelles (le noir d'un masque est une transparence) ;
 *   - les contours (`stroke`), les dégradés et les images en pixels.
 *
 * Elle est idempotente : normaliser un fichier déjà normalisé ne change rien.
 * Pur traitement de texte, sans DOM : elle tourne où l'on veut.
 */
import { extractColorZones } from "./svg-color.js";
import { hexVersRgb, rgbVersHex, type GroupeCouleur } from "./couleurs-groupes.js";

/**
 * Conteneurs dont les couleurs ne se voient pas telles quelles. Le noir d'un
 * `<mask>` Canva y dit « transparent à 85 % », pas « noir » : en faire une
 * zone proposerait au client de recolorer une transparence.
 */
const CONTENEURS_EXCLUS = new Set([
  "mask",
  "clippath",
  "pattern",
  "lineargradient",
  "radialgradient",
  "filter",
  "marker",
]);

/**
 * Éléments dont le remplissage se voit. Pas la balise <svg> racine : ses
 * règles de style, une fois préfixées pour l'écran (scopeSvgStyles), ne
 * visent que ses descendants — une classe posée sur elle serait perdue.
 */
const ELEMENTS_COLORES = new Set([
  "path",
  "rect",
  "circle",
  "ellipse",
  "polygon",
  "polyline",
  "line",
  "g",
  "text",
  "tspan",
  "textpath",
  "use",
  "symbol",
  "a",
]);

/** Quelques couleurs nommées que les exports écrivent en toutes lettres. */
const COULEURS_NOMMEES: Record<string, string> = {
  black: "#000000",
  white: "#FFFFFF",
  red: "#FF0000",
  green: "#008000",
  blue: "#0000FF",
  yellow: "#FFFF00",
  orange: "#FFA500",
  pink: "#FFC0CB",
  purple: "#800080",
  brown: "#A52A2A",
  gray: "#808080",
  grey: "#808080",
  silver: "#C0C0C0",
  maroon: "#800000",
  navy: "#000080",
  teal: "#008080",
  olive: "#808000",
  lime: "#00FF00",
  aqua: "#00FFFF",
  fuchsia: "#FF00FF",
};

/**
 * Une valeur de remplissage -> "#RRGGBB", ou null si ce n'est pas une couleur
 * pleine qu'on sait recolorer (none, dégradé, currentColor, transparence…).
 */
export function couleurDeRemplissage(brute: string): string | null {
  const v = brute.replace(/!important/i, "").trim().toLowerCase();
  if (!v) return null;
  if (v in COULEURS_NOMMEES) return COULEURS_NOMMEES[v]!;
  let m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(v);
  if (m) return rgbVersHex(...hexVersRgb(v)!);
  // #RRGGBBAA : seulement si l'opacité est pleine, sinon la couleur vue n'est
  // pas celle écrite.
  m = /^#([0-9a-f]{6})ff$/.exec(v);
  if (m) return `#${m[1]!.toUpperCase()}`;
  m = /^rgba?\(\s*([^)]*)\)$/.exec(v);
  if (m) {
    const parts = m[1]!.split(/\s*[,/\s]\s*/).filter(Boolean);
    if (parts.length < 3 || parts.length > 4) return null;
    if (parts.length === 4) {
      const a = parts[3]!.endsWith("%")
        ? parseFloat(parts[3]!) / 100
        : parseFloat(parts[3]!);
      if (!(a >= 1)) return null;
    }
    const canaux = parts.slice(0, 3).map((p) =>
      p.endsWith("%") ? (parseFloat(p) / 100) * 255 : parseFloat(p),
    );
    if (canaux.some((c) => !Number.isFinite(c))) return null;
    return rgbVersHex(canaux[0]!, canaux[1]!, canaux[2]!);
  }
  return null;
}

/**
 * Les jetons d'un SVG : commentaires, CDATA, blocs <style>/<script> entiers
 * (leur contenu n'est pas du balisage), puis balises. Groupes : 1 = nom du
 * bloc style/script, 2 = « / » d'une fermeture, 3 = nom de balise,
 * 4 = attributs, 5 = « / » d'une balise auto-fermée.
 */
const JETON =
  /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<(style|script)\b[^>]*>[\s\S]*?<\/\1\s*>|<(\/?)([a-zA-Z][\w:.-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g;

/**
 * Motifs d'attributs, construits une fois : un dessin vectorisé compte
 * facilement dix mille formes, chacune lue plusieurs fois.
 */
const MOTIFS_ATTRIBUT = new Map<string, { lire: RegExp; retirer: RegExp }>();
function motifs(nom: string) {
  let m = MOTIFS_ATTRIBUT.get(nom);
  if (!m) {
    m = {
      lire: new RegExp(`\\s${nom}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i"),
      retirer: new RegExp(`\\s${nom}\\s*=\\s*(?:"[^"]*"|'[^']*')`, "gi"),
    };
    MOTIFS_ATTRIBUT.set(nom, m);
  }
  return m;
}

/** Valeur d'un attribut (entre guillemets simples ou doubles), ou null. */
function attribut(attrs: string, nom: string): string | null {
  const m = motifs(nom).lire.exec(attrs);
  return m ? (m[1] ?? m[2] ?? "") : null;
}

/** Retire un attribut. */
function sansAttribut(attrs: string, nom: string): string {
  return attrs.replace(motifs(nom).retirer, "");
}

/** Le remplissage écrit sur une forme : dans son style (prioritaire), sinon en attribut. */
function remplissageDe(
  attrs: string,
): { couleur: string; source: "style" | "attribut" } | null {
  const style = attribut(attrs, "style");
  if (style !== null) {
    for (const decl of style.split(";")) {
      const i = decl.indexOf(":");
      if (i < 0 || decl.slice(0, i).trim().toLowerCase() !== "fill") continue;
      const couleur = couleurDeRemplissage(decl.slice(i + 1));
      // « fill:none » dans le style l'emporte sur l'attribut : rien à faire.
      return couleur ? { couleur, source: "style" } : null;
    }
  }
  const fill = attribut(attrs, "fill");
  if (fill === null) return null;
  const couleur = couleurDeRemplissage(fill);
  return couleur ? { couleur, source: "attribut" } : null;
}

/** Les classes d'une balise. */
function classesDe(attrs: string): string[] {
  return (attribut(attrs, "class") ?? "").split(/\s+/).filter(Boolean);
}

/**
 * Taille approximative d'une forme, pour savoir quelles couleurs dominent le
 * dessin quand la surface réellement peinte n'est pas connue.
 */
function poidsDe(nom: string, attrs: string): number {
  if (nom === "path") return (attribut(attrs, "d") ?? "").length || 1;
  if (nom === "polygon" || nom === "polyline")
    return (attribut(attrs, "points") ?? "").length || 1;
  return 400;
}

/** Une forme dont le remplissage est à réécrire en classe. */
interface FormeColoree {
  couleur: string;
  source: "style" | "attribut";
}

/**
 * Parcourt les balises visibles du dessin (hors masques, découpes, dégradés…)
 * et appelle `visite` pour chacune. Renvoie le SVG où chaque balise a été
 * remplacée par ce que `visite` a rendu.
 */
function parcourir(
  svg: string,
  visite: (nom: string, attrs: string, fin: string, brut: string) => string,
): string {
  let profondeurExclue = 0;
  let racineVue = false;
  return svg.replace(
    JETON,
    (brut, bloc: string | undefined, fermante: string, nomBrut: string, attrs: string, fin: string) => {
      if (bloc || !nomBrut) return brut;
      const nom = nomBrut.toLowerCase().replace(/^.*:/, "");
      if (fermante) {
        if (CONTENEURS_EXCLUS.has(nom) && profondeurExclue > 0) profondeurExclue--;
        return brut;
      }
      if (nom === "svg" && !racineVue) {
        racineVue = true;
        return brut;
      }
      if (CONTENEURS_EXCLUS.has(nom)) {
        if (!fin) profondeurExclue++;
        return brut;
      }
      if (profondeurExclue > 0) return brut;
      return visite(nom, attrs, fin, brut);
    },
  );
}

/** Résultat d'une normalisation. */
export interface ResultatNormalisation {
  /** Le SVG réécrit (identique à l'entrée si `modifie` est faux). */
  svg: string;
  /** Toutes les zones du dessin et leur couleur : { st0: "#9B9898", … }. */
  zones: Record<string, string>;
  /** Les nuances regroupées, sans nom ni réglage. */
  groupes: GroupeCouleur[];
  /** Les zones créées par la normalisation (couleurs écrites sur les formes). */
  zonesCreees: string[];
  /**
   * Images en pixels dans le dessin (hors masques). Un dessin fait d'une seule
   * image enregistrée en SVG n'a aucune couleur à changer : il faut le dire.
   */
  images: number;
  /** Vrai si le SVG a été réécrit (il faut alors l'enregistrer à part). */
  modifie: boolean;
}

export interface OptionsNormalisation {
  /**
   * Surface réellement peinte par chaque couleur (« #RRGGBB » -> pixels),
   * mesurée par l'appelant. Elle numérote les nouvelles zones de la plus
   * étendue à la plus petite, et choisit la référence de chaque groupe. Sans
   * elle, on estime la taille des formes d'après leur tracé.
   */
  surfaces?: Record<string, number>;
}

/**
 * Normalise les couleurs d'un SVG (voir en tête du fichier).
 */
export function normaliserCouleursSvg(
  svg: string,
  options: OptionsNormalisation = {},
): ResultatNormalisation {
  const existantes = extractColorZones(svg);

  // Plus grand numéro de classe stN déjà employé, dans les styles comme sur
  // les balises : les nouvelles zones viennent après, sans collision.
  let max = -1;
  const noter = (texte: string) => {
    for (const m of texte.matchAll(/(?:^|[^\w-])st(\d+)(?![\w-])/g))
      max = Math.max(max, Number(m[1]));
  };
  for (const m of svg.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi)) noter(m[1]!);
  for (const m of svg.matchAll(/\sclass\s*=\s*(?:"([^"]*)"|'([^']*)')/g))
    noter(` ${m[1] ?? m[2] ?? ""}`);

  // 1er passage : les couleurs écrites sur les formes, et la place qu'elles
  // occupent (pour numéroter les zones de la plus étendue à la plus petite).
  const poidsCouleur = new Map<string, number>();
  const poidsZone = new Map<string, number>();
  const aConvertir = (attrs: string): FormeColoree | null => {
    const r = remplissageDe(attrs);
    if (!r) return null;
    // Une forme déjà rangée dans une zone : sa classe l'emporte sur un
    // attribut `fill` (qui ne se voit pas), mais pas sur un style en ligne.
    const dejaZone = classesDe(attrs).some((c) => c in existantes);
    if (dejaZone && r.source === "attribut") return null;
    return r;
  };
  let images = 0;
  parcourir(svg, (nom, attrs, _fin, brut) => {
    if (nom === "image") images++;
    for (const c of classesDe(attrs))
      if (c in existantes) poidsZone.set(c, (poidsZone.get(c) ?? 0) + poidsDe(nom, attrs));
    if (!ELEMENTS_COLORES.has(nom)) return brut;
    const f = aConvertir(attrs);
    if (f) poidsCouleur.set(f.couleur, (poidsCouleur.get(f.couleur) ?? 0) + poidsDe(nom, attrs));
    return brut;
  });

  const surface = (hex: string, repli: number) =>
    options.surfaces?.[hex.toUpperCase()] ?? repli;

  // Une classe par couleur, numérotée de la plus étendue à la plus petite :
  // st0 (ou le premier numéro libre) est la couleur dominante du dessin.
  const classeDe = new Map<string, string>();
  [...poidsCouleur.entries()]
    .sort(
      (a, b) =>
        surface(b[0], b[1]) - surface(a[0], a[1]) ||
        b[1] - a[1] ||
        a[0].localeCompare(b[0]),
    )
    .forEach(([couleur]) => classeDe.set(couleur, `st${++max}`));

  let sortie = svg;
  if (classeDe.size > 0) {
    // 2e passage : chaque forme perd sa couleur écrite et reçoit sa classe.
    sortie = parcourir(svg, (nom, attrs, fin, brut) => {
      if (!ELEMENTS_COLORES.has(nom)) return brut;
      const f = aConvertir(attrs);
      if (!f) return brut;
      let a = sansAttribut(attrs, "fill");
      const style = attribut(a, "style");
      if (style !== null) {
        const reste = style
          .split(";")
          .filter((d) => d.trim() && d.slice(0, d.indexOf(":")).trim().toLowerCase() !== "fill")
          .join(";");
        a = sansAttribut(a, "style") + (reste.trim() ? ` style="${reste}"` : "");
      }
      const classes = [...classesDe(a), classeDe.get(f.couleur)!];
      a = sansAttribut(a, "class") + ` class="${classes.join(" ")}"`;
      return `<${brut.slice(1).match(/^[^\s/>]+/)![0]}${a}${fin}>`;
    });

    // Les règles vont APRÈS les styles existants : à précision égale, la
    // dernière règle l'emporte, et une forme qui portait déjà une classe
    // doit prendre sa nouvelle couleur.
    const regles = [...classeDe.entries()]
      .map(([couleur, classe]) => `.${classe}{fill:${couleur};}`)
      .join("");
    const dernierStyle = [...sortie.matchAll(/<\/style\s*>/gi)].pop();
    if (dernierStyle && dernierStyle.index !== undefined) {
      sortie =
        sortie.slice(0, dernierStyle.index) + regles + sortie.slice(dernierStyle.index);
    } else {
      sortie = sortie.replace(
        /<svg\b(?:[^>"']|"[^"]*"|'[^']*')*>/i,
        (ouverture) => `${ouverture}<style type="text/css">${regles}</style>`,
      );
    }
  }

  const zones = extractColorZones(sortie);
  const poids: Record<string, number> = {};
  for (const [z, hex] of Object.entries(zones)) {
    const repli =
      poidsZone.get(z) ??
      [...classeDe.entries()].reduce(
        (acc, [couleur, classe]) => (classe === z ? poidsCouleur.get(couleur) ?? 0 : acc),
        0,
      );
    poids[z] = surface(hex, repli);
  }

  return {
    svg: sortie,
    zones,
    groupes: grouperNuances(zones, poids),
    zonesCreees: [...classeDe.values()],
    images,
    modifie: sortie !== svg,
  };
}

/* -------------------------------------------------------------------------- */
/*  Regroupement des nuances                                                   */
/* -------------------------------------------------------------------------- */

/** sRGB -> CIE Lab (D65) : une distance y ressemble à un écart perçu. */
function versLab(hex: string): [number, number, number] | null {
  const rgb = hexVersRgb(hex);
  if (!rgb) return null;
  const lin = rgb.map((c) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  const x = (lin[0] * 0.4124 + lin[1] * 0.3576 + lin[2] * 0.1805) / 0.95047;
  const y = lin[0] * 0.2126 + lin[1] * 0.7152 + lin[2] * 0.0722;
  const z = (lin[0] * 0.0193 + lin[1] * 0.1192 + lin[2] * 0.9505) / 1.08883;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}

/**
 * Écart entre deux couleurs. La clarté compte moitié moins que la teinte :
 * une ombre est la même couleur en plus sombre, un changement de teinte est
 * une autre pièce du dessin.
 */
function ecart(a: [number, number, number], b: [number, number, number]): number {
  return Math.hypot((a[0] - b[0]) * 0.5, a[1] - b[1], a[2] - b[2]);
}

/**
 * Seuils du regroupement. Volontairement prudents : deux zones réunies à tort
 * (la peau et des cheveux roux) se voient tout de suite chez le client, alors
 * que deux nuances restées séparées se rattachent d'un geste au back-office.
 *
 * Une zone rejoint un groupe si elle est proche d'une de ses nuances
 * (VOISINE, ce qui suit les dégradés découpés en marches) sans trop
 * s'éloigner de sa référence (REFERENCE, ce qui empêche la dérive de proche
 * en proche jusqu'à une tout autre couleur).
 */
const SEUIL_VOISINE = 6;
const SEUIL_REFERENCE = 12;

/** Numéro d'une zone stN (pour trier). */
const numero = (z: string) => Number(/\d+/.exec(z)?.[0] ?? 0);

/**
 * Regroupe les nuances presque identiques d'un dessin.
 *
 * Les zones sont prises de la plus étendue à la plus petite, chacune comparée
 * aux groupes déjà formés autour des couleurs dominantes.
 *
 * La référence d'un groupe est sa zone de plus petit numéro, et les groupes
 * sortent dans cet ordre :
 *   - pour un dessin normalisé, les numéros suivent la surface : c'est la
 *     nuance dominante, celle que le client voit comme « la » couleur ;
 *   - pour un fichier Illustrator, c'est la zone que la boutique proposait
 *     jusqu'ici (st0, la peau, reste premier) : un panier qui l'avait
 *     choisie retrouve son choix sous la même clé.
 */
export function grouperNuances(
  zones: Record<string, string>,
  poids: Record<string, number> = {},
): GroupeCouleur[] {
  const ordre = Object.keys(zones).sort(
    (a, b) => (poids[b] ?? 0) - (poids[a] ?? 0) || numero(a) - numero(b),
  );
  const groupes: { membres: string[]; labs: [number, number, number][] }[] = [];
  const seules: string[] = [];
  for (const z of ordre) {
    const lab = versLab(zones[z]!);
    if (!lab) {
      seules.push(z);
      continue;
    }
    let meilleur: (typeof groupes)[number] | null = null;
    let meilleurEcart = Infinity;
    for (const g of groupes) {
      if (ecart(lab, g.labs[0]!) > SEUIL_REFERENCE) continue;
      const proche = Math.min(...g.labs.map((l) => ecart(lab, l)));
      if (proche <= SEUIL_VOISINE && proche < meilleurEcart) {
        meilleur = g;
        meilleurEcart = proche;
      }
    }
    if (meilleur) {
      meilleur.membres.push(z);
      meilleur.labs.push(lab);
    } else groupes.push({ membres: [z], labs: [lab] });
  }
  return [
    ...groupes.map((g) => [...g.membres].sort((a, b) => numero(a) - numero(b))),
    ...seules.map((z) => [z]),
  ]
    .sort((a, b) => numero(a[0]!) - numero(b[0]!))
    .map(([zone, ...nuances]) => ({
      zone: zone!,
      ...(nuances.length ? { nuances } : {}),
    }));
}
