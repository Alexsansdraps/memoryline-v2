/**
 * « Créer un fond » (BO › Atelier, 20/11) : ce qui se calcule sans base ni
 * réseau — la consigne envoyée au modèle, les retouches toutes faites, les
 * bornes, les noms d'un lot et l'état d'un fond. Les routes sont dans
 * fonds-ia.ts.
 *
 * Le besoin, dans les mots de Margaux : « Si seulement tu pouvais me faire un
 * programme où j'ai juste à mettre des photos et qu'il me génère des fonds
 * automatiquement sans que je discute pendant 2h pour faire un seule fond de
 * ville ». Puis, par Alexandra : plusieurs photos déposées d'un coup donnent
 * CHACUNE leur fond ; le style est celui d'un style des affiches IA, lu en
 * base ; et chaque fond garde une petite discussion, « si jamais le résultat
 * est pas top top ».
 *
 * En anglais, comme la consigne des affiches (ia-style.ts) : le modèle suit
 * plus fidèlement des interdictions précises écrites en anglais.
 */

/**
 * Un lot compte 1 à 10 photos, et CHAQUE photo donne son propre fond
 * (correction d'Alexandra du 20/11 : « plusieurs photos en même temps
 * différentes, ça doit pas créer une photo pour plusieurs uploadées ! »).
 * Dix photos à deux versions, c'est déjà vingt images payées.
 */
export const PHOTOS_MAX = 10;
/** Deux décors d'exemple au plus : assez pour le style, pas assez pour copier. */
export const EXEMPLES_MAX = 2;
/** Versions par demande : chacune est payée, on en borne le nombre. */
export const VERSIONS_MAX = 4;
export const NOM_MAX = 120;
export const PRECISION_MAX = 400;
/** Un message de la discussion : quelques phrases, pas un roman. */
export const MESSAGE_MAX = 600;
/**
 * Les demandes précédentes rappelées au modèle : les dix dernières. Au-delà,
 * la consigne grossit et les plus anciennes sont de toute façon déjà dans
 * l'image de départ.
 */
export const HISTORIQUE_MAX = 10;

/**
 * Le format des décors existants : 2:3 en portrait (1024 × 1536, comme les
 * SVG de la bibliothèque, viewBox 768 × 1152, et les PNG 1408 × 2112). C'est
 * aussi une taille que le modèle sait produire directement.
 */
export const TAILLE_FOND = "1024x1536";
/**
 * Le décor enregistré est agrandi à 2048 × 3072 (même rapport) : imprimé en
 * A3, un décor de 1024 px serait flou ; les PNG déjà en place vont de 1408 à
 * 1920 px de large.
 */
export const DECOR_LARGEUR = 2048;
export const DECOR_HAUTEUR = 3072;

/**
 * Ce qui est PROPRE À UN FOND, et à lui seul. Modifiable au BO (réglage
 * « ia.fondConsigne », sur l'écran même) ; {{LIEU}} devient le nom du lieu.
 *
 * Le STYLE n'est pas ici (précision d'Alexandra du 20/11 : « faut reprendre
 * le prompt de bâtiment paysage (pas le copier, mais prendre celui renseigné
 * dans le champ) ») : c'est le champ « prompt » d'un style de BO › Affiches
 * IA › Styles, lu en base à CHAQUE génération et placé AVANT ce texte. Si
 * Margaux le réécrit, le fond suivant suit.
 *
 * Ce texte fait ce que Margaux demandait à la main, « pendant 1000 ans » :
 * le meilleur angle, retirer ce qui gêne, le cadrage de l'affiche.
 *
 * Les rôles des images (photo, exemples, version de départ) ne sont pas ici
 * non plus : le code les écrit d'après ce qui part réellement, pour qu'un
 * texte retouché au BO ne puisse pas les contredire.
 */
