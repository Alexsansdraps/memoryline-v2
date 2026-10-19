/**
 * Ce que la recherche lit dans chaque objet de la boutique, et où elle mène.
 *
 * Une fonction par source : elle reçoit des lignes DÉJÀ LUES et rend des
 * « fiches » — le titre de l'objet, ses textes un par un, et pour chaque
 * texte l'endroit exact de l'écran qui le montre. Le fichier est PUR : il
 * n'importe que @memoryline/types/recherche, ne touche jamais à la base, et
 * se teste donc avec des données factices.
 *
 * Deux règles tiennent tout le reste :
 *
 *   - On ne lit que des textes NOMMÉS. Une colonne JSON se lit par ses clés
 *     connues (une traduction par langue et par champ, un bloc de page par
 *     type), jamais en bloc : `translations::text` ferait trouver « name »
 *     en tapant « name », et `config::text` les couleurs d'une affiche.
 *   - Chaque texte dit OÙ il s'affiche. C'est ce qui permet au résultat de
 *     dire « Description (anglais) » plutôt que « quelque part dans
 *     l'affiche », et au lien d'ouvrir le bon onglet de langue.
 */
import {
  LANGUES_ETRANGERES_RECHERCHE,
  NOMS_LANGUES,
  aplatir,
  couperExtrait,
  evaluer,
  lienRecherche,
  passagesUtiles,
  texteACibler,
  texteDeHtml,
  type ChampEvalue,
  type Classement,
  type Correction,
  type GroupeId,
  type LangueRecherche,
  type Passage,
  type Rang,
  type Requete,
  type ResultatRecherche,
} from "@memoryline/types/recherche";

/* -------------------------------------------------------------------------- */
/*  Les fiches                                                                */
/* -------------------------------------------------------------------------- */

/** L'endroit de l'écran qui montre un texte. */
export interface CibleChamp {
  /** L'écran, sans la base /bo. */
  chemin: string;
  /** Les paramètres que l'écran lit déjà côté serveur (?langue=en, ?stand=3). */
  parametres?: Record<string, string | number>;
  /** L'id d'un élément de la page. */
  ancre?: string;
  /** L'attribut name du champ du formulaire. */
  champ?: string;
  /**
   * Le texte à retrouver à l'arrivée. Absent : le passage trouvé. Une chaîne :
   * ce texte-là (le nom entier d'une pièce, un code). `false` : aucun —
   * l'écran s'ouvre simplement en haut, comme pour un numéro de commande.
   */
  trouver?: string | false;
}

export interface ChampFiche extends ChampEvalue {
  /** « Description (anglais) » ; vide quand le titre du résultat suffit à le dire. */
  libelle: string;
  cible: CibleChamp;
  /** C'est le champ du titre : trouvé là, le résultat n'a pas besoin d'extrait. */
  titre?: boolean;
}

export interface Fiche {
  groupe: GroupeId;
  id: string;
  nature: string;
  titre: string;
  detail: string | null;
  image: string | null;
  /** L'ordre métier de la source, dernier critère du classement. */
  ordre: number;
  champs: ChampFiche[];
  /**
   * Le titre est composé (« Panier de Marie ») sans être un champ : on y
   * surligne quand même ce qui s'y trouve, puisque le nom y figure.
   */
  surlignerTitre?: boolean;
  /** Des mots de plus pour dire ce qu'est l'objet (« facture » pour une commande facturée). */
  motsNature?: string;
}

/**
 * Un rang IMPOSÉ par un chemin à part, plus sûr que le texte : un numéro de
 * commande, une facture, un téléphone, un code de carte, une référence.
 * « web13 » ne se trouve pas dans le texte « WEB-0013 », mais c'est bien
 * cette commande-là qu'on cherche.
 */
export interface Impose {
  rang: Rang;
  /** Ce que dit « ou » ; null quand c'est le titre lui-même. */
  libelle: string | null;
  /** Le texte qui a répondu, montré en extrait et surligné en entier. */
  texte?: string | null;
  cible: CibleChamp;
  /** Le poids pour le classement ; 3 par défaut, celui d'un titre. */
  poids?: number;
  /** Surligner le titre entier (le numéro, le code). */
  titreEntier?: boolean;
}

export interface Trouvaille {
  resultat: ResultatRecherche;
  classement: Classement;
  /** Les corrections qui ont servi à la trouver : ce que le panneau annoncera. */
  approches: Correction[];
}

/**
 * Les mots qu'on tape pour dire CE QU'ON CHERCHE, nature par nature : « stand
 * mulhouse », « page cgv », « promo livraison », « cliente nantes ». Ils
 * forment le champ neutre de chaque fiche (voir ChampEvalue.neutre) : ils
 * aident à trouver, sans jamais faire répondre une fiche à eux seuls.
 */
const MOTS_DES_NATURES: Readonly<Record<string, string>> = {
  Affiche: "affiches produit produits",
  Commande: "commandes",
  "Vente de stand": "ventes stand stands salon commande commandes",
  Panier: "paniers abandonne abandonnes",
  Client: "clients cliente clientes",
  "Inscrit à la lettre": "inscrits inscrite abonne abonnee abonnes lettre newsletter",
  "Carte cadeau": "cartes cadeaux bon",
  Stand: "stands salon",
  Collection: "collections",
  Cadre: "cadres",
  "Type d'affiche": "types modele",
  Décor: "decors fond fonds",
  Personnage: "personnages",
  "Catégorie de personnages": "categories",
  Pièce: "pieces",
  "Catégorie de pièces": "categories",
  "Catégorie de produits": "categories",
  "Bandeau d'annonce": "bandeaux",
  Promotion: "promotions promo promos code remise reduction",
  "Bandeau visuel": "bandeaux visuels banniere",
  "Texte du site": "textes",
  "Courriel de relance": "courriels mail",
  Courrier: "courriers courriel mail",
  Page: "pages",
  "Entrée du menu": "menu",
  Lettre: "lettres newsletter",
  "Mode de livraison": "modes",
  "Zone de livraison": "zones",
  "Style IA": "styles",
  "Consigne IA": "consignes",
  Compte: "comptes",
};

/** Le texte du champ neutre : la nature, ses synonymes, et ce que la fiche y ajoute. */
export function texteNature(nature: string, ajout?: string): string {
  return [nature, MOTS_DES_NATURES[nature], ajout].filter(Boolean).join(" ");
}

/**
 * Tous les mots des natures, pour le vocabulaire : « cliente » ou « promo »
 * tapés ne sont pas des fautes de frappe, même si aucun texte ne les écrit.
 */
export function motsDesNatures(): string[] {
  return Object.keys(MOTS_DES_NATURES).map((n) => texteNature(n, "facture"));
}

/**
 * Les mots des natures d'une source cherchée en base, pour le préfiltre SQL
 * (recherche-direct.ts) : un mot qui peut tomber dans le champ neutre n'y est
 * pas exigé. Écrits ici, à côté des fiches, pour qu'ils ne divergent pas.
 */
export const NATURES_DES_SOURCES = {
  commandes: texteNature("Commande", texteNature("Vente de stand", "facture")),
  paniers: texteNature("Panier"),
  clients: texteNature("Client"),
  inscrits: texteNature("Inscrit à la lettre"),
  cartes: texteNature("Carte cadeau"),
} as const;

/** Les sources cherchées en base : leur préfiltre SQL ne sait pas lire un sigle. */
const SOURCES_EN_BASE: ReadonlySet<GroupeId> = new Set(["commandes", "paniers", "clients", "cartes"]);

/**
 * Les champs tels qu'`evaluer` les reçoit, une fois par fiche (le corpus
 * garde les mêmes fiches cinq minutes) : ceux de la fiche, dans le même ordre
 * — les indices ne bougent pas —, le titre autorisé aux sigles (« cgv ») hors
 * des sources en base, puis le champ neutre de la nature, en dernier.
 */
const EVALUES = new WeakMap<Fiche, ChampFiche[]>();

function champsEvalues(fiche: Fiche): ChampFiche[] {
  let champs = EVALUES.get(fiche);
  if (!champs) {
    const sigles = !SOURCES_EN_BASE.has(fiche.groupe);
    const texte = texteNature(fiche.nature, fiche.motsNature);
    champs = [
      ...fiche.champs.map((c) => (sigles && c.titre ? { ...c, sigles: true } : c)),
      { texte, plat: aplatir(texte), poids: 0, neutre: true, libelle: "", cible: { chemin: "/" } },
    ];
    EVALUES.set(fiche, champs);
  }
  return champs;
}

/** Ordre des natures à l'intérieur d'un groupe partagé, à rang et poids égaux. */
export const ORDRE_SOURCE = 1_000_000;

/**
 * L'avance d'une fiche où les mots tapés se suivent TELS QUELS. Plus grande
 * que tout ordre de source (le plus grand vaut 8 × ORDRE_SOURCE), elle ne
 * départage que des fiches déjà à égalité de rang, de poids et de mots
 * entiers : elle ne fait jamais passer un « contient » devant un « début de
 * mot ».
 */
const AVANCE_EXPRESSION = 1_000_000_000;

/**
 * Les mots tapés se suivent-ils, dans cet ordre, au début d'un mot d'un des
 * champs ?
 *
 * Sans cela, « idée cadeau pour un anniversaire » rangeait à égalité les
 * quinze affiches qui disent exactement cela et les soixante-dix qui ont ces
 * cinq mots éparpillés dans leur description — par ordre alphabétique, donc
 * au hasard pour qui lit. Une phrase recopiée d'un texte, c'est ce texte-là
 * qu'on cherche. Un seul mot n'est pas une expression : rien ne change pour
 * lui.
 */
function expressionEntiere(fiche: Fiche, requete: Requete): boolean {
  if (requete.jetons.length < 2 || !requete.plat) return false;
  return fiche.champs.some((c) => {
    const plat = c.plat ?? aplatir(c.texte);
    if (c.minimum !== undefined && requete.plat.length < c.minimum) return false;
    let p = plat.indexOf(requete.plat);
    while (p > 0 && plat.charCodeAt(p - 1) !== 32) p = plat.indexOf(requete.plat, p + 1);
    return p !== -1;
  });
}

/* -------------------------------------------------------------------------- */
/*  Petits outils                                                             */
/* -------------------------------------------------------------------------- */