export const CONSIGNE_FOND_DEFAUT = `BACKGROUND (DÉCOR) OF A MEMORY LINE PERSONALISED POSTER — RULES SPECIFIC TO BACKGROUNDS
These rules come on top of the style above and win over it when they disagree.

The image is the background of a personalised poster showing this place: {{LIEU}}.
It is an EMPTY scenery. Afterwards, our software adds on top of it: a three-line title printed in the sky at the top, small illustrated characters (a couple, a family, their pets) standing on the ground in the lower part, and a low foreground wall (parapet) across the very bottom. None of these must appear in this image.

1. CHOOSE THE BEST VIEWPOINT — DO NOT JUST TRACE THE PHOTO
- The photo was often taken on the go: awkward angle, tilted, too close, partly hidden. Re-imagine the scene from the most iconic, recognizable and attractive point of view of this place — the one a postcard or a travel poster would use.
- Eye level, standing in the street, on the square, on the quay or on the path, facing the landmark: frontal, symmetrical or gently diagonal perspective. No aerial view, no extreme wide angle, no close-up of a detail.
- Straighten converging verticals and level the horizon. Step back if the landmark is cut off.

2. CLEAN UP THE SCENE
Remove everything temporary or distracting: cars, vans, bikes, scooters, parking meters, traffic signs, road markings, street lamps that cut the view, bins, barriers, scaffolding, construction works, cranes, overhead cables and wires, antennas, satellite dishes, shop signs with writing, advertising, posters, graffiti, tourists, passers-by, crowds. Repair what they were hiding naturally.

3. COMPOSITION FOR A VERTICAL POSTER — MANDATORY
- Vertical portrait image, 2:3 ratio, full bleed: no border, no frame, no margin.
- TOP 30 %: open, calm sky. Nothing — no roof, tower, tree or mountain — reaches into the top quarter: the title is printed there.
- MIDDLE: the landmark and the typical architecture of the place, centred and well readable, at mid-distance, horizon around 40 % from the bottom.
- BOTTOM 30 %: a wide, flat, empty and uncluttered ground in the foreground (pavement, square, quay, path, beach or grass — whatever fits the place), seen at eye level, so that characters can stand on it. Keep the bottom 12 % especially simple: the foreground wall will cover it.

4. FIDELITY
The place must be recognizable at first glance by someone who lives there: real buildings, their colours, the landmark, the water, the vegetation and the general layout. Never invent monuments or buildings that are not there.

STRICTLY FORBIDDEN
No people, no silhouettes, no animals. No text, no letters, no numbers, no signs with writing, no logo, no watermark, no signature, no frame.`;

/**
 * Le style présélectionné à l'écran : celui dont le titre parle de bâtiment
 * ou de paysage (casse et accents ignorés), sinon le premier. En production,
 * Margaux a un style « bâtiment / paysage » ; en local, « Maison / Bâtiment »
 * et « Paysage ».
 */
export function styleParDefaut<T extends { id: number; title: string }>(
  styles: readonly T[],
): T | null {
  const plat = (s: string) =>
    s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  return styles.find((s) => /batiment|paysage/.test(plat(s.title))) ?? styles[0] ?? null;
}

/**
 * Les retouches toutes faites, en boutons dans la discussion de chaque fond
 * (précision de Margaux du 20/11 : l'angle, et « que ça supprime des trucs »).
 * Le libellé est celui du bouton, et ce qu'on lit dans le fil ; la consigne,
 * ce qui part au modèle.
 */
export const RETOUCHES = [
  {
    cle: "angle",
    libelle: "Changer l'angle",
    consigne:
      "Show the same place from a better, more iconic viewpoint: eye level, facing the landmark, frontal or gently diagonal, as on a travel poster. Use the photo of the place to stay faithful.",
  },
  {
    cle: "nettoyer",
    libelle: "Retirer les voitures et panneaux",
    consigne:
      "Remove every car, vehicle, traffic sign, road marking, bin, barrier, cable, scaffolding, shop sign with writing and person, and repair what they were hiding naturally.",
  },
  {
    cle: "ciel",
    libelle: "Plus de ciel en haut",
    consigne:
      "Give much more open, calm sky at the top: the top 30 % of the image must be sky only, with nothing reaching into it. Move the scene down or zoom out slightly if needed.",
  },
  {
    cle: "bas",
    libelle: "Dégager le bas",
    consigne:
      "Make the bottom 30 % a wide, flat, empty ground in the foreground (pavement, square, quay or path), with nothing standing on it, so that characters can stand there.",
  },
] as const;

export type CleRetouche = (typeof RETOUCHES)[number]["cle"];