function champ(
  texte: string | null | undefined,
  poids: number,
  libelle: string,
  cible: CibleChamp,
  options: { titre?: boolean; minimum?: number } = {},
): ChampFiche | null {
  const t = (texte ?? "").trim();
  if (!t) return null;
  const c: ChampFiche = { texte: t, plat: aplatir(t), poids, libelle, cible };
  if (options.titre) c.titre = true;
  if (options.minimum !== undefined) c.minimum = options.minimum;
  return c;
}

/**
 * La cible du TITRE d'une fiche — un écran qui ne montre qu'un objet :
 * l'écran s'ouvre simplement en haut, sans rien chercher (contrat D, « sans
 * fragment : titre, numéro, nom d'écran »). On y voit déjà le nom en tête ;
 * le sélectionner dans son champ prenait le focus, et la barre oblique ne
 * menait plus à la recherche. Les écrans-LISTES (cadres, décors, stands…)
 * gardent, eux, leur ancre : il faut y retrouver la bonne ligne.
 */
function enHaut(chemin: string, parametres?: Record<string, string | number>): CibleChamp {
  return parametres ? { chemin, parametres, trouver: false } : { chemin, trouver: false };
}

function garder(...champs: (ChampFiche | null | (ChampFiche | null)[])[]): ChampFiche[] {
  return champs.flat().filter((c): c is ChampFiche => c !== null);
}

function objet(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function chaine(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v : null;
}

/** translations[langue][cle], seulement si c'est un texte. */
function traduction(translations: unknown, langue: string, cle: string): string | null {
  return chaine(objet(objet(translations)?.[langue])?.[cle]);
}

/** Les chaînes d'une colonne JSON qui est un tableau de chaînes (étiquettes). */
function chaines(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && !!x.trim()) : [];
}

const enLangue = (libelle: string, langue: LangueRecherche): string =>
  `${libelle} (${NOMS_LANGUES[langue]})`;

/** Sans doublons, dans l'ordre : deux variantes au même SKU ne font qu'un texte. */
function distincts(valeurs: (string | null | undefined)[]): string[] {
  return [...new Set(valeurs.map((v) => (v ?? "").trim()).filter(Boolean))];
}

/** « 49,90 € », « 30 € ». */
export function euros(cents: number): string {
  const montant = cents / 100;
  const texte = cents % 100 === 0 ? String(montant) : montant.toFixed(2).replace(".", ",");
  return `${texte} €`;
}

/**
 * Le fuseau de la boutique, écrit en toutes lettres : la date d'une commande
 * passée à 1 h du matin est celle du jour à Paris, quel que soit le fuseau de
 * la machine — et la base la calcule de la même façon (recherche-direct.ts).
 */
const FUSEAU = "Europe/Paris";

/** « 12/03/2026 » : compact, c'est une seconde ligne, pas une fiche. */
export function jour(quand: Date): string {
  return quand.toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: FUSEAU,
  });
}

/** « 12/03/2026 12 mars 2026 » : les deux façons de taper une date. */
export function dateCherchable(quand: Date): string {
  const lettres = quand.toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: FUSEAU,
  });
  return `${jour(quand)} ${lettres}`;
}

/** Assemble les morceaux d'une seconde ligne, en sautant ceux qui manquent. */
export function ligneDetail(...morceaux: (string | null | undefined | false)[]): string | null {
  const t = morceaux.filter((m): m is string => !!m).join(" · ");
  return t || null;
}

const parNom = (a: string, b: string): number =>
  a.localeCompare(b, "fr", { sensitivity: "base", numeric: true });

/* -------------------------------------------------------------------------- */
/*  D'une fiche à un résultat                                                 */
/* -------------------------------------------------------------------------- */

/** Le lien d'un champ, avec le passage à retrouver. */
function lienDuChamp(cible: CibleChamp, trouve: string | undefined): string {
  const trouver = cible.trouver === false ? undefined : (cible.trouver ?? trouve);
  return lienRecherche(
    cible.chemin,
    { trouver, ancre: cible.ancre, champ: cible.champ },
    cible.parametres,
  );
}

/** Ce que la saisie touche dans un texte qui n'est pas un champ (un titre composé). */
function surligner(texte: string, requete: Requete): Passage[] {
  const passages: Passage[] = [];
  for (const jeton of requete.jetons) {
    const ev = evaluer([{ texte, poids: 1 }], { ...requete, plat: "", jetons: [jeton] });
    if (ev) passages.push(...(ev.passages[0] ?? []));
  }
  return passages.sort((a, b) => a.debut - b.debut);
}

/**
 * Une fiche évaluée contre la saisie, ou null si elle ne répond pas.
 *
 * Trouvée dans son titre, elle n'a pas d'extrait : on lit déjà le titre,
 * surligné. Trouvée ailleurs, elle dit où (« ou ») et montre le passage.
 */
export function versResultat(
  fiche: Fiche,
  requete: Requete,
  impose?: Impose | null,
): Trouvaille | null {
  // Le champ neutre en dernier : les indices des vrais champs ne bougent pas.
  const ev = evaluer(champsEvalues(fiche), requete);
  const iTitre = fiche.champs.findIndex((c) => c.titre);
  let titrePassages: Passage[] = ev && iTitre >= 0 ? (ev.passages[iTitre] ?? []) : [];
  if (!titrePassages.length && fiche.surlignerTitre)
    titrePassages = surligner(fiche.titre, requete);

  if (impose && (!ev || impose.rang < ev.rang)) {
    const texte = impose.texte?.trim() || null;
    return {
      resultat: {
        id: fiche.id,
        nature: fiche.nature,
        titre: fiche.titre,
        titrePassages: impose.titreEntier
          ? [{ debut: 0, fin: fiche.titre.length }]
          : titrePassages,
        ou: impose.libelle,
        detail: fiche.detail,
        extrait: texte ? couperExtrait(texte, [{ debut: 0, fin: texte.length }]) : null,
        href: lienDuChamp(impose.cible, texte ?? undefined),
        image: fiche.image,
        rang: impose.rang,
      },
      classement: {
        rang: impose.rang,
        poids: impose.poids ?? 3,
        motsEntiers: ev?.motsEntiers ?? requete.jetons.length,
        ordre: fiche.ordre,
      },
      approches: [],
    };
  }
  if (!ev) return null;

  const meilleur = fiche.champs[ev.meilleur]!;
  const passages = ev.passages[ev.meilleur] ?? [];
  const dansLeTitre = !!meilleur.titre;
  // Le dernier critère de `comparer` est l'ordre de la source : c'est là, et
  // seulement là, que l'expression entière prend l'avance (voir plus haut).
  const ordre = fiche.ordre - (expressionEntiere(fiche, requete) ? AVANCE_EXPRESSION : 0);
  return {
    resultat: {
      id: fiche.id,
      nature: fiche.nature,
      titre: fiche.titre,
      titrePassages,
      ou: dansLeTitre ? null : meilleur.libelle || null,
      detail: fiche.detail,
      // L'extrait se centre sur un passage qui dit quelque chose, et le lien
      // n'emmène jamais chercher un « de » (voir texteACibler).
      extrait: dansLeTitre ? null : couperExtrait(meilleur.texte, passagesUtiles(passages)),
      href: lienDuChamp(meilleur.cible, texteACibler(meilleur.texte, passages) || undefined),
      image: fiche.image,
      rang: ev.rang,
    },
    classement: {
      rang: ev.rang,
      poids: ev.poids,
      motsEntiers: ev.motsEntiers,
      ordre,
    },
    approches: ev.approches ?? [],
  };
}

/* -------------------------------------------------------------------------- */
/*  Affiches                                                                  */
/* -------------------------------------------------------------------------- */

export interface LigneAffiche {
  id: number;
  name: string;
  slug: string;
  description: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
  defaultTitle: string | null;
  defaultSubtitle: string | null;
  defaultLine3: string | null;
  vendor: string | null;
  productType: string | null;
  tags: unknown;
  aiStylePrompt: string | null;
  status: string;
  basePriceCents: number;
  translations: unknown;
  /** L'adresse de la page sur l'ancienne boutique Shopify (redirigée en 301). */
  legacySlug?: string | null;
}

/** Les images d'une affiche, déjà triées par position puis par id. */
export interface LigneImageAffiche {
  productId: number;
  url: string;
  alt: string | null;
}

export interface LigneVarianteAffiche {
  productId: number;
  priceCents: number;
  sku: string | null;
  barcode: string | null;
}

/** Ce que la propriétaire lit dans la liste des affiches. */
const ETAT_AFFICHE: Record<string, string> = {
  active: "Actif",
  draft: "Désactivé",
  archived: "Archivé",
};