/** Texte saisi au BO : sans caractères de contrôle, sans espaces autour, borné. */
export function nettoyerTexte(brut: unknown, max: number): string {
  return String(brut ?? "")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

/** Le nombre de versions demandé, ramené entre 1 et VERSIONS_MAX. */
export function bornerVersions(brut: unknown, defaut: number): number {
  const n = Math.trunc(Number(brut));
  const d = Math.min(VERSIONS_MAX, Math.max(1, Math.trunc(defaut) || 2));
  if (!Number.isFinite(n) || n < 1) return d;
  return Math.min(VERSIONS_MAX, n);
}

/**
 * Les décors d'exemple : « 12, 57 » (le réglage) ou [12, 57] (le formulaire)
 * deviennent des identifiants entiers, sans doublon, deux au plus.
 */
export function lireExemples(brut: unknown): number[] {
  const morceaux = Array.isArray(brut) ? brut : String(brut ?? "").split(/[\s,;]+/);
  const ids: number[] = [];
  for (const m of morceaux) {
    const n = Number(m);
    if (Number.isInteger(n) && n > 0 && !ids.includes(n)) ids.push(n);
    if (ids.length === EXEMPLES_MAX) break;
  }
  return ids;
}

/**
 * Un message de la discussion : ce qu'on en lit dans le fil (libellés des
 * boutons, puis le texte de Margaux) et ce qui part au modèle (consignes des
 * boutons, puis son texte tel quel). Les clés inconnues sont ignorées.
 */
export function lireMessage(
  retouches: readonly unknown[],
  texteLibre: unknown,
): { texte: string; demande: string } {
  const voulues = new Set(retouches.map((c) => String(c)));
  const choisies = RETOUCHES.filter((r) => voulues.has(r.cle));
  const libre = nettoyerTexte(texteLibre, MESSAGE_MAX);
  return {
    texte: [...choisies.map((r) => r.libelle), libre].filter(Boolean).join(" · "),
    demande: [...choisies.map((r) => r.consigne), libre].filter(Boolean).join(" "),
  };
}

/**
 * La consigne complète d'une génération, dans cet ordre :
 *   1. le rôle de chaque image, écrit d'après ce qui part vraiment ;
 *   2. le STYLE (le champ « prompt » du style choisi, lu en base) ;
 *   3. les règles propres aux fonds (réglage « ia.fondConsigne ») ;
 *   4. les demandes déjà faites pour cette image, pour qu'une correction
 *      obtenue ne se perde pas au message suivant ;
 *   5. la demande du moment, EN DERNIER — le modèle retient mieux ce qui
 *      vient en dernier, comme pour les affiches (ajouterDemandeClient).
 *
 * Ordre des images, le même ici et dans fonds-ia.ts : la version de départ
 * (s'il y en a une), puis la photo du lieu, puis les décors d'exemple.
 */
export function composerConsigneFond(p: {
  style?: string | null;
  gabarit: string;
  lieu: string;
  nbPhotos: number;
  nbExemples: number;
  /** On repart d'une version déjà dessinée : elle est IMAGE 1. */
  depuisVersion?: boolean;
  /** Les demandes déjà faites pour cette image, de la plus ancienne à la plus récente. */
  historique?: readonly string[];
  /** La demande du moment (précision du lot, ou message de la discussion). */
  demande?: string | null;
}): string {
  const lieu = nettoyerTexte(p.lieu, NOM_MAX) || "the place shown in the photo";
  let n = 1;
  const roles: string[] = [];
  if (p.depuisVersion) {
    roles.push(
      `IMAGE ${n}: the CURRENT BACKGROUND. Start from this image and keep it — same style, same colours, same place, same framing — except for what the new request asks to change.`,
    );
    n++;
  }
  if (p.nbPhotos > 0) {
    const de = n;
    const a = n + p.nbPhotos - 1;
    roles.push(
      `${de === a ? `IMAGE ${de}: PHOTO` : `IMAGES ${de} TO ${a}: PHOTOS`} of the real place (${lieu}). Use ${de === a ? "it" : "them"} for the CONTENT only: what the place looks like. Never copy the photographic look.`,
    );
    // Le style est écrit pour les affiches, où la photo est TOUJOURS
    // « IMAGE 1 ». Quand la version de départ prend cette place, on le dit,
    // sinon le style ferait recopier la version au lieu du lieu réel.
    if (p.depuisVersion && String(p.style ?? "").trim())
      roles.push(
        `In the STYLE section below, "IMAGE 1" and "the photo" mean the PHOTO of the place (IMAGE ${de} here), not the current background.`,
      );
    n = a + 1;
  }
  if (p.nbExemples > 0) {
    const de = n;
    const a = n + p.nbExemples - 1;
    roles.push(
      `${de === a ? `IMAGE ${de}` : `IMAGES ${de} TO ${a}`}: STYLE EXAMPLES — existing Memory Line backgrounds of OTHER places. Copy their rendering, colour palette, level of detail and composition (open sky at the top, empty ground at the bottom). NEVER copy their content, buildings or landmarks.`,
    );
  }

  const corps = String(p.gabarit ?? "")
    .split("{{LIEU}}")
    .join(lieu)
    // Un marqueur inconnu partirait tel quel au modèle, qui le lirait comme
    // une consigne : on l'efface.
    .replace(/\{\{[A-Z_]+\}\}/g, "")
    .trim();

  const historique = (p.historique ?? [])
    .map((h) => nettoyerTexte(h, MESSAGE_MAX * 2))
    .filter(Boolean)
    .slice(-HISTORIQUE_MAX);
  const demande = nettoyerTexte(p.demande, MESSAGE_MAX * 2);

  const parties = [
    roles.length ? `IMAGE ROLES\n${roles.map((r) => `- ${r}`).join("\n")}` : "",
    String(p.style ?? "").trim() ? `STYLE\n${String(p.style).trim()}` : "",
    corps,
    historique.length
      ? `REQUESTS ALREADY MADE FOR THIS IMAGE (oldest first) — they are already applied: keep them applied, do not undo them:\n${historique.map((h) => `- ${h}`).join("\n")}`
      : "",
    demande
      ? p.depuisVersion
        ? `NEW REQUEST — change only this in IMAGE 1, keep everything else, and keep every rule above:\n${demande}`
        : `ADDITIONAL REQUEST FROM THE SHOP (follow it, while keeping every rule above):\n${demande}`
      : "",
  ];
  return parties.filter(Boolean).join("\n\n");
}

/** Le coût estimé de `images` images, en centimes. */
export function coutEstimeCents(images: number, coutParVersionCents: number): number {
  return Math.max(0, images) * Math.max(0, coutParVersionCents);
}

/**
 * Le coût d'un lot : chaque photo donne son fond, et chaque fond ses
 * versions — photos × versions images payées.
 */
export function coutDuLotCents(
  photos: number,
  versions: number,
  coutParVersionCents: number,
): number {
  return coutEstimeCents(Math.max(0, photos) * Math.max(0, versions), coutParVersionCents);
}

/** Vrai si lancer `images` images ferait dépasser le plafond du mois. */
export function plafondDepasse(
  depenseCents: number,
  images: number,
  coutParVersionCents: number,
  plafondCents: number,
): boolean {
  return depenseCents + coutEstimeCents(images, coutParVersionCents) > plafondCents;
}

/**
 * Les noms des fonds d'un lot : celui saisi pour la photo s'il y en a un,
 * sinon le nom du lot. Plusieurs photos sans nom à elles reçoivent un
 * numéro (« Colmar 2 ») pour qu'on les distingue dans la bibliothèque.
 */
export function nomsDuLot(nomLot: string, nomsSaisis: readonly unknown[], photos: number): string[] {
  const lot = nettoyerTexte(nomLot, NOM_MAX);
  const sortie: (string | null)[] = [];
  for (let i = 0; i < photos; i++) {
    const propre = nettoyerTexte(nomsSaisis[i], NOM_MAX);
    sortie.push(propre && propre !== lot ? propre : null);
  }
  const sansNom = sortie.filter((s) => s === null).length;
  let k = 0;
  return sortie.map((s) =>
    s !== null ? s : sansNom > 1 ? `${lot} ${++k}`.slice(0, NOM_MAX) : lot,
  );
}

/** L'état d'un fond, d'après les statuts de ses versions. */
export function etatDuFond(statuts: readonly string[]): {
  etat: "en_cours" | "prete" | "echec";
  pretes: number;
  echecs: number;
  enCours: number;
} {
  const pretes = statuts.filter((s) => s === "prete").length;
  const echecs = statuts.filter((s) => s === "echec").length;
  const enCours = statuts.length - pretes - echecs;
  return {
    etat: enCours > 0 ? "en_cours" : pretes > 0 ? "prete" : "echec",
    pretes,
    echecs,
    enCours,
  };
}

/**
 * Le nom de fichier d'un décor, tiré du nom du lieu : « Colmar, la Petite
 * Venise » → « colmar-la-petite-venise ». Le suffixe unique est ajouté par
 * l'appelant, comme pour tout visuel envoyé au BO (/admin/uploads).
 */
export function baseNomFichier(nom: string): string {
  return (
    nom
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60) || "decor"
  );
}