export function fichesAffiches(
  produits: readonly LigneAffiche[],
  images: readonly LigneImageAffiche[],
  variantes: readonly LigneVarianteAffiche[],
): Fiche[] {
  const imagesPar = new Map<number, LigneImageAffiche[]>();
  for (const i of images) imagesPar.set(i.productId, [...(imagesPar.get(i.productId) ?? []), i]);
  const variantesPar = new Map<number, LigneVarianteAffiche[]>();
  for (const v of variantes)
    variantesPar.set(v.productId, [...(variantesPar.get(v.productId) ?? []), v]);

  // Par ordre alphabétique : on cherche une affiche dont on connaît le nom,
  // pas la dernière créée.
  const tries = [...produits].sort((a, b) => parNom(a.name, b.name) || a.id - b.id);
  return tries.map((p, ordre) => {
    const chemin = `/produits/${p.id}`;
    const ici = (ancre: string, champ?: string): CibleChamp => ({ chemin, ancre, champ });
    const imgs = imagesPar.get(p.id) ?? [];
    const vars = variantesPar.get(p.id) ?? [];

    const traductions = LANGUES_ETRANGERES_RECHERCHE.flatMap((l) => [
      champ(traduction(p.translations, l, "name"), 2, enLangue("Nom", l), ici(`langue-${l}`, "name")),
      champ(
        texteDeHtml(traduction(p.translations, l, "description") ?? ""),
        1,
        enLangue("Description", l),
        ici(`langue-${l}`, "description"),
      ),
      champ(
        traduction(p.translations, l, "seoTitle"),
        1,
        enLangue("Titre Google", l),
        ici(`langue-${l}`, "seoTitle"),
      ),
      champ(
        traduction(p.translations, l, "seoDescription"),
        1,
        enLangue("Description Google", l),
        ici(`langue-${l}`, "seoDescription"),
      ),
    ]);

    // Le prix comme dans la liste : la fourchette des formats, sinon le prix
    // de base quand il n'y a pas encore de format.
    const prix = vars.map((v) => v.priceCents);
    const min = prix.length ? Math.min(...prix) : null;
    const max = prix.length ? Math.max(...prix) : null;
    const libellePrix =
      min !== null && max !== null
        ? min === max
          ? euros(min)
          : `de ${euros(min)} à ${euros(max)}`
        : p.basePriceCents > 0
          ? euros(p.basePriceCents)
          : null;

    return {
      groupe: "affiches",
      id: `produit:${p.id}`,
      nature: "Affiche",
      titre: p.name,
      detail: ligneDetail(ETAT_AFFICHE[p.status] ?? p.status, libellePrix),
      // La première image est celle de position la plus basse : c'est l'image
      // principale, celle qui illustre déjà l'affiche en boutique.
      image: imgs[0]?.url ?? null,
      ordre,
      champs: garder(
        champ(p.name, 3, "Nom", enHaut(chemin), { titre: true }),
        champ(p.slug, 1, "Adresse de la page", ici("referencement", "slug")),
        // L'ancienne adresse ne s'affiche nulle part : un lien reçu d'une
        // cliente (une page de l'ancien site) mène quand même à la fiche.
        champ(p.legacySlug, 1, "Ancienne adresse (Shopify)", enHaut(chemin)),
        champ(texteDeHtml(p.description ?? ""), 1, "Description", ici("infos", "description")),
        champ(p.seoTitle, 1, "Titre Google", ici("referencement", "seoTitle")),
        champ(p.seoDescription, 1, "Description Google", ici("referencement", "seoDescription")),
        champ(p.defaultTitle, 1, "Texte pré-rempli : titre", ici("textes-preremplis", "defaultTitle")),
        champ(
          p.defaultSubtitle,
          1,
          "Texte pré-rempli : sous-titre",
          ici("textes-preremplis", "defaultSubtitle"),
        ),
        champ(p.defaultLine3, 1, "Texte pré-rempli : 3e ligne", ici("textes-preremplis", "defaultLine3")),
        champ(p.vendor, 1, "Fabricant", ici("organisation", "vendor")),
        champ(p.productType, 1, "Type de produit", ici("organisation", "productType")),
        // Une étiquette par champ : « à refaire » tapé en entier est alors
        // une correspondance exacte, et c'est elle qu'on retrouve à l'écran,
        // dans sa pastille.
        chaines(p.tags).map((t) => champ(t, 1, "Étiquettes", ici("organisation"))),
        champ(p.aiStylePrompt, 1, "Consigne de style IA", ici("generation-ia", "aiStylePrompt")),
        distincts(imgs.map((i) => i.alt)).map((a) =>
          champ(a, 1, "Texte alternatif d'une image", ici("images")),
        ),
        distincts(vars.map((v) => v.sku)).map((s) =>
          champ(s, 1, "Référence (SKU)", ici("formats", "varianteSku")),
        ),
        distincts(vars.map((v) => v.barcode)).map((b) =>
          champ(b, 1, "Code-barres", ici("formats", "varianteCodeBarres")),
        ),
        traductions,
      ),
    };
  });
}

/* -------------------------------------------------------------------------- */
/*  Collections                                                               */
/* -------------------------------------------------------------------------- */

export interface LigneCollection {
  id: number;
  name: string;
  slug: string;
  description: string | null;
  translations: unknown;
  active: boolean;
  archivedAt: Date | null;
  /** Combien d'affiches elle range. */
  affiches: number;
}

/** Les collections, dans l'ordre de leur écran (ordreDesCollections). */
export function fichesCollections(collections: readonly LigneCollection[]): Fiche[] {
  return collections.map((c, ordre) => {
    const chemin = `/collections/${c.id}`;
    const ici = (ancre: string, champ?: string): CibleChamp => ({ chemin, ancre, champ });
    return {
      groupe: "collections",
      id: `collection:${c.id}`,
      nature: "Collection",
      titre: c.name,
      detail: ligneDetail(
        c.affiches === 0 ? "Aucune affiche" : `${c.affiches} affiche${c.affiches > 1 ? "s" : ""}`,
        // Une collection archivée reste trouvable : on la cherche justement
        // pour la restaurer. Elle se dit, plutôt que de se cacher.
        c.archivedAt ? "Archivée" : c.active ? null : "Désactivée",
      ),
      image: null,
      ordre,
      champs: garder(
        champ(c.name, 3, "Nom", enHaut(chemin), { titre: true }),
        champ(c.slug, 1, "Adresse", ici("infos")),
        // La description française se lit au back-office sans s'y modifier :
        // elle est repliée sous chaque langue, dans « Voir la description
        // française ». Le script d'arrivée ouvre ce repli tout seul.
        champ(
          texteDeHtml(c.description ?? ""),
          1,
          "Description (français, visible dans Voir la description française)",
          ici("langue-en"),
        ),
        LANGUES_ETRANGERES_RECHERCHE.flatMap((l) => [
          champ(traduction(c.translations, l, "name"), 2, enLangue("Nom", l), ici(`langue-${l}`, "name")),
          champ(
            texteDeHtml(traduction(c.translations, l, "description") ?? ""),
            1,
            enLangue("Description", l),
            ici(`langue-${l}`, "description"),
          ),
        ]),
      ),
    };
  });
}

/* -------------------------------------------------------------------------- */
/*  Atelier : cadres, types, décors, personnages, pièces, catégories          */
/* -------------------------------------------------------------------------- */

/** Les natures de l'atelier, dans l'ordre où elles se rangent à égalité. */
const RANG_ATELIER = {
  cadre: 0,
  type: 1,
  decor: 2,
  personnage: 3,
  categoriePersonnages: 4,
  piece: 5,
  categoriePieces: 6,
  categorieProduits: 7,
} as const;

/** Les noms traduits d'un objet, vers un tableau « Traductions » de son écran. */
function nomsTraduits(
  translations: unknown,
  chemin: string,
  ancre: string,
  idCase: string | number,
  cle = "name",
  libelle = "Nom",
): (ChampFiche | null)[] {
  return LANGUES_ETRANGERES_RECHERCHE.map((l) =>
    champ(traduction(translations, l, cle), 2, enLangue(libelle, l), {
      chemin,
      ancre,
      champ: `tr-${idCase}-${cle}-${l}`,
    }),
  );
}

export interface LigneCadre {
  id: number;
  name: string;
  translations: unknown;
  active: boolean;
  archivedAt: Date | null;
}

export function fichesCadres(cadres: readonly LigneCadre[]): Fiche[] {
  return cadres.map((c, i) => ({
    groupe: "atelier",
    id: `cadre:${c.id}`,
    nature: "Cadre",
    titre: c.name,
    detail: c.archivedAt ? "Archivé" : c.active ? null : "Désactivé",
    image: null,
    ordre: RANG_ATELIER.cadre * ORDRE_SOURCE + i,
    champs: garder(
      // L'ancre est la LIGNE : les champs portent form=cadre-{id}, mais le
      // formulaire lui-même ne vit que dans la dernière cellule.
      champ(c.name, 3, "Nom", { chemin: "/cadres", ancre: `ligne-cadre-${c.id}`, champ: "name" }, { titre: true }),
      nomsTraduits(c.translations, "/cadres", "traductions-cadres", c.id),
    ),
  }));
}

export interface LigneTypeAffiche {
  id: number;
  name: string;
  archivedAt: Date | null;
}

export function fichesTypesAffiche(types: readonly LigneTypeAffiche[]): Fiche[] {
  return types.map((t, i) => ({
    groupe: "atelier",
    id: `type:${t.id}`,
    nature: "Type d'affiche",
    titre: t.name,
    detail: t.archivedAt ? "Archivé" : null,
    image: null,
    ordre: RANG_ATELIER.type * ORDRE_SOURCE + i,
    champs: garder(
      champ(
        t.name,
        3,
        "Nom",
        { chemin: "/types-affiche", ancre: `ligne-type-${t.id}`, champ: "name" },
        { titre: true },
      ),
    ),
  }));
}

export interface LigneDecor {
  id: number;
  name: string | null;
  productId: number | null;
  productName: string | null;
  archivedAt: Date | null;
}

export function fichesDecors(decors: readonly LigneDecor[]): Fiche[] {
  const fiches: Fiche[] = [];
  decors.forEach((d, i) => {
    if (!d.name?.trim()) return;
    // L'écran des décors ne montre que ceux que le configurateur propose : un
    // décor archivé n'y est plus. Il vit sur la fiche de son affiche, dans
    // « Visuels archivés » — c'est là qu'il faut l'ouvrir.
    const cible: CibleChamp =
      d.archivedAt && d.productId
        ? { chemin: `/produits/${d.productId}`, ancre: "visuels" }
        : {
            chemin: "/decors",
            // Le filtre de l'écran retrouve le nom EXACT tel qu'il est en base :
            // le décor est seul (ou presque) dans la liste à l'arrivée.
            parametres: { q: d.name },
            ancre: `decor-${d.id}`,
            champ: "nom",
          };
    fiches.push({
      groupe: "atelier",
      id: `decor:${d.id}`,
      nature: "Décor",
      titre: d.name,
      detail: ligneDetail(d.productName, d.archivedAt ? "Archivé" : null),
      image: null,
      ordre: RANG_ATELIER.decor * ORDRE_SOURCE + i,
      champs: garder(champ(d.name, 3, "Nom du décor", cible, { titre: true })),
    });
  });
  return fiches;
}

export interface LignePersonnage {
  id: number;
  name: string;
  translations: unknown;
  categoryName: string | null;
  archivedAt: Date | null;
  /** base_groupes_couleurs : les couleurs que le client peut changer, et leur nom (« Robe », « Pelage »). */
  groupesCouleurs?: unknown;
}

/** Les noms des groupes de couleurs (`[{ nom: "Robe", … }]`), sans doublon. */
function nomsDesGroupes(groupes: unknown): string[] {
  if (!Array.isArray(groupes)) return [];
  return distincts(groupes.map((g) => chaine(objet(g)?.nom)));
}

export function fichesPersonnages(personnages: readonly LignePersonnage[]): Fiche[] {
  return personnages.map((p, i) => ({
    groupe: "atelier",
    id: `personnage:${p.id}`,
    nature: "Personnage",
    titre: p.name,
    detail: ligneDetail(p.categoryName, p.archivedAt ? "Archivé" : null),
    image: null,
    ordre: RANG_ATELIER.personnage * ORDRE_SOURCE + i,
    champs: garder(
      champ(p.name, 3, "Nom", enHaut(`/personnages/${p.id}`), { titre: true }),
      // Le nom que le client lit au-dessus des pastilles. Les cases de ce bloc
      // sont fabriquées par un script : on mène au bloc, sans rien y chercher.
      nomsDesGroupes(p.groupesCouleurs).map((g) =>
        champ(g, 1, "Couleurs que le client peut changer", {
          chemin: `/personnages/${p.id}`,
          ancre: "couleurs",
          trouver: false,
        }),
      ),
      // Les traductions vivent sur la LISTE, qui porte aussi celles des
      // catégories avec des numéros communs (tr-3-name-en existe pour les
      // deux) : l'ancre du bon tableau est indispensable.
      nomsTraduits(p.translations, "/personnages", "traductions-personnages", p.id),
    ),
  }));
}

export interface LigneCategoriePersonnages {
  id: number;
  name: string;
  translations: unknown;
  archivedAt: Date | null;
}

export function fichesCategoriesPersonnages(
  categories: readonly LigneCategoriePersonnages[],
): Fiche[] {
  return categories.map((c, i) => ({
    groupe: "atelier",
    id: `categorie-personnages:${c.id}`,
    nature: "Catégorie de personnages",
    titre: c.name,
    detail: c.archivedAt ? "Archivée" : null,
    image: null,
    ordre: RANG_ATELIER.categoriePersonnages * ORDRE_SOURCE + i,
    champs: garder(
      champ(
        c.name,
        3,
        "Nom",
        { chemin: "/personnages", ancre: `categorie-${c.id}`, champ: "name" },
        { titre: true },
      ),
      nomsTraduits(c.translations, "/personnages", "traductions-categories", c.id),
    ),
  }));
}

/** Les emplacements, comme l'écran des personnages les nomme. */
const EMPLACEMENTS: Record<string, string> = {
  clothes: "Vêtements",
  pants: "Pantalon",
  hair: "Coupes",
  accessory: "Accessoires",
};

export interface LignePiece {
  id: number;
  name: string | null;
  slot: string;
  categoryName: string | null;
  archivedAt: Date | null;
  /** groupes_couleurs : les couleurs que le client peut changer sur la pièce, et leur nom. */
  groupesCouleurs?: unknown;
}

export function fichesPieces(pieces: readonly LignePiece[]): Fiche[] {
  const fiches: Fiche[] = [];
  pieces.forEach((p, i) => {
    if (!p.name?.trim()) return;
    const emplacement = EMPLACEMENTS[p.slot] ?? p.slot;
    fiches.push({
      groupe: "atelier",
      id: `piece:${p.id}`,
      nature: "Pièce",
      titre: p.name,
      detail: ligneDetail(
        emplacement,
        // « Coupes · Coupes » ne dirait rien de plus : la catégorie ne
        // s'écrit que si elle précise l'emplacement.
        p.categoryName && aplatir(p.categoryName) !== aplatir(emplacement) ? p.categoryName : null,
        p.archivedAt ? "Archivée" : null,
      ),
      image: null,
      ordre: RANG_ATELIER.piece * ORDRE_SOURCE + i,
      champs: garder(
        // La pièce s'affiche en TEXTE dans sa section : pas de champ, et le
        // nom entier à retrouver, pour tomber sur la bonne « Hair 3 » parmi
        // ses homonymes grâce à l'ancre.
        champ(
          p.name,
          3,
          "Nom de la pièce",
          { chemin: "/personnages", ancre: `piece-${p.id}`, trouver: p.name },
          { titre: true },
        ),
        // Les noms de ses couleurs (« Robe », « Rayures ») : leurs cases sont
        // fabriquées par un script, on mène à la ligne de la pièce.
        nomsDesGroupes(p.groupesCouleurs).map((g) =>
          champ(g, 1, "Couleurs que le client peut changer", {
            chemin: "/personnages",
            ancre: `piece-${p.id}`,
            trouver: false,
          }),
        ),
      ),
    });
  });
  return fiches;
}

export interface LigneCategoriePieces {
  id: number;
  name: string;
  archivedAt: Date | null;
}

export function fichesCategoriesPieces(categories: readonly LigneCategoriePieces[]): Fiche[] {
  return categories.map((c, i) => ({
    groupe: "atelier",
    id: `categorie-pieces:${c.id}`,
    nature: "Catégorie de pièces",
    titre: c.name,
    detail: c.archivedAt ? "Archivée" : null,
    image: null,
    ordre: RANG_ATELIER.categoriePieces * ORDRE_SOURCE + i,
    champs: garder(
      champ(
        c.name,
        3,
        "Nom",
        { chemin: "/categories-pieces", ancre: `ligne-categorie-${c.id}`, champ: "name" },
        { titre: true },
      ),
    ),
  }));
}

export interface LigneCategorieProduits {
  id: number;
  name: string;
  description: string | null;
  archivedAt: Date | null;
}

/** La table abandonnée : vide, mais son écran existe encore. */
export function fichesCategoriesProduits(
  categories: readonly LigneCategorieProduits[],
): Fiche[] {
  return categories.map((c, i) => {
    const ici = (champNom: string): CibleChamp => ({
      chemin: "/categories-produits",
      ancre: `ligne-categorie-${c.id}`,
      champ: champNom,
    });
    return {
      groupe: "atelier",
      id: `categorie-produits:${c.id}`,
      nature: "Catégorie de produits",
      titre: c.name,
      detail: c.archivedAt ? "Archivée" : null,
      image: null,
      ordre: RANG_ATELIER.categorieProduits * ORDRE_SOURCE + i,
      champs: garder(
        champ(c.name, 3, "Nom", ici("name"), { titre: true }),
        champ(c.description, 1, "Description", ici("description")),
      ),
    };
  });
}

/* -------------------------------------------------------------------------- */
/*  Stands                                                                    */
/* -------------------------------------------------------------------------- */

export interface LigneStand {
  id: number;
  nom: string;
  ouvert: boolean;
  archivedAt: Date | null;
}

/**
 * Les stands, par leur NOM seulement. Le code d'accès n'arrive jamais
 * jusqu'ici : il n'est pas dans les lignes reçues, faute d'avoir été lu.
 */
export function fichesStands(stands: readonly LigneStand[]): Fiche[] {
  // Les stands ouverts d'abord : ce sont eux dont on s'occupe.
  const tries = [...stands].sort(
    (a, b) => Number(b.ouvert) - Number(a.ouvert) || parNom(a.nom, b.nom),
  );
  return tries.map((s, ordre) => ({
    groupe: "stands",
    id: `stand:${s.id}`,
    nature: "Stand",
    titre: s.nom,
    // Un stand archivé reste trouvable : on le cherche justement pour relire
    // ce qu'il a vendu, ou pour le restaurer avant le salon de l'an prochain.
    detail: s.archivedAt ? "Archivé" : s.ouvert ? "Ouvert" : "Fermé",
    image: null,
    ordre,
    champs: garder(
      champ(
        s.nom,
        3,
        "Nom",
        { chemin: "/ventes-salon", parametres: { stand: s.id }, ancre: `stand-${s.id}` },
        { titre: true },
      ),
    ),
  }));
}

/* -------------------------------------------------------------------------- */
/*  Boutique en ligne                                                         */
/* -------------------------------------------------------------------------- */

const RANG_BOUTIQUE = {
  bandeau: 0,
  bandeauVisuel: 1,
  promotion: 2,
  page: 3,
  menu: 4,
  texte: 5,
  relance: 6,
  lettre: 7,
  courrier: 8,
} as const;

export interface LigneBandeauAnnonce {
  id: number;
  message: string;
  linkLabel: string | null;
  translations: unknown;
  active: boolean;
}

/**
 * Les messages du bandeau d'annonce, tous ceux qui ne sont pas archivés, dans
 * l'ordre du défilement : l'écran les montre tous, en ligne ou éteints.
 * Chacun mène à sa ligne (#message-<id>), et ses traductions à leur case du
 * bloc « Traductions des messages ».
 */
export function fichesBandeauAnnonce(messages: readonly LigneBandeauAnnonce[]): Fiche[] {
  return messages.map((b, i) => {
    const ligne: CibleChamp = { chemin: "/bandeau", ancre: `message-${b.id}` };
    const traduction_ = (l: string, champNom: string): CibleChamp => ({
      chemin: "/bandeau",
      ancre: "traductions-bandeau",
      champ: `tr-${b.id}-${champNom}-${l}`,
    });
    return {
      groupe: "boutique",
      id: `bandeau:${b.id}`,
      nature: "Bandeau d'annonce",
      titre: b.message,
      detail: b.active ? null : "Éteint",
      image: null,
      ordre: RANG_BOUTIQUE.bandeau * ORDRE_SOURCE + i,
      champs: garder(
        // Le message et le bouton s'affichent en TEXTE dans la liste.
        champ(b.message, 2, "Message", ligne, { titre: true }),
        champ(b.linkLabel, 1, "Texte du bouton", ligne),
        LANGUES_ETRANGERES_RECHERCHE.flatMap((l) => [
          champ(traduction(b.translations, l, "message"), 2, enLangue("Message", l), traduction_(l, "message")),
          champ(traduction(b.translations, l, "linkLabel"), 1, enLangue("Texte du bouton", l), traduction_(l, "linkLabel")),
        ]),
      ),
    };
  });
}

export interface LignePromotion {
  id: number;
  name: string;
  code: string | null;
  translations: unknown;
  active: boolean;
  /** Non nul = archivée : elle reste trouvable, rangée dans « Promotions archivées ». */
  archivedAt?: Date | null;
}

export function fichesPromotions(promos: readonly LignePromotion[]): Fiche[] {
  return promos.map((p, i) => {
    // Le nom et le code s'affichent en TEXTE dans le tableau : pas de champ.
    // Une promotion archivée a sa ligne, sous la même ancre, dans la section
    // des archivées : on la cherche pour la relire ou la restaurer.
    const ligne: CibleChamp = { chemin: "/promotions", ancre: `promo-${p.id}` };
    return {
      groupe: "boutique",
      id: `promotion:${p.id}`,
      nature: "Promotion",
      titre: p.name,
      detail: ligneDetail(
        p.code ? `Code ${p.code}` : "Sans code",
        p.archivedAt ? "Archivée" : p.active ? "Active" : "Inactive",
      ),
      image: null,
      ordre: RANG_BOUTIQUE.promotion * ORDRE_SOURCE + i,
      champs: garder(
        champ(p.name, 3, "Nom", ligne, { titre: true }),
        // Le code est public — c'est ce que la cliente tape au panier.
        champ(p.code, 2, "Code", ligne),
        nomsTraduits(p.translations, "/promotions", "traductions-promotions", p.id),
      ),
    };
  });
}

/** Un bandeau visuel tel que @memoryline/types/bandeaux-visuels le lit. */
export interface LigneBandeauVisuel {
  id: string;
  nom: string;
  titre: string;
  texte: string;
  bouton: string;
  alt: string;
  translations: unknown;
  /** L'état déjà mis en mots : « En ligne », « Archivé »… */
  etat: string | null;
}

/**
 * Les textes d'un bandeau visuel, et ceux qui se traduisent. Ce sont les
 * mêmes que CHAMPS_TRADUITS_BANDEAU (@memoryline/types/bandeaux-visuels),
 * recopiés pour que ce fichier reste pur ; un essai vérifie qu'ils ne
 * divergent pas le jour où un champ traduit s'ajoute.
 */
export const CHAMPS_BANDEAU_VISUEL = [
  { cle: "titre", libelle: "Titre", poids: 2 },
  { cle: "texte", libelle: "Texte", poids: 1 },
  { cle: "bouton", libelle: "Bouton", poids: 1 },
  { cle: "alt", libelle: "Description de l'image", poids: 1 },
] as const;

export function fichesBandeauxVisuels(bandeaux: readonly LigneBandeauVisuel[]): Fiche[] {
  return bandeaux.map((b, i) => {
    const chemin = `/bandeaux-visuels/${encodeURIComponent(b.id)}`;
    return {
      groupe: "boutique",
      id: `bandeau-visuel:${b.id}`,
      nature: "Bandeau visuel",
      titre: b.nom.trim() || b.titre.trim() || "Bandeau sans nom",
      detail: b.etat,
      image: null,
      ordre: RANG_BOUTIQUE.bandeauVisuel * ORDRE_SOURCE + i,
      champs: garder(
        champ(b.nom, 3, "Nom", enHaut(chemin), { titre: true }),
        CHAMPS_BANDEAU_VISUEL.map((c) =>
          champ(b[c.cle], c.poids, c.libelle, { chemin, ancre: "bv-formulaire", champ: c.cle }),
        ),
        LANGUES_ETRANGERES_RECHERCHE.flatMap((l) =>
          CHAMPS_BANDEAU_VISUEL.map((c) =>
            champ(traduction(b.translations, l, c.cle), c.poids, enLangue(c.libelle, l), {
              chemin,
              ancre: "traductions-bandeau-visuel",
              champ: `tr-${b.id}-${c.cle}-${l}`,
            }),
          ),
        ),
      ),
    };
  });
}

/**
 * Les textes de l'écran « Accueil et pied de page » (/contenu), et leurs
 * libellés tels que l'écran les écrit (SECTIONS de contenu.astro).
 *
 * Une liste BLANCHE, et c'est délibéré : la table des réglages contient aussi
 * des secrets (le code d'accès du stand) et des réglages techniques. On ne la
 * lit jamais en entier, ni par motif : seulement ces clés-là.
 *
 * Restent dehors, à dessein, des réglages qui n'ont plus d'écran :
 * home.hero.*, home.encart.* (devenu le premier bandeau visuel) et
 * configurateur.video.texte. Les chercher mènerait à un écran qui ne les
 * montre pas.
 */
const TEXTES_DU_SITE: Readonly<Record<string, { section: string; champ: string }>> = {
  "configurateur.video.titre": {
    section: "Personnalisation — vidéo explicative",
    champ: "Titre de la pop-up vidéo",
  },
  "home.vitrine.title": { section: "Accueil — les affiches", champ: "Titre de la section" },
  "home.vitrine.subtitle": { section: "Accueil — les affiches", champ: "Texte d'introduction" },
  "home.ia.title": { section: "Accueil — l'affiche à partir d'une photo", champ: "Titre" },
  "home.ia.text": { section: "Accueil — l'affiche à partir d'une photo", champ: "Texte" },
  "home.ia.cta": { section: "Accueil — l'affiche à partir d'une photo", champ: "Libellé du bouton" },
  "home.newsletter.title": { section: "Accueil — lettre d'information", champ: "Intitulé" },
  "footer.baseline": { section: "Pied de page", champ: "Baseline" },
};

export const CLES_TEXTES_DU_SITE: readonly string[] = Object.keys(TEXTES_DU_SITE);

const VERSIONS: Record<(typeof LANGUES_ETRANGERES_RECHERCHE)[number], string> = {
  en: "Version anglaise",
  de: "Version allemande",
  it: "Version italienne",
  es: "Version espagnole",
};

export interface LigneReglage {
  key: string;
  value: unknown;
}

/**
 * Un réglage de /contenu : une CHAÎNE est du français (la forme d'avant les
 * traductions), un dictionnaire { fr, en, … } porte chaque langue.
 */
export function fichesTextesDuSite(reglages: readonly LigneReglage[]): Fiche[] {
  const fiches: Fiche[] = [];
  CLES_TEXTES_DU_SITE.forEach((cle, i) => {
    const libelles = TEXTES_DU_SITE[cle]!;
    const valeur = reglages.find((r) => r.key === cle)?.value;
    if (valeur === undefined) return;
    const parLangue = objet(valeur);
    const texteEn = (l: LangueRecherche): string | null =>
      typeof valeur === "string" ? (l === "fr" ? chaine(valeur) : null) : chaine(parLangue?.[l]);
    const champs = garder(
      champ(texteEn("fr"), 1, "", { chemin: "/contenu", champ: `${cle}@fr` }),
      LANGUES_ETRANGERES_RECHERCHE.map((l) =>
        champ(texteEn(l), 1, VERSIONS[l], { chemin: "/contenu", champ: `${cle}@${l}` }),
      ),
    );
    if (!champs.length) return;
    fiches.push({
      groupe: "boutique",
      id: `texte:${cle}`,
      nature: "Texte du site",
      titre: `${libelles.section} — ${libelles.champ}`,
      detail: null,
      image: null,
      ordre: RANG_BOUTIQUE.texte * ORDRE_SOURCE + i,
      champs,
    });
  });
  return fiches;
}

/** Les quinze clés des courriels de relance réécrits : 3 relances × 5 langues. */
export const CLES_COURRIELS_RELANCE: readonly string[] = [1, 2, 3].flatMap((n) => [
  `relance.courrier_${n}`,
  ...LANGUES_ETRANGERES_RECHERCHE.map((l) => `relance.courrier_${n}.${l}`),
]);

const CHAMPS_RELANCE = [
  { cle: "objet", libelle: "Objet", poids: 2 },
  { cle: "accroche", libelle: "Accroche", poids: 1 },
  { cle: "message", libelle: "Message", poids: 1 },
  { cle: "bouton", libelle: "Bouton", poids: 1 },
  { cle: "conclusion", libelle: "Conclusion", poids: 1 },
] as const;

/**
 * Les textes d'ORIGINE d'une relance, langue par langue, tels que mail.ts les
 * écrit (`textesRelanceParDefaut`) : ce sont eux que l'écran montre dans ses
 * champs tant que la boutique n'y a pas touché. Passés en paramètre pour que
 * ce fichier reste pur.
 */
export type TextesRelanceParLangue = Partial<
  Record<LangueRecherche, Partial<Record<1 | 2 | 3, Partial<Record<string, string>>>>>
>;

/**
 * Les courriels de relance des paniers, une fiche par relance.
 *
 * Les textes RÉÉCRITS par la boutique sont en base ; tant qu'elle n'y a pas
 * touché, la clé n'existe pas, et c'est le texte d'origine qui part — et que
 * l'écran affiche dans ses champs. On cherche donc dans le réécrit quand il
 * existe, sinon dans l'origine : « Votre panier vous attend », lu dans un
 * courriel reçu, mène à l'écran qui l'écrit.
 */
export function fichesCourrielsRelance(
  reglages: readonly LigneReglage[],
  parDefaut: TextesRelanceParLangue = {},
): Fiche[] {
  const fiches: Fiche[] = [];
  for (const n of [1, 2, 3] as const) {
    const champs: ChampFiche[] = [];
    for (const langue of ["fr", ...LANGUES_ETRANGERES_RECHERCHE] as LangueRecherche[]) {
      const cle = langue === "fr" ? `relance.courrier_${n}` : `relance.courrier_${n}.${langue}`;
      const reecrits = objet(reglages.find((r) => r.key === cle)?.value);
      const origine = parDefaut[langue]?.[n] ?? null;
      if (!reecrits && !origine) continue;
      // Comme l'écran (relance-panier.ts) : le réécrit en entier s'il existe,
      // sinon l'origine en entier.
      const textes: Record<string, unknown> = reecrits ?? origine ?? {};
      for (const c of CHAMPS_RELANCE)
        champs.push(
          ...garder(
            champ(
              texteDeHtml(chaine(textes[c.cle]) ?? ""),
              c.poids,
              langue === "fr" ? c.libelle : enLangue(c.libelle, langue),
              {
                chemin: "/paniers/courriel",
                parametres: { relance: n, langue },
                champ: c.cle,
              },
            ),
          ),
        );
    }
    if (!champs.length) continue;
    fiches.push({
      groupe: "boutique",
      id: `relance:${n}`,
      nature: "Courriel de relance",
      titre: `Courriel de relance n°${n}`,
      detail: null,
      image: null,
      ordre: RANG_BOUTIQUE.relance * ORDRE_SOURCE + n,
      champs,
    });
  }
  return fiches;
}

/** Un courrier automatique, rendu par mail.ts avec une commande vide (courriers.ts). */
export interface LigneCourrierAutomatique {
  /** « confirmation », « expediee »… : l'id de sa carte sur l'écran Courriers. */
  id: string;
  nom: string;
  /** « Part dès que… » : la phrase de sa carte. */
  quand: string;
  sujet: string;
  /** Le message, en texte, sans balise. */
  texte: string;
}

/**
 * Les courriers que la boutique envoie toute seule : confirmation,
 * expédition, facture, remboursement… Ils ne sont pas en base, ils sont écrits
 * dans le code ; mais c'est une phrase lue dans un courriel reçu (« Merci pour
 * votre commande ») qu'on tape pour retrouver l'écran qui le montre.
 *
 * Le message ne s'affiche sur l'écran qu'en aperçu, à la demande : trouvé
 * dans l'objet ou le message, le lien mène à la carte du courrier, sans rien
 * y chercher. Le nom et la phrase « quand », eux, sont écrits sur la carte.
 */
export function fichesCourriers(courriers: readonly LigneCourrierAutomatique[]): Fiche[] {
  return courriers.map((c, i) => {
    const carte: CibleChamp = { chemin: "/courriers", ancre: `courrier-${c.id}` };
    const apercu: CibleChamp = { ...carte, trouver: false };
    return {
      groupe: "boutique",
      id: `courrier:${c.id}`,
      nature: "Courrier",
      titre: c.nom,
      detail: "Courrier automatique",
      image: null,
      ordre: RANG_BOUTIQUE.courrier * ORDRE_SOURCE + i,
      champs: garder(
        champ(c.nom, 3, "Nom", carte, { titre: true }),
        champ(c.quand, 1, "Quand il part", carte),
        champ(c.sujet, 2, "Objet", apercu),
        champ(c.texte, 1, "Message", apercu),
      ),
    };
  });
}

export interface LignePage {
  id: number;
  title: string;
  slug: string;
  status: string;
  seoTitle: string | null;
  seoDescription: string | null;
  blocks: unknown;
  translations: unknown;
  archivedAt: Date | null;
}

/**
 * Le texte lisible des blocs d'une page, dans l'ordre : titres, paragraphes,
 * descriptions et légendes d'images, boutons. Un seul champ « Contenu de la
 * page », comme l'écran n'a qu'un seul éditeur pour tout le corps.
 */
export function texteDesBlocs(blocs: unknown): string {
  if (!Array.isArray(blocs)) return "";
  const morceaux: string[] = [];
  for (const brut of blocs) {
    const b = objet(brut);
    if (!b) continue;
    if (b.type === "titre") morceaux.push(chaine(b.texte) ?? "");
    else if (b.type === "texte") morceaux.push(texteDeHtml(chaine(b.html) ?? ""));
    else if (b.type === "image") morceaux.push(chaine(b.alt) ?? "", chaine(b.legende) ?? "");
    else if (b.type === "bouton") morceaux.push(chaine(b.texte) ?? "");
  }
  return morceaux.filter((m) => m.trim()).join(" ");
}

export function fichesPages(pages: readonly LignePage[]): Fiche[] {
  return pages.map((p, i) => {
    const chemin = `/pages/${p.id}`;
    const ici = (ancre: string, champNom?: string): CibleChamp => ({ chemin, ancre, champ: champNom });
    // Une traduction s'édite sur la même fiche, ouverte dans sa langue
    // (?langue=en) : c'est un paramètre que l'écran lit côté serveur.
    const traduite = (l: string, champNom: string): CibleChamp => ({
      chemin,
      parametres: { langue: l },
      ancre: "traductions",
      champ: champNom,
    });
    return {
      groupe: "boutique",
      id: `page:${p.id}`,
      nature: "Page",
      titre: p.title,
      detail: p.archivedAt ? "Archivée" : p.status === "active" ? "En ligne" : "Brouillon",
      image: null,
      ordre: RANG_BOUTIQUE.page * ORDRE_SOURCE + i,
      champs: garder(
        champ(p.title, 3, "Titre", enHaut(chemin), { titre: true }),
        champ(p.slug, 1, "Adresse", ici("infos", "slug")),
        champ(texteDesBlocs(p.blocks), 1, "Contenu de la page", ici("contenu", "corps")),
        champ(p.seoTitle, 1, "Titre Google", ici("referencement", "seoTitle")),
        champ(p.seoDescription, 1, "Description Google", ici("referencement", "seoDescription")),
        LANGUES_ETRANGERES_RECHERCHE.flatMap((l) => {
          const tr = objet(objet(p.translations)?.[l]);
          return [
            champ(chaine(tr?.title), 2, enLangue("Titre", l), traduite(l, "titre")),
            champ(texteDesBlocs(tr?.blocks), 1, enLangue("Contenu de la page", l), traduite(l, "corps")),
            champ(chaine(tr?.seoTitle), 1, enLangue("Titre Google", l), traduite(l, "seoTitle")),
            champ(
              chaine(tr?.seoDescription),
              1,
              enLangue("Description Google", l),
              traduite(l, "seoDescription"),
            ),
          ];
        }),
      ),
    };
  });
}

export interface LigneMenu {
  id: number;
  parentId: number | null;
  label: string;
  position: number;
  visible: boolean;
  archivedAt: Date | null;
  translations: unknown;
}

/** Le menu dans l'ordre de l'arbre : chaque entrée, puis ses sous-entrées. */
export function fichesMenu(entrees: readonly LigneMenu[]): Fiche[] {
  const parId = new Map(entrees.map((e) => [e.id, e]));
  const cle = (e: LigneMenu): [number, number, number, number] => {
    const parent = e.parentId !== null ? parId.get(e.parentId) : undefined;
    return parent
      ? [e.archivedAt ? 1 : 0, parent.position, 1, e.position]
      : [e.archivedAt ? 1 : 0, e.position, 0, 0];
  };
  const tries = [...entrees].sort((a, b) => {
    const ka = cle(a);
    const kb = cle(b);
    for (let k = 0; k < 4; k++) if (ka[k] !== kb[k]) return ka[k]! - kb[k]!;
    return a.id - b.id;
  });
  return tries.map((e, i) => {
    // Pas de champ : les libellés n'ont pas d'attribut name, ils se
    // retrouvent par leur texte dans l'article de l'entrée.
    const ici: CibleChamp = { chemin: "/menu", ancre: `entree-${e.id}` };
    return {
      groupe: "boutique",
      id: `menu:${e.id}`,
      nature: "Entrée du menu",
      titre: e.label,
      detail: e.archivedAt ? "Retiré du menu" : e.visible ? null : "Masquée",
      image: null,
      ordre: RANG_BOUTIQUE.menu * ORDRE_SOURCE + i,
      champs: garder(
        champ(e.label, 3, "Libellé", ici, { titre: true }),
        LANGUES_ETRANGERES_RECHERCHE.map((l) =>
          champ(traduction(e.translations, l, "label"), 2, enLangue("Libellé", l), ici),
        ),
      ),
    };
  });
}

export interface LigneLettre {
  id: number;
  titre: string;
  objet: string;
  contenuHtml: string;
  etat: string;
  envoyeeLe: Date | null;
  archivedAt: Date | null;
}

export function fichesLettres(lettres: readonly LigneLettre[]): Fiche[] {
  return lettres.map((l, i) => {
    const ici = (champNom: string): CibleChamp => ({
      chemin: "/lettre",
      parametres: { lettre: l.id },
      ancre: "lettre-ouverte",
      champ: champNom,
    });
    const etat =
      l.etat === "envoyee"
        ? l.envoyeeLe
          ? `Envoyée le ${jour(l.envoyeeLe)}`
          : "Envoyée"
        : l.etat === "en_cours"
          ? "En cours d'envoi"
          : "Brouillon";
    return {
      groupe: "boutique",
      id: `lettre:${l.id}`,
      nature: "Lettre",
      titre: l.titre,
      detail: ligneDetail(etat, l.archivedAt ? "Archivée" : null),
      image: null,
      ordre: RANG_BOUTIQUE.lettre * ORDRE_SOURCE + i,
      champs: garder(
        champ(l.titre, 3, "Titre", enHaut("/lettre", { lettre: l.id }), { titre: true }),
        champ(l.objet, 2, "Objet", ici("objet")),
        champ(texteDeHtml(l.contenuHtml), 1, "Contenu", ici("contenu")),
      ),
    };
  });
}

/* -------------------------------------------------------------------------- */
/*  Réglages                                                                  */
/* -------------------------------------------------------------------------- */

const RANG_REGLAGES = {
  mode: 0,
  zone: 1,
  style: 2,
  consigne: 3,
  compte: 4,
} as const;

export interface LigneModeLivraison {
  id: number;
  name: string;
  description: string | null;
  notePreparation: string | null;
  pickupLocation: string | null;
  carrier: string | null;
  kind: string;
  active: boolean;
  archivedAt: Date | null;
  translations: unknown;
}

export function fichesModesLivraison(modes: readonly LigneModeLivraison[]): Fiche[] {
  return modes.map((m, i) => {
    // Un mode archivé se range dans « Modes archivés », en texte : son ancre
    // seule, sans champ ni tableau de traductions.
    const ici = (champNom: string): CibleChamp =>
      m.archivedAt
        ? { chemin: "/livraison", ancre: `mode-${m.id}` }
        : { chemin: "/livraison", ancre: `mode-${m.id}`, champ: champNom };
    const traduit = (cle: string, libelle: string, poids: number) =>
      LANGUES_ETRANGERES_RECHERCHE.map((l) =>
        champ(
          traduction(m.translations, l, cle),
          poids,
          enLangue(libelle, l),
          m.archivedAt
            ? { chemin: "/livraison", ancre: `mode-${m.id}` }
            : {
                chemin: "/livraison",
                ancre: `traductions-mode-${m.id}`,
                champ: `tr-${m.id}-${cle}-${l}`,
              },
        ),
      );
    return {
      groupe: "reglages",
      id: `mode-livraison:${m.id}`,
      nature: "Mode de livraison",
      titre: m.name,
      detail: ligneDetail(
        m.kind === "pickup" ? "Retrait" : "Livraison",
        m.archivedAt ? "Archivé" : m.active ? null : "Désactivé",
      ),
      image: null,
      ordre: RANG_REGLAGES.mode * ORDRE_SOURCE + i,
      champs: garder(
        champ(m.name, 3, "Nom", ici("name"), { titre: true }),
        champ(m.description, 1, "Description", ici("description")),
        champ(m.notePreparation, 1, "Note de préparation", ici("notePreparation")),
        champ(m.pickupLocation, 1, "Lieu de retrait", ici("pickupLocation")),
        champ(m.carrier, 1, "Transporteur", ici("carrier")),
        traduit("name", "Nom", 2),
        traduit("description", "Description", 1),
        traduit("pickupLocation", "Lieu de retrait", 1),
      ),
    };
  });
}

export interface LigneZoneLivraison {
  id: number;
  name: string;
  /** Codes ISO (« FR », « BE ») ; une liste vide fait de la zone celle de repli. */
  countries?: unknown;
}

/** « BE » → « Belgique ». Le nom n'est que cherché : l'écran, lui, montre les codes. */
function nomDuPays(code: string): string | null {
  try {
    const nom = new Intl.DisplayNames(["fr"], { type: "region" }).of(code);
    return nom && nom !== code ? nom : null;
  } catch {
    return null;
  }
}

export function fichesZonesLivraison(zones: readonly LigneZoneLivraison[]): Fiche[] {
  return zones.map((z, i) => {
    const pays = chaines(z.countries).map((c) => c.trim().toUpperCase()).filter((c) => /^[A-Z]{2}$/.test(c));
    return {
      groupe: "reglages",
      id: `zone-livraison:${z.id}`,
      nature: "Zone de livraison",
      titre: z.name,
      detail: pays.length ? pays.join(", ") : "Zone de repli",
      image: null,
      ordre: RANG_REGLAGES.zone * ORDRE_SOURCE + i,
      champs: garder(
        champ(z.name, 3, "Nom", { chemin: "/livraison", ancre: `zone-${z.id}`, champ: "name" }, { titre: true }),
        // « Belgique » trouve la zone qui livre la Belgique ; à l'écran, c'est
        // le code « BE » qu'on retrouve dans la case des pays.
        pays.map((code) =>
          champ(
            [nomDuPays(code), code].filter(Boolean).join(" "),
            1,
            "Pays",
            { chemin: "/livraison", ancre: `zone-${z.id}`, champ: "countries", trouver: code },
          ),
        ),
      ),
    };
  });
}

export interface LigneStyleIa {
  id: number;
  title: string;
  prompt: string;
  translations: unknown;
  active: boolean;
  archivedAt: Date | null;
}

export function fichesStylesIa(styles: readonly LigneStyleIa[]): Fiche[] {
  return styles.map((s, i) => {
    const ici = (champNom: string): CibleChamp => ({
      chemin: "/ia/styles",
      parametres: { style: s.id },
      ancre: "form-style",
      champ: champNom,
    });
    return {
      groupe: "reglages",
      id: `style-ia:${s.id}`,
      nature: "Style IA",
      titre: s.title,
      detail: s.archivedAt ? "Archivé" : s.active ? "Actif" : "Masqué",
      image: null,
      ordre: RANG_REGLAGES.style * ORDRE_SOURCE + i,
      champs: garder(
        champ(s.title, 3, "Titre", enHaut("/ia/styles", { style: s.id }), { titre: true }),
        champ(texteDeHtml(s.prompt), 1, "Consigne", ici("prompt")),
        nomsTraduits(s.translations, "/ia/styles", "traductions-styles", s.id, "title", "Titre"),
      ),
    };
  });
}

/** La consigne commune des affiches IA (réglage « ia.stylePrompt »), en anglais. */
export function ficheConsigneIa(valeur: unknown): Fiche[] {
  const texte = chaine(valeur);
  if (!texte) return [];
  return [
    {
      groupe: "reglages",
      id: "consigne-ia",
      nature: "Consigne IA",
      titre: "Consigne commune des affiches IA",
      detail: null,
      image: null,
      ordre: RANG_REGLAGES.consigne * ORDRE_SOURCE,
      champs: garder(
        // Son nom se cherche aussi : sans lui, « consigne commune » ne
        // trouvait rien, et le repli « corrigeait » le mot juste.
        champ("Consigne commune des affiches IA", 3, "Nom", { chemin: "/ia", ancre: "reglages", trouver: false }, { titre: true }),
        champ(texteDeHtml(texte), 1, "Réglages", {
          chemin: "/ia",
          ancre: "reglages",
          champ: "stylePrompt",
        }),
      ),
    },
  ];
}

export interface LigneCompte {
  id: number;
  email: string;
  role: string;
  archivedAt: Date | null;
}

/** Les comptes du back-office, par leur adresse. L'empreinte du mot de passe n'est jamais lue. */
export function fichesComptes(comptes: readonly LigneCompte[]): Fiche[] {
  return comptes.map((c, i) => ({
    groupe: "reglages",
    id: `compte:${c.id}`,
    nature: "Compte",
    titre: c.email,
    detail: ligneDetail(c.role === "owner" ? "Propriétaire" : "Vendeur", c.archivedAt ? "Archivé" : null),
    image: null,
    ordre: RANG_REGLAGES.compte * ORDRE_SOURCE + i,
    champs: garder(
      champ(
        c.email,
        3,
        "E-mail",
        { chemin: "/comptes", ancre: `compte-${c.id}`, champ: "email", trouver: c.email },
        { titre: true, minimum: 3 },
      ),
    ),
  }));
}

/* -------------------------------------------------------------------------- */
/*  Commandes et paniers                                                      */
/* -------------------------------------------------------------------------- */

export interface LigneCommande {
  id: number;
  number: string;
  channel: string;
  status: string;
  totalCents: number;
  createdAt: Date;
  archivedAt: Date | null;
  invoiceNumber: string | null;
  legacyName: string | null;
  shippingName: string | null;
  shippingLine1: string | null;
  shippingLine2: string | null;
  shippingPostalCode: string | null;
  shippingCity: string | null;
  shippingCountry: string | null;
  relayPointLabel: string | null;
  internalNote: string | null;
  tags: unknown;
  promoCode: string | null;
  cancelReason: string | null;
  clientNom: string | null;
  clientEmail: string | null;
  standNom: string | null;
  /** Le mode de livraison tel qu'il s'appelait le jour de la commande (« Retrait sur place »). */
  shippingLabel?: string | null;
  /** Sa description du même jour (« livré le lendemain avant 13 h »). */
  shippingDescription?: string | null;
  /** Le transporteur de ce mode (« colissimo ») : le nom du mode ne le dit pas toujours (« À domicile »). */
  transporteurDuMode?: string | null;
  /** Le statut tel que la liste l'écrit (« Payée », « Annulée », « En attente »). */
  statutLibelle?: string | null;
}

/** Une ligne de commande : son titre figé et les textes écrits sur l'affiche. */
export interface ArticleCommande {
  orderId: number;
  title: string | null;
  quantity: number;
  /** config.texts.lines[*].value, dans l'ordre. */
  lignes: unknown;
  /** config.texts.title.value et subtitle.value : l'ancienne forme à deux textes. */
  titreAffiche: string | null;
  sousTitreAffiche: string | null;
}

/** Ce que les tables filles d'une commande disent d'elle. */
export interface EnfantsCommande {
  articles: ArticleCommande[];
  /** order_event.message : événements ET commentaires. */
  journal: string[];
  /** fulfillment.carrier et bordereau.methode_nom. */
  transporteurs: string[];
  /** refund.reason et refund.note. */
  remboursements: string[];
  /** order_event.author : qui a écrit un commentaire, comme la chronologie l'affiche. */
  auteurs?: string[];
}

/** Les textes écrits sur une affiche, avec leur numéro de ligne. */
function textesAffiche(a: ArticleCommande): { texte: string; ligne: number }[] {
  const lignes = Array.isArray(a.lignes)
    ? a.lignes.map((v) => (typeof v === "string" ? v : typeof v === "number" ? String(v) : ""))
    : [];
  if (lignes.some((l) => l.trim()))
    return lignes.map((texte, i) => ({ texte, ligne: i + 1 })).filter((l) => l.texte.trim());
  return [
    { texte: a.titreAffiche ?? "", ligne: 1 },
    { texte: a.sousTitreAffiche ?? "", ligne: 2 },
  ].filter((l) => l.texte.trim());
}

function champsArticles(articles: readonly ArticleCommande[], chemin: string): (ChampFiche | null)[] {
  const ici: CibleChamp = { chemin, ancre: "articles" };
  return articles.flatMap((a) => [
    champ(a.title, 1, "Article", ici),
    ...textesAffiche(a).map((t) => champ(t.texte, 1, `Texte de l'affiche (ligne ${t.ligne})`, ici)),
  ]);
}

export function ficheCommande(o: LigneCommande, enfants: EnfantsCommande, ordre: number): Fiche {
  const chemin = `/commandes/${o.id}`;
  const ici = (ancre?: string, champNom?: string): CibleChamp => ({ chemin, ancre, champ: champNom });
  // Le numéro, la facture et l'ancien numéro s'ouvrent sans rien chercher :
  // ils sont en tête de la fiche, c'est elle entière qu'on voulait.
  const enTete: CibleChamp = { chemin, trouver: false };
  const adresse = ici("adresse-livraison");
  return {
    groupe: "commandes",
    id: `commande:${o.id}`,
    nature: o.channel === "salon" ? "Vente de stand" : "Commande",
    motsNature: o.invoiceNumber ? "facture" : undefined,
    titre: o.number,
    detail: ligneDetail(
      o.shippingName ?? o.clientNom,
      jour(o.createdAt),
      o.channel === "salon" ? "Stand" : "En ligne",
      euros(o.totalCents),
      o.status === "cancelled" ? "Annulée" : null,
      // Une commande archivée reste trouvable : c'est justement ainsi qu'on la
      // retrouve pour la relire ou la restaurer, puisqu'elle a quitté la liste.
      o.archivedAt ? "Archivée" : null,
    ),
    image: null,
    ordre,
    champs: garder(
      champ(o.number, 3, "Numéro", enTete, { titre: true }),
      champ(o.invoiceNumber, 2, "Facture", enTete),
      champ(o.legacyName, 2, "Ancien n° Shopify", enTete),
      champ(o.shippingName, 2, "Adresse de livraison", adresse),
      champ(o.shippingLine1, 1, "Adresse de livraison", adresse),
      champ(o.shippingLine2, 1, "Adresse de livraison", adresse),
      champ(o.shippingPostalCode, 1, "Adresse de livraison", adresse),
      champ(o.shippingCity, 1, "Adresse de livraison", adresse),
      champ(o.shippingCountry, 1, "Adresse de livraison", adresse),
      champ(o.relayPointLabel, 1, "Point relais", adresse),
      champ(o.internalNote, 1, "Note interne", ici("note-interne", "note")),
      chaines(o.tags).map((t) => champ(t, 1, "Étiquettes", ici("etiquettes", "tags"))),
      // Le code promo s'écrit sur la ligne « Réduction » des mouvements.
      champ(o.promoCode, 1, "Code promo", ici("mouvements")),
      champ(o.cancelReason, 1, "Motif d'annulation", ici()),
      champ(o.clientNom, 2, "Client", ici("client")),
      champ(o.clientEmail, 1, "Client", ici("client"), { minimum: 3 }),
      // La fiche ne montre pas le nom du stand : elle s'ouvre simplement.
      champ(o.standNom, 1, "Stand", enTete),
      // Le mode s'écrit dans l'en-tête des articles ; sa description, dans le
      // bloc du bordereau (« retrait sur place », « point relais »).
      champ(o.shippingLabel, 1, "Mode de livraison", ici("articles")),
      champ(o.shippingDescription, 1, "Mode de livraison (description)", ici("bordereau")),
      // Le transporteur ne s'écrit pas sur la fiche tant que le colis n'est
      // pas parti : on mène aux articles, sans rien y chercher.
      champ(o.transporteurDuMode, 1, "Mode de livraison (transporteur)", {
        chemin,
        ancre: "articles",
        trouver: false,
      }),
      // Ce qu'une cliente dit au téléphone : « ma commande du 6 octobre »,
      // « celle de 49,90 € », « elle est toujours en attente ». L'en-tête de
      // la fiche les montre déjà, autrement écrits : elle s'ouvre en haut.
      champ(o.statutLibelle, 1, "Statut", enTete),
      champ(dateCherchable(o.createdAt), 1, "Date", enTete),
      champ(euros(o.totalCents), 1, "Montant", { chemin, ancre: "mouvements", trouver: false }),
      champsArticles(enfants.articles, chemin),
      distincts(enfants.journal).map((m) => champ(m, 1, "Journal", ici("journal"))),
      // L'auteur est l'adresse d'un compte du back-office : même minimum que
      // les e-mails, « co » ne doit pas trouver toutes les adresses en .com.
      distincts(enfants.auteurs ?? []).map((a) =>
        champ(a, 1, "Journal (auteur)", ici("journal"), { minimum: 3 }),
      ),
      distincts(enfants.transporteurs).map((t) => champ(t, 1, "Transporteur", ici("bordereau"))),
      distincts(enfants.remboursements).map((r) =>
        champ(r, 1, "Remboursement", ici("remboursements")),
      ),
    ),
  };
}

/** Un numéro provisoire de panier : « DRAFT- » suivi d'un uuid plein de chiffres. */
export function numeroProvisoire(numero: string): boolean {
  return /^DRAFT-/i.test(numero);
}

/**
 * Un panier abandonné. Son numéro n'est cherché comme texte que s'il est un
 * VRAI numéro (« WEB-0010 », que l'écran Paniers affiche) : un numéro
 * provisoire, « DRAFT- » et son uuid, répondrait à n'importe quel nombre
 * tapé — il ne se retrouve que collé en entier (recherche-direct.ts).
 */
export function fichePanier(o: LigneCommande, articles: readonly ArticleCommande[], ordre: number): Fiche {
  const chemin = `/commandes/${o.id}`;
  const ici = (ancre: string, champNom?: string): CibleChamp => ({ chemin, ancre, champ: champNom });
  const qui = o.clientNom?.trim() || o.shippingName?.trim() || o.clientEmail?.trim() || null;
  const nombre = articles.reduce((n, a) => n + Math.max(1, a.quantity), 0);
  return {
    groupe: "paniers",
    id: `panier:${o.id}`,
    nature: "Panier",
    titre: qui ? `Panier de ${qui}` : "Panier sans nom",
    detail: ligneDetail(
      jour(o.createdAt),
      euros(o.totalCents),
      `${nombre} article${nombre > 1 ? "s" : ""}`,
    ),
    image: null,
    ordre,
    surlignerTitre: true,
    champs: garder(
      champ(numeroProvisoire(o.number) ? null : o.number, 2, "Numéro", { chemin, trouver: false }),
      champ(o.clientNom, 2, "Client", ici("client")),
      champ(o.clientEmail, 1, "Client", ici("client"), { minimum: 3 }),
      champ(o.shippingName, 2, "Adresse", ici("adresse-livraison")),
      champ(o.shippingCity, 1, "Adresse", ici("adresse-livraison")),
      champ(o.shippingPostalCode, 1, "Adresse", ici("adresse-livraison")),
      champ(o.internalNote, 1, "Note interne", ici("note-interne", "note")),
      champsArticles(articles, chemin),
    ),
  };
}

/* -------------------------------------------------------------------------- */
/*  Clientes et inscrits                                                      */
/* -------------------------------------------------------------------------- */

export interface LigneClient {
  id: number;
  name: string | null;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  note: string | null;
  tags: unknown;
  commandes: number;
  totalCents: number;
}

export interface AdresseClient {
  customerId: number;
  label: string | null;
  name: string | null;
  line1: string | null;
  line2: string | null;
  postalCode: string | null;
  city: string | null;
  country: string | null;
}

/** Une commande de la cliente, pour sa ville et son code postal de livraison. */
export interface LivraisonClient {
  customerId: number;
  orderId: number;
  number: string;
  shippingCity: string | null;
  shippingPostalCode: string | null;
}

export function ficheClient(
  c: LigneClient,
  adresses: readonly AdresseClient[],
  livraisons: readonly LivraisonClient[],
  ordre: number,
): Fiche {
  const chemin = `/clients/${c.id}`;
  const ici = (ancre: string, champNom?: string): CibleChamp => ({ chemin, ancre, champ: champNom });
  const nom = c.name?.trim() || null;
  const carnet = ici("carnet-adresses");
  // Une ville, une fois : celle de la commande la plus récente qui y est partie.
  const villes = new Set<string>();
  const codes = new Set<string>();
  const parCommande: (ChampFiche | null)[] = [];
  for (const l of livraisons) {
    const vers: CibleChamp = { chemin: `/commandes/${l.orderId}`, ancre: "adresse-livraison" };
    const ville = l.shippingCity?.trim();
    if (ville && !villes.has(aplatir(ville))) {
      villes.add(aplatir(ville));
      parCommande.push(champ(ville, 1, `Ville de livraison (commande ${l.number})`, vers));
    }
    const code = l.shippingPostalCode?.trim();
    if (code && !codes.has(code)) {
      codes.add(code);
      parCommande.push(champ(code, 1, `Code postal de livraison (commande ${l.number})`, vers));
    }
  }
  return {
    groupe: "clients",
    id: `client:${c.id}`,
    nature: "Client",
    // Une fiche sans nom existe : la commande de stand n'exige que le
    // courriel. Mieux vaut l'adresse qu'une ligne vide.
    titre: nom ?? c.email ?? "Client sans nom",
    detail: ligneDetail(
      nom ? c.email : null,
      c.commandes
        ? `${c.commandes} commande${c.commandes > 1 ? "s" : ""} · ${euros(c.totalCents)}`
        : "Aucune commande",
    ),
    image: null,
    ordre,
    champs: garder(
      champ(c.name, 3, "Nom", enHaut(chemin), { titre: true }),
      // Prénom et nom de famille n'ont pas de champ à l'écran : on mène au
      // bloc des coordonnées, où le nom complet les montre.
      champ(c.firstName, 2, "Prénom", ici("coordonnees")),
      champ(c.lastName, 2, "Nom de famille", ici("coordonnees")),
      champ(c.email, nom ? 2 : 3, "E-mail", nom ? ici("coordonnees", "email") : enHaut(chemin), {
        titre: !nom,
        minimum: 3,
      }),
      champ(c.note, 1, "Note interne", ici("note-interne", "note")),
      chaines(c.tags).map((t) => champ(t, 1, "Étiquettes", ici("etiquettes", "tags"))),
      adresses.flatMap((a) =>
        [a.label, a.name, a.line1, a.line2, a.postalCode, a.city, a.country].map((v) =>
          champ(v, 1, "Carnet d'adresses", carnet),
        ),
      ),
      parCommande,
    ),
  };
}

export interface LigneInscrit {
  id: number;
  email: string;
}

export function ficheInscrit(i: LigneInscrit, ordre: number): Fiche {
  return {
    groupe: "clients",
    id: `inscrit:${i.id}`,
    nature: "Inscrit à la lettre",
    titre: i.email,
    detail: "Inscrit au formulaire du site",
    image: null,
    // Après les fiches clientes, à rang égal : c'est d'elles qu'on parle.
    ordre: ORDRE_SOURCE + ordre,
    champs: garder(
      champ(
        i.email,
        3,
        "E-mail",
        { chemin: "/lettre", ancre: "inscrits", trouver: i.email },
        { titre: true, minimum: 3 },
      ),
    ),
  };
}

/* -------------------------------------------------------------------------- */
/*  Cartes cadeaux                                                            */
/* -------------------------------------------------------------------------- */

export interface LigneCarte {
  id: number;
  code: string;
  balanceCents: number;
  status: string;
  expiresAt: Date | null;
  note: string | null;
  clientNom: string | null;
  /** gift_card_transaction.label, du plus ancien au plus récent. */
  historique: string[];
}

/** La cible du code d'une carte : sa ligne, son code à retrouver. */
export function cibleCodeCarte(c: Pick<LigneCarte, "id" | "code">): CibleChamp {
  return {
    chemin: "/cartes-cadeaux",
    parametres: { carte: c.id },
    ancre: `carte-${c.id}`,
    trouver: c.code,
  };
}

/**
 * Une carte cadeau. Le code s'affiche en clair, comme dans la liste des
 * cartes : sans lui, un résultat ne dirait pas de quelle carte il parle, et
 * la recherche ne servirait plus au moment précis où elle sert — une cliente
 * au téléphone qui lit son code. La route est réservée à la propriétaire.
 */
export function ficheCarte(c: LigneCarte, ordre: number, maintenant = new Date()): Fiche {
  const historique: CibleChamp = {
    chemin: "/cartes-cadeaux",
    parametres: { carte: c.id },
    ancre: "historique-carte",
  };
  return {
    groupe: "cartes",
    id: `carte:${c.id}`,
    nature: "Carte cadeau",
    titre: c.code,
    detail: ligneDetail(
      `Solde ${euros(c.balanceCents)}`,
      c.status === "disabled"
        ? "Désactivée"
        : c.expiresAt && c.expiresAt < maintenant
          ? "Périmée"
          : null,
    ),
    image: null,
    ordre,
    champs: garder(
      champ(c.code, 2, "Code", cibleCodeCarte(c), { titre: true }),
      champ(c.note, 1, "Note", historique),
      distincts(c.historique).map((h) => champ(h, 1, "Historique", historique)),
      champ(c.clientNom, 1, "Client", historique),
    ),
  };
}
