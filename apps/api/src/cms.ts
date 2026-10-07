/**
 * Les pages et le menu du site, écrits depuis le back-office.
 *
 * Jusqu'ici, ouvrir un rayon « Magnets » demandait deux interventions dans le
 * code : une ligne de menu écrite en dur dans la boutique, et un fichier de
 * page créé à la main. Autrement dit, la propriétaire ne pouvait pas ouvrir un
 * rayon toute seule, et la moindre rubrique attendait qu'on ait le temps.
 *
 * Ce fichier renverse cela. Une page est une suite de BLOCS — un titre, un
 * texte, une image, une liste de produits, un bouton — choisis dans une liste
 * fermée. Fermée volontairement : c'est elle qui permet au back-office de
 * proposer un formulaire par type plutôt qu'un champ de code, et à la boutique
 * de dessiner chaque bloc sans jamais tomber sur une forme inconnue.
 *
 * Une page sait aussi OÙ elle se montre : sur le site, sur la tablette du
 * stand, ou sur les deux. La boutique et le salon ne disent pas les mêmes
 * choses — un mode d'emploi du configurateur n'a rien à faire en ligne, les
 * conditions de vente à distance n'ont rien à faire sur un stand — et sans ce
 * réglage il faudrait tenir deux fois le même contenu à deux endroits.
 *
 * Deux principes gouvernent la lecture publique. D'abord, ce qui n'est pas
 * publié n'existe pas : un brouillon et une entrée de menu masquée sont
 * invisibles pour le site, même à qui devinerait l'adresse — exactement comme
 * un produit en brouillon. Ensuite, un bloc « produits » ne fait jamais
 * confiance à ce qu'il a enregistré : une collection citée a pu être supprimée
 * ou retirée depuis, et une page qui casserait pour cette raison serait pire
 * qu'une page dont une rangée est vide.
 *
 * Enfin, tout ce qui s'écrit ici est relu avant d'être enregistré, et le menu
 * entier tient dans une seule transaction : un menu à moitié réécrit laisserait
 * la boutique sans navigation, sans que rien à l'écran ne dise pourquoi.
 */
import type { Context, Hono } from "hono";
import {
  and,
  asc,
  eq,
  inArray,
  isNull,
  notInArray,
  sql as raw,
} from "drizzle-orm";
import { db, schema } from "./db/client.js";
import type { BlocPage } from "./db/schema.js";
import { ordreDesCollections } from "./collections.js";
import { menuSuitLOrdre } from "./menu-ordre.js";
import { languesDeLaPage } from "./referencement.js";

/**
 * L'ordre des pages, partout où elles se listent : celles que la boutique a
 * rangées (« Pages du site », poignée ⠿ ou flèches) d'abord, dans son ordre ;
 * les autres ensuite, par titre — l'ordre d'avant, qui reste celui d'une page
 * créée après le rangement. Même règle que les collections.
 */
function ordreDesPages() {
  return [
    raw`(${schema.pages.position} = 0) asc`,
    asc(schema.pages.position),
    asc(schema.pages.title),
  ];
}

/** Les seuls états qu'une page peut prendre. */
const STATUTS = ["active", "draft"] as const;
type StatutPage = (typeof STATUTS)[number];

/** Les seuls endroits où une page peut se montrer. */
const AFFICHAGES = ["site", "stand", "les-deux"] as const;
type Affichage = (typeof AFFICHAGES)[number];

/**
 * Les valeurs qui comprennent la boutique en ligne, et celles qui comprennent
 * la tablette du stand.
 *
 * Écrites en toutes lettres plutôt que déduites de « tout sauf l'autre » : le
 * jour où un troisième écran s'ajoute, une page destinée à lui seul ne doit pas
 * se retrouver en ligne parce que personne n'avait pensé à l'exclure.
 *
 * Exportée pour le plan du site (plan-du-site.ts), qui doit lister exactement
 * les pages que GET /pages/:slug accepte de servir — pas une de plus.
 */
export const AFFICHAGES_SITE: string[] = ["site", "les-deux"];
const AFFICHAGES_STAND: string[] = ["stand", "les-deux"];

/**
 * Les langues que la boutique sait servir, et leur nom en toutes lettres.
 *
 * Le français est la référence et n'en fait donc pas partie : il vit dans les
 * colonnes elles-mêmes. Les noms servent les messages du back-office, où
 * « l'italien » se comprend mieux que « it ».
 */
const LANGUES = ["en", "de", "it", "es"] as const;
const NOM_LANGUE: Record<string, string> = {
  en: "anglais",
  de: "allemand",
  it: "italien",
  es: "espagnol",
};

/**
 * Adresses déjà tenues par les pages écrites en dur dans la boutique.
 *
 * Une page du back-office qui prendrait l'une d'elles ne s'afficherait jamais
 * (la boutique sert la sienne) : c'est le genre de panne qu'on ne comprend pas
 * en la regardant. Mieux vaut refuser tout de suite et le dire.
 */
const ADRESSES_RESERVEES: string[] = [
  // Les codes de langue en premier : la boutique range ses pages sous /en, /de,
  // /it, /es, donc une page dont l'adresse serait « en » masquerait l'accueil
  // en anglais tout entier — et rien à l'écran ne dirait d'où vient la panne.
  ...LANGUES,
  "affiches",
  "panier",
  "commande",
  "compte",
  "salon",
  "api",
  "bo",
  "admin",
  "assets",
  "products",
  "robots",
  "sitemap",
];

/** Au-delà, ce n'est plus une rangée de produits, c'est un catalogue. */
const LIMITE_PRODUITS_MAX = 48;

/**
 * Le nombre de collections qu'une même rangée peut réunir.
 *
 * Chaque référence coûte une interrogation de la base à chaque visite, sur une
 * route que traverse tout le monde. Et une rangée qui puise dans quinze
 * collections ne se comprend plus en la regardant : c'est deux blocs qu'il
 * fallait faire.
 */
const REFERENCES_MAX = 12;

/** Un menu plus grand que cela ne tient pas dans un bandeau de site. */
const ENTREES_MENU_MAX = 200;

/**
 * Une saisie que l'on refuse, avec la phrase à montrer à la propriétaire.
 *
 * Elle traverse la transaction pour la faire retomber d'un bloc : c'est le seul
 * moyen d'abandonner un enregistrement en cours de route sans laisser la moitié
 * du travail écrite.
 */
class SaisieRefusee extends Error {}

/**
 * Adresse d'une page, nettoyée. Vide quand il ne reste rien d'utilisable.
 *
 * Même règle que pour l'adresse d'un produit (produits-masse.ts) : la
 * propriétaire la saisit à la main, et une saisie qui ne donne rien est refusée
 * plutôt que remplacée en douce par un mot inventé.
 */
function slugifier(valeur: string): string {
  return valeur
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

/** Texte libre borné ; un champ vidé vaut null, jamais chaîne vide. */
function texteOuNull(v: unknown, max: number): string | null {
  return String(v ?? "")
    .trim()
    .slice(0, max) || null;
}

/** Un objet reçu dans la requête, ou rien du tout. */
function objet(v: unknown, quoi: string): Record<string, unknown> {
  if (typeof v !== "object" || v === null || Array.isArray(v))
    throw new SaisieRefusee(`${quoi} n'a pas pu être lu. Rechargez la page et réessayez.`);
  return v as Record<string, unknown>;
}

/**
 * Le rang d'un bloc, écrit comme on le dit.
 *
 * Un message qui dit « le 3e bloc » se retrouve à l'œil dans la page ; un
 * message qui dit « blocs[2] » demande de savoir compter à partir de zéro.
 */
function rang(index: number): string {
  return index === 0 ? "1er" : `${index + 1}e`;
}

/**
 * L'identifiant d'une ligne déjà en base, quand il y en a un.
 *
 * Absent, nul ou vide veut dire « c'est une entrée nouvelle ». Prendre ce nul
 * pour un identifiant ferait refuser une création parfaitement légitime.
 *
 * En revanche un identifiant présent mais illisible n'est pas une nouveauté :
 * l'entrée serait recréée, l'ancienne emportée par le ménage, et ses
 * traductions partiraient avec elle sans que rien ne bouge à l'écran.
 */
function identifiantExistant(v: unknown, quoi: string): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0)
    throw new SaisieRefusee(
      `${quoi} n'a pas pu être reconnue. Rechargez la page et reprenez la modification.`,
    );
  return n;
}

/**
 * Un oui ou non saisi ; absent vaut la réponse annoncée.
 *
 * Un formulaire envoie volontiers « true » et « false » en toutes lettres, et
 * la chaîne « false » n'est pas le booléen `false` : la lire de travers
 * publierait une entrée que la propriétaire vient de masquer. Comme partout
 * ici, ce qui ne se lit pas est refusé plutôt que deviné.
 */
function ouiNon(v: unknown, quoi: string, defaut: boolean): boolean {
  if (v === undefined) return defaut;
  if (typeof v === "boolean") return v;
  const brut = typeof v === "string" ? v.trim().toLowerCase() : "";
  if (brut === "true") return true;
  if (brut === "false") return false;
  throw new SaisieRefusee(
    `${quoi} n'a pas pu être lu. Rechargez la page et réessayez.`,
  );
}

/**
 * Un nombre entier saisi, dans des bornes annoncées.
 *
 * `Math.round(Number(""))` vaut ZÉRO : lire un champ sans distinguer « vide »
 * de « zéro » transforme une frappe malheureuse en réglage muet. Un champ vide,
 * une lettre, un espace : tout cela est refusé et expliqué, jamais corrigé.
 */
function entier(v: unknown, quoi: string, min: number, max: number): number {
  if (typeof v !== "number" && typeof v !== "string")
    throw new SaisieRefusee(`${quoi} doit être renseigné.`);
  const brut = typeof v === "string" ? v.trim() : v;
  if (brut === "") throw new SaisieRefusee(`${quoi} doit être renseigné.`);
  const n = Number(brut);
  if (!Number.isFinite(n)) throw new SaisieRefusee(`${quoi} doit être un nombre.`);
  const valeur = Math.round(n);
  if (valeur < min || valeur > max)
    throw new SaisieRefusee(`${quoi} doit être compris entre ${min} et ${max}.`);
  return valeur;
}

/**
 * Une adresse de lien ou d'image.
 *
 * Deux formes acceptées : une page de la boutique (« /affiches ») ou une
 * adresse web complète. Le reste est refusé, y compris « //ailleurs.com/x »
 * qui ressemble à une adresse interne mais désigne un autre site.
 *
 * La barre inverse compte pour une barre : le navigateur lit « /\ailleurs.com »
 * exactement comme « //ailleurs.com ». Le back-office, lui, l'afficherait comme
 * un lien interne, et l'entrée de menu enverrait ailleurs sans le dire.
 */
function adresse(v: unknown, quoi: string): string {
  const url = String(v ?? "").trim();
  if (!url) throw new SaisieRefusee(`${quoi} ne peut pas rester vide.`);
  const interne = url.startsWith("/") && !/^[/\\]/.test(url.slice(1));
  const distante = /^https?:\/\//i.test(url);
  if (!interne && !distante)
    throw new SaisieRefusee(
      `${quoi} : « ${url.slice(0, 60)} » ne mène nulle part. Une adresse commence par « / » pour une page de la boutique, ou par « https:// » pour un autre site.`,
    );
  return url.slice(0, 500);
}

/* -------------------------------------------------------------------------- */
/*  Traductions                                                               */
/* -------------------------------------------------------------------------- */

/** Une traduction vide ou faite d'espaces n'en est pas une : on garde le français. */
function utile(v?: string | null): string | undefined {
  return v && v.trim() ? v : undefined;
}

/** Langue demandée par le client (?lang=en). Inconnue ou absente -> français. */
function langueDemandee(c: {
  req: { query: (k: string) => string | undefined };
}): string {
  const l = (c.req.query("lang") ?? "").toLowerCase();
  return (LANGUES as readonly string[]).includes(l) ? l : "fr";
}

type TraductionsPage = Partial<
  Record<
    string,
    { title?: string; blocks?: BlocPage[]; seoTitle?: string; seoDescription?: string }
  >
>;
type TraductionsMenu = Partial<Record<string, { label?: string }>>;

/* -------------------------------------------------------------------------- */
/*  Relecture des blocs d'une page                                            */
/* -------------------------------------------------------------------------- */

/**
 * Les collections qu'une rangée de produits doit réunir.
 *
 * Deux écritures acceptées, et il faut les deux : `references`, la liste, telle
 * que le back-office l'envoie depuis qu'une rangée peut en montrer plusieurs ;
 * et `reference`, la référence seule, telle que les pages déjà composées la
 * portent. Refuser la seconde reviendrait à casser des pages en ligne dont
 * personne n'a rien demandé.
 *
 * Une case laissée vide au milieu de la liste est simplement passée : un choix
 * multiple à moitié rempli ne doit pas empêcher d'enregistrer toute la page.
 * C'est quand il ne reste rien du tout que la rangée est refusée, parce
 * qu'alors elle ne montrerait jamais rien.
 */
function lireReferences(
  b: Record<string, unknown>,
  source: "collection" | "categorie",
  ou: string,
): string[] {
  let brutes: unknown[];
  if (b.references !== undefined && b.references !== null) {
    if (!Array.isArray(b.references))
      throw new SaisieRefusee(
        `${ou} : la liste des collections n'a pas pu être lue. Rechargez la page et réessayez.`,
      );
    brutes = b.references as unknown[];
  } else {
    brutes = b.reference === undefined || b.reference === null ? [] : [b.reference];
  }

  const references: string[] = [];
  for (const brute of brutes) {
    const reference = String(brute ?? "").trim().slice(0, 120);
    if (!reference) continue;
    // Une catégorie se désigne par son numéro, tel que le back-office le
    // propose dans sa liste. Un texte libre viserait une catégorie au hasard.
    if (source === "categorie" && !/^\d+$/.test(reference))
      throw new SaisieRefusee(
        `${ou} : choisissez une catégorie de produits dans la liste proposée.`,
      );
    // La même collection citée deux fois ne doublerait pas la rangée, elle
    // consommerait deux fois la place disponible pour rien.
    if (!references.includes(reference)) references.push(reference);
  }

  if (references.length > REFERENCES_MAX)
    throw new SaisieRefusee(
      `${ou} : une rangée ne peut pas réunir plus de ${REFERENCES_MAX} collections. Faites-en deux rangées.`,
    );
  return references;
}

/**
 * Relit un bloc, ou refuse la page en nommant le bloc fautif.
 *
 * Nommer le bloc est tout l'intérêt du message : « le 3e bloc » se retrouve à
 * l'œil dans la page, là où « type invalide » laisse chercher.
 */
function lireBloc(brut: unknown, ou: string): BlocPage {
  const b = objet(brut, ou);
  const type = String(b.type ?? "");

  if (type === "titre") {
    const texte = String(b.texte ?? "").trim().slice(0, 200);
    if (!texte)
      throw new SaisieRefusee(
        `${ou} est un titre sans texte. Écrivez-le, ou supprimez le bloc.`,
      );
    // Deux tailles, et deux seulement : le grand titre de la page est déjà
    // écrit ailleurs, et empiler cinq niveaux de sous-titres donne une page
    // qu'on ne sait plus lire.
    const niveau = String(b.niveau ?? "").trim();
    if (niveau !== "2" && niveau !== "3")
      throw new SaisieRefusee(
        `${ou} : choisissez un titre de section, ou un sous-titre.`,
      );
    return { type, texte, niveau: niveau === "3" ? 3 : 2 };
  }

  if (type === "texte") {
    const html = String(b.html ?? "").trim().slice(0, 50_000);
    if (!html)
      throw new SaisieRefusee(
        `${ou} est un texte vide. Écrivez quelque chose, ou supprimez le bloc.`,
      );
    return { type, html };
  }

  if (type === "image") {
    const url = adresse(b.url, `${ou} : l'adresse de l'image`);
    // Un texte de remplacement vide n'est pas un oubli anodin : c'est une image
    // muette pour qui n'y voit pas, et une image invisible pour Google.
    const alt = String(b.alt ?? "").trim().slice(0, 200);
    if (!alt)
      throw new SaisieRefusee(
        `${ou} : décrivez l'image en quelques mots. Cette description est lue aux personnes malvoyantes et reprise par Google.`,
      );
    const legende = texteOuNull(b.legende, 300);
    return legende ? { type, url, alt, legende } : { type, url, alt };
  }

  if (type === "produits") {
    const source = String(b.source ?? "");
    if (source !== "collection" && source !== "categorie")
      throw new SaisieRefusee(
        `${ou} : choisissez une collection ou une catégorie de produits à afficher.`,
      );
    const references = lireReferences(b, source, ou);
    const premiere = references[0];
    if (premiere === undefined)
      throw new SaisieRefusee(
        `${ou} : choisissez au moins une ${source === "collection" ? "collection" : "catégorie"} de produits à afficher.`,
      );
    const limite = entier(
      b.limite,
      `${ou} : le nombre de produits à montrer`,
      1,
      LIMITE_PRODUITS_MAX,
    );
    // `reference` reste écrite, et vaut la première de la liste : des pages
    // enregistrées avant ne connaissent qu'elle, et tout ce qui les relit ainsi
    // doit continuer d'afficher quelque chose plutôt que rien.
    return { type, source, reference: premiere, references, limite };
  }

  if (type === "bouton") {
    const texte = String(b.texte ?? "").trim().slice(0, 80);
    if (!texte)
      throw new SaisieRefusee(
        `${ou} est un bouton sans texte. Écrivez ce qu'il doit dire.`,
      );
    const href = adresse(b.href, `${ou} : la destination du bouton`);
    return { type, texte, href };
  }

  throw new SaisieRefusee(
    `${ou} est d'un genre que la boutique ne sait pas afficher. Supprimez-le et recomposez-le.`,
  );
}

/** Relit la suite complète des blocs d'une page. */
function lireBlocs(v: unknown, ouPage: string): BlocPage[] {
  if (!Array.isArray(v))
    throw new SaisieRefusee(
      `Le contenu${ouPage} n'a pas pu être lu. Rechargez la page et réessayez.`,
    );
  if (v.length > 100)
    throw new SaisieRefusee(
      "Cette page contient trop de blocs. Coupez-la en deux pages.",
    );
  return v.map((brut, i) => lireBloc(brut, `Le ${rang(i)} bloc${ouPage}`));
}

/**
 * Relit les blocs TRADUITS d'une page, en prenant le français pour patron.
 *
 * Un bloc traduit ne se relit pas comme un bloc français, et c'est délibéré :
 * ici, un champ VIDE est une réponse valable. Il veut dire « pas encore
 * traduit », et le site affichera le français à sa place (voir `fusionnerBlocs`
 * plus bas). Passer ces blocs par `lireBlocs` refuserait une page à moitié
 * traduite — or c'est l'état normal d'une traduction en cours, et le seul
 * moyen d'en commencer une.
 *
 * Seul le TEXTE se traduit. Tout ce qui tient la page debout — l'ordre des
 * blocs, le niveau d'un titre, l'adresse d'une image ou d'un bouton, les
 * collections d'une rangée — est recopié du français, jamais lu depuis la
 * requête : une version espagnole qui pointerait vers une autre collection que
 * la version française ne serait plus une traduction, ce serait une deuxième
 * page que personne ne saurait tenir à jour.
 *
 * D'où l'exigence sur la forme : autant de blocs que le français, et dans le
 * même ordre. Ce n'est pas une contrainte technique mais un garde-fou : une
 * liste décalée d'un cran mettrait la traduction du 3e paragraphe sous le 2e,
 * et rien à l'écran ne dirait pourquoi. Mieux vaut refuser et faire recharger.
 */
function lireBlocsTraduits(
  v: unknown,
  francais: BlocPage[],
  nomLangue: string,
): BlocPage[] {
  if (!Array.isArray(v))
    throw new SaisieRefusee(
      `Le contenu de la version en ${nomLangue} n'a pas pu être lu. Rechargez la page et réessayez.`,
    );
  if (v.length !== francais.length)
    throw new SaisieRefusee(
      `La version en ${nomLangue} ne correspond plus au contenu français : le nombre de blocs a changé entre-temps. Rechargez la page, puis reprenez la traduction.`,
    );

  return francais.map((repere, i) => {
    const brut = objet(v[i], `Le ${rang(i)} bloc de la version en ${nomLangue}`);
    const ou = `Le ${rang(i)} bloc de la version en ${nomLangue}`;
    // Le type vient du français. Un type différent dans la requête signale un
    // écran désynchronisé, pas une intention : on refuse plutôt que d'écrire
    // une traduction qui atterrirait sur le mauvais bloc.
    if (brut.type !== undefined && String(brut.type) !== repere.type)
      throw new SaisieRefusee(
        `${ou} n'est plus du même genre que le bloc français. Rechargez la page, puis reprenez la traduction.`,
      );

    if (repere.type === "titre")
      return {
        type: "titre",
        texte: String(brut.texte ?? "").trim().slice(0, 200),
        niveau: repere.niveau,
      };

    if (repere.type === "texte")
      return { type: "texte", html: String(brut.html ?? "").trim().slice(0, 50_000) };

    if (repere.type === "image") {
      const alt = String(brut.alt ?? "").trim().slice(0, 200);
      const legende = String(brut.legende ?? "").trim().slice(0, 300);
      return legende
        ? { type: "image", url: repere.url, alt, legende }
        : { type: "image", url: repere.url, alt };
    }

    if (repere.type === "bouton")
      return {
        type: "bouton",
        texte: String(brut.texte ?? "").trim().slice(0, 80),
        href: repere.href,
      };

    // Une rangée de produits n'a pas un mot à traduire : les noms des affiches
    // le sont sur leur propre fiche. Le bloc français est recopié tel quel.
    return repere;
  });
}

/** Vrai quand un bloc traduit ne porte pas un seul mot. */
function blocTraduitVide(bloc: BlocPage): boolean {
  if (bloc.type === "titre" || bloc.type === "bouton") return !bloc.texte.trim();
  if (bloc.type === "texte") return !bloc.html.trim();
  if (bloc.type === "image") return !bloc.alt.trim() && !(bloc.legende ?? "").trim();
  return true;
}

/**
 * Relit le dictionnaire de traductions d'une page, par-dessus l'existant.
 *
 * Une langue que la boutique ne sert pas est refusée plutôt qu'enregistrée :
 * du texte traduit que personne ne verra jamais est du travail perdu, et rien
 * dans le back-office ne dirait pourquoi il n'apparaît pas.
 *
 * On repart TOUJOURS du dictionnaire déjà enregistré, comme le fait la page des
 * produits (index.ts, « /admin/products/:id/translations ») : le back-office y
 * montre un éditeur par langue et n'enregistre qu'une langue à la fois. Écraser
 * le dictionnaire entier effacerait les trois autres langues en silence, et la
 * propriétaire ne s'en apercevrait qu'en visitant la boutique.
 *
 * Une langue envoyée vide est en revanche RETIRÉE : « vide » et « pas encore
 * traduit » doivent vouloir dire la même chose — le français s'affiche. C'est
 * aussi le seul moyen d'effacer une traduction devenue fausse. Une liste de
 * blocs où plus rien n'est écrit compte pour vide, au même titre qu'un titre
 * effacé : sans cela, une langue entièrement vidée resterait enregistrée et
 * l'écran continuerait de l'annoncer comme traduite.
 */
function lireTraductionsPage(
  v: unknown,
  enregistrees: TraductionsPage | null,
  blocsFrancais: BlocPage[],
): TraductionsPage | null {
  const traductions: TraductionsPage = { ...(enregistrees ?? {}) };
  if (v !== null && v !== undefined) {
    const brut = objet(v, "Les traductions");
    for (const [langue, contenu] of Object.entries(brut)) {
      if (!(LANGUES as readonly string[]).includes(langue))
        throw new SaisieRefusee(
          `La boutique ne parle pas encore la langue « ${langue.slice(0, 10)} ».`,
        );
      if (contenu === null || contenu === undefined) {
        delete traductions[langue];
        continue;
      }
      const nom = NOM_LANGUE[langue] ?? langue;
      const t = objet(contenu, `La version en ${nom}`);
      const entree: NonNullable<TraductionsPage[string]> = {};
      const titre = texteOuNull(t.title, 200);
      if (titre) entree.title = titre;
      if (t.blocks !== undefined && t.blocks !== null) {
        const blocs = lireBlocsTraduits(t.blocks, blocsFrancais, nom);
        if (!blocs.every(blocTraduitVide)) entree.blocks = blocs;
      }
      // Le référencement traduit, mêmes plafonds que le français. Une clé
      // NON envoyée garde ce qui était enregistré : l'éditeur de la page et
      // celui du référencement peuvent ainsi enregistrer chacun sa part de
      // la même langue sans s'effacer. Envoyée vide, elle est retirée.
      const avant = enregistrees?.[langue];
      const seoTitle = "seoTitle" in t ? texteOuNull(t.seoTitle, 200) : avant?.seoTitle;
      const seoDescription =
        "seoDescription" in t ? texteOuNull(t.seoDescription, 400) : avant?.seoDescription;
      if (seoTitle) entree.seoTitle = seoTitle;
      if (seoDescription) entree.seoDescription = seoDescription;
      if (entree.title || entree.blocks || entree.seoTitle || entree.seoDescription)
        traductions[langue] = entree;
      else delete traductions[langue];
    }
  }
  return Object.keys(traductions).length ? traductions : null;
}

/** Relit le dictionnaire de traductions d'une entrée de menu. */
function lireTraductionsMenu(v: unknown, libelle: string): TraductionsMenu | null {
  if (v === null || v === undefined) return null;
  const brut = objet(v, `Les traductions de « ${libelle} »`);
  const traductions: TraductionsMenu = {};
  for (const [langue, contenu] of Object.entries(brut)) {
    if (!(LANGUES as readonly string[]).includes(langue))
      throw new SaisieRefusee(
        `La boutique ne parle pas encore la langue « ${langue.slice(0, 10)} ».`,
      );
    if (contenu === null || contenu === undefined) continue;
    const nom = NOM_LANGUE[langue] ?? langue;
    const t = objet(contenu, `Le nom de « ${libelle} » en ${nom}`);
    const label = texteOuNull(t.label, 80);
    if (label) traductions[langue] = { label };
  }
  return Object.keys(traductions).length ? traductions : null;
}

/* -------------------------------------------------------------------------- */
/*  Résolution des blocs « produits »                                         */
/* -------------------------------------------------------------------------- */

/** Un produit tel qu'une rangée de page le montre. */
interface ProduitDeBloc {
  id: number;
  slug: string;
  name: string;
  basePriceCents: number;
  image: string | null;
  variants: { format: string; priceCents: number }[];
}

/**
 * Les références d'un bloc, telles qu'on les relit en base.
 *
 * Défensif à dessein : ces blocs viennent d'une colonne JSON écrite par des
 * versions successives du back-office, et une page composée il y a six mois ne
 * porte que `reference`. Ce qui n'est pas lisible est écarté sans bruit, jamais
 * traité comme une panne.
 */
function referencesDuBloc(
  bloc: Extract<BlocPage, { type: "produits" }>,
): string[] {
  const brutes =
    Array.isArray(bloc.references) && bloc.references.length
      ? bloc.references
      : [bloc.reference];
  const references: string[] = [];
  for (const brute of brutes) {
    const reference = String(brute ?? "").trim();
    if (reference && !references.includes(reference)) references.push(reference);
  }
  return references.slice(0, REFERENCES_MAX);
}

/** Un produit retenu par une référence, avant que la rangée soit habillée. */
interface LigneProduit {
  id: number;
  slug: string;
  name: string;
  basePriceCents: number;
  translations: Partial<
    Record<string, { name?: string; description?: string }>
  > | null;
}

/**
 * Les produits que désigne UNE référence.
 *
 * La référence enregistrée n'est jamais tenue pour acquise : une collection
 * supprimée, une catégorie renommée, un numéro qui ne désigne plus rien rendent
 * une liste VIDE. La page s'affiche alors avec une rangée en moins, ce qui se
 * remarque et se corrige ; une erreur, elle, priverait la visiteuse de toute
 * la page pour une rangée.
 *
 * Seuls les produits en vente sortent d'ici : un brouillon ou une archive n'a
 * pas plus sa place dans une page qu'ailleurs dans la boutique. Une collection
 * ou une catégorie désactivée compte pour supprimée — c'est ainsi que la
 * boutique les traite déjà — et ses produits ne doivent donc pas reparaître par
 * une page.
 */
async function produitsDuneReference(
  source: "collection" | "categorie",
  reference: string,
  limite: number,
): Promise<LigneProduit[]> {
  const filtre =
    source === "collection"
      ? // `col.archived_at is null` : une collection archivée ne sort plus de
        // produits. La rangée d'une page qui la montrait reste en ligne, vide,
        // et se remplit à nouveau dès qu'on restaure la collection.
        raw`exists (select 1 from ${schema.productCollections} pc join ${schema.collections} col on col.id = pc.collection_id where pc.product_id = ${schema.products.id} and col.slug = ${reference} and col.active = true and col.archived_at is null)`
      : /^\d+$/.test(reference)
        ? // `cat.archived_at is null` : même règle que pour les collections —
          // une catégorie archivée ne sort plus de produits, et la rangée de
          // la page qui la montrait se remplit à nouveau dès la restauration.
          raw`exists (select 1 from ${schema.productCategories} cat where cat.id = ${schema.products.categoryId} and cat.id = ${Number(reference)} and cat.active = true and cat.archived_at is null)`
        : null;
  if (filtre === null) return [];

  return db
    .select({
      id: schema.products.id,
      slug: schema.products.slug,
      name: schema.products.name,
      basePriceCents: schema.products.basePriceCents,
      translations: schema.products.translations,
    })
    .from(schema.products)
    .where(and(eq(schema.products.status, "active"), filtre))
    // Ordre stable : sans tri explicite, Postgres est libre de renvoyer les
    // lignes dans n'importe quel ordre, et la rangée se réorganiserait toute
    // seule d'une visite à l'autre.
    .orderBy(asc(schema.products.id))
    .limit(limite);
}

/**
 * Les produits d'un bloc « produits », toutes ses références réunies.
 *
 * Le plafond s'applique à la rangée ENTIÈRE, pas à chaque collection : c'est un
 * nombre de vignettes qui tiennent à l'écran, et il ne doit pas tripler parce
 * qu'on a cité trois collections.
 *
 * Une affiche rangée dans deux collections citées n'apparaît qu'une fois, à la
 * place que lui donne la PREMIÈRE qui la cite : l'ordre des références est un
 * choix éditorial, et la voir remonter en doublon serait pris pour un défaut.
 *
 * Les références sont interrogées ensemble : les attendre l'une après l'autre
 * mettrait bout à bout les allers-retours de chacune, sur une route que
 * traverse chaque visiteuse.
 */
async function produitsDuBloc(
  bloc: Extract<BlocPage, { type: "produits" }>,
  langue: string,
): Promise<ProduitDeBloc[]> {
  const limite = Math.min(Math.max(Math.trunc(bloc.limite) || 0, 0), LIMITE_PRODUITS_MAX);
  if (limite <= 0) return [];

  const references = referencesDuBloc(bloc);
  if (!references.length) return [];

  const lots = await Promise.all(
    references.map((reference) =>
      produitsDuneReference(bloc.source, reference, limite),
    ),
  );

  const lignes: LigneProduit[] = [];
  const vus = new Set<number>();
  for (const lot of lots) {
    for (const produit of lot) {
      if (lignes.length >= limite) break;
      if (vus.has(produit.id)) continue;
      vus.add(produit.id);
      lignes.push(produit);
    }
    if (lignes.length >= limite) break;
  }

  const ids = lignes.map((p) => p.id);
  if (!ids.length) return [];

  const variantes = await db
    .select({
      productId: schema.variants.productId,
      format: schema.variants.format,
      priceCents: schema.variants.priceCents,
    })
    .from(schema.variants)
    .where(inArray(schema.variants.productId, ids))
    .orderBy(asc(schema.variants.format));
  const parProduit = new Map<number, { format: string; priceCents: number }[]>();
  for (const v of variantes) {
    const liste = parProduit.get(v.productId);
    if (liste) liste.push({ format: v.format, priceCents: v.priceCents });
    else parProduit.set(v.productId, [{ format: v.format, priceCents: v.priceCents }]);
  }

  const images = await db
    .select({
      productId: schema.productImages.productId,
      url: schema.productImages.url,
    })
    .from(schema.productImages)
    .where(inArray(schema.productImages.productId, ids))
    .orderBy(asc(schema.productImages.position), asc(schema.productImages.id));
  const imageParProduit = new Map<number, string>();
  for (const img of images)
    if (!imageParProduit.has(img.productId))
      imageParProduit.set(img.productId, img.url);

  return lignes.map((p) => ({
    id: p.id,
    slug: p.slug,
    // Même repli que sur la fiche produit : une traduction absente ou vide
    // affiche le français, jamais un blanc.
    name: utile(langue === "fr" ? undefined : p.translations?.[langue]?.name) ?? p.name,
    basePriceCents: p.basePriceCents,
    image: imageParProduit.get(p.id) ?? null,
    variants: parProduit.get(p.id) ?? [],
  }));
}

/**
 * Les blocs prêts à dessiner : les rangées de produits sont déjà remplies.
 *
 * C'est ce qui permet à la boutique de n'avoir qu'un seul appel à faire pour
 * afficher une page, quel que soit son contenu.
 *
 * Les rangées d'une même page ne se doivent rien : les attendre l'une après
 * l'autre mettrait bout à bout les allers-retours de chacune, sur une route que
 * traverse chaque visiteuse.
 */
async function resoudreBlocs(
  blocs: BlocPage[],
  langue: string,
): Promise<(BlocPage | (BlocPage & { produits: ProduitDeBloc[] }))[]> {
  return Promise.all(
    blocs.map(async (bloc) =>
      bloc.type === "produits"
        ? { ...bloc, produits: await produitsDuBloc(bloc, langue) }
        : bloc,
    ),
  );
}

/* -------------------------------------------------------------------------- */
/*  Une page, telle qu'on la sert au public                                   */
/* -------------------------------------------------------------------------- */

/**
 * Les colonnes à lire pour servir une page, et pas une de plus.
 *
 * L'état de la page et son affichage servent à la filtrer, jamais à la
 * montrer : les faire sortir d'ici finirait par les faire apparaître dans une
 * réponse publique le jour où quelqu'un renverrait la ligne telle quelle.
 */
const COLONNES_PUBLIQUES = {
  id: schema.pages.id,
  slug: schema.pages.slug,
  title: schema.pages.title,
  seoTitle: schema.pages.seoTitle,
  seoDescription: schema.pages.seoDescription,
  blocks: schema.pages.blocks,
  translations: schema.pages.translations,
};

/** Les colonnes d'une page dont la lecture publique a besoin. */
interface PageEnregistree {
  id: number;
  slug: string;
  title: string;
  seoTitle: string | null;
  seoDescription: string | null;
  blocks: BlocPage[];
  translations: TraductionsPage | null;
}

/**
 * Le contenu d'une page dans une langue : le traduit quand il existe, le
 * français partout ailleurs.
 *
 * Champ par champ, et non bloc par bloc ni page par page. C'est ce qui permet
 * de traduire une page en plusieurs fois — le titre aujourd'hui, les
 * paragraphes la semaine prochaine — sans que la partie non traduite
 * disparaisse du site entre-temps. Un champ laissé vide dans le back-office
 * affiche donc le français, exactement comme le promet l'écran.
 *
 * La forme vient TOUJOURS du français : c'est lui qui décide combien il y a de
 * blocs, dans quel ordre et de quel genre. Une traduction qui ne collerait
 * plus (blocs ajoutés côté français depuis) est ignorée là où elle ne colle
 * pas, plutôt que d'imposer sa forme : une page en français entier vaut mieux
 * qu'une page dont il manque le dernier paragraphe.
 */
function fusionnerBlocs(
  francais: BlocPage[],
  traduits: BlocPage[] | undefined,
): BlocPage[] {
  if (!traduits || !traduits.length) return francais;
  return francais.map((f, i) => {
    const t = traduits[i];
    if (!t || t.type !== f.type) return f;
    if (f.type === "titre" && t.type === "titre")
      return { ...f, texte: utile(t.texte) ?? f.texte };
    if (f.type === "texte" && t.type === "texte")
      return { ...f, html: utile(t.html) ?? f.html };
    if (f.type === "bouton" && t.type === "bouton")
      return { ...f, texte: utile(t.texte) ?? f.texte };
    if (f.type === "image" && t.type === "image") {
      const legende = utile(t.legende) ?? f.legende;
      const fusionne: BlocPage = { ...f, alt: utile(t.alt) ?? f.alt };
      if (legende) return { ...fusionne, legende };
      return fusionne;
    }
    // Une rangée de produits n'a rien à traduire : ses affiches portent leurs
    // propres traductions, posées sur leur fiche.
    return f;
  });
}

/**
 * Une page publiée, blocs compris et rangées de produits déjà remplies.
 *
 * Partagée entre la boutique et la tablette du stand, et c'est tout l'intérêt :
 * les deux doivent recevoir exactement la même chose, sans quoi une page relue
 * au salon s'afficherait autrement qu'en ligne sans que personne ne l'ait
 * voulu. Rien de ce qui relève du back-office n'en sort : ni l'état de la page,
 * ni l'endroit où elle se montre, ni le dictionnaire des traductions.
 */
async function pagePubliee(page: PageEnregistree, langue: string) {
  const traduction = langue === "fr" ? undefined : page.translations?.[langue];
  const blocs = fusionnerBlocs(page.blocks ?? [], traduction?.blocks);

  return {
    id: page.id,
    slug: page.slug,
    title: utile(traduction?.title) ?? page.title,
    // Le référencement dans la langue de la page, et seulement elle : hors
    // du français, non traduit, il vaut null — le site retombe alors sur le
    // titre traduit plutôt que de servir du français à Google. Seule
    // exception au repli sur le français, comme pour les produits.
    seoTitle: langue === "fr" ? page.seoTitle : (utile(traduction?.seoTitle) ?? null),
    seoDescription:
      langue === "fr" ? page.seoDescription : (utile(traduction?.seoDescription) ?? null),
    blocks: await resoudreBlocs(blocs, langue),
    // Les langues où la page est vraiment écrite (referencement.ts). Le repli
    // champ par champ sert une page à moitié française sous /en : le site s'en
    // sert pour ne pas la présenter à Google comme une traduction.
    languesTraduites: languesDeLaPage(page),
  };
}

/**
 * Le code du stand qui accompagne la requête.
 *
 * Même lecture que dans salon.ts (`codeFourni`) : la tablette l'envoie tantôt
 * dans l'adresse, tantôt dans un en-tête, et les deux doivent marcher. Recopié
 * ici plutôt qu'importé, pour ne pas ouvrir le fichier des commandes du stand ;
 * si l'une des deux lectures change là-bas, celle-ci doit suivre.
 */
function codeDuStand(c: Context): string {
  return String(
    c.req.query("code") ?? c.req.header("x-salon-code") ?? "",
  ).trim();
}

/**
 * Le stand OUVERT que désigne ce code, s'il en existe un.
 *
 * Le code se dicte à voix haute et se retape sur une tablette : il est
 * enregistré en majuscules, et c'est ainsi qu'on le compare, comme le fait
 * salon.ts.
 */
async function standOuvertDuCode(code: string) {
  const propre = code.trim().toUpperCase();
  if (!propre) return undefined;
  const [stand] = await db
    .select({ id: schema.stands.id })
    .from(schema.stands)
    .where(and(eq(schema.stands.code, propre), eq(schema.stands.ouvert, true)));
  return stand;
}

/* -------------------------------------------------------------------------- */
/*  Relecture d'une page                                                      */
/* -------------------------------------------------------------------------- */

/** Ce qu'une requête peut changer sur une page. */
interface ChampsPage {
  slug?: string;
  title?: string;
  status?: StatutPage;
  affichage?: Affichage;
  seoTitle?: string | null;
  seoDescription?: string | null;
  blocks?: BlocPage[];
  translations?: TraductionsPage | null;
}

/**
 * Relit l'adresse d'une page et s'assure qu'elle est libre.
 *
 * Deux collisions à éviter, et elles ne se ressemblent pas : une autre page du
 * back-office (la base le dirait, mais trop tard et en langage de base de
 * données) et une page écrite en dur dans la boutique (que la base, elle, ne
 * connaît pas du tout).
 */
async function lireAdresse(valeur: unknown, pageId: number | null): Promise<string> {
  const slug = slugifier(String(valeur ?? ""));
  if (!slug)
    throw new SaisieRefusee(
      "L'adresse de la page ne peut pas rester vide. Utilisez des lettres et des chiffres, par exemple « nos-magnets ».",
    );
  if (ADRESSES_RESERVEES.includes(slug))
    throw new SaisieRefusee(
      `L'adresse « ${slug} » est déjà celle d'une page du site. Choisissez-en une autre, par exemple « ${slug}-2 ».`,
    );
  const [prise] = await db
    .select({ id: schema.pages.id, archivedAt: schema.pages.archivedAt })
    .from(schema.pages)
    .where(eq(schema.pages.slug, slug));
  if (prise && prise.id !== pageId)
    throw new SaisieRefusee(
      prise.archivedAt
        ? // Une page archivée garde son adresse : sans cette phrase, l'adresse
          // paraîtrait prise par une page introuvable dans la liste.
          `L'adresse « ${slug} » est celle d'une page archivée. Restaurez-la depuis « Pages archivées », ou choisissez une autre adresse.`
        : `L'adresse « ${slug} » est déjà utilisée par une autre page. Choisissez-en une autre.`,
    );
  return slug;
}

/**
 * Relit ce qu'une requête veut changer sur une page.
 *
 * Une clé absente n'est PAS un effacement : la page du back-office peut
 * n'envoyer que ce qu'elle modifie, et un champ qu'elle ignore ne doit pas
 * disparaître au passage.
 */
async function lireChampsPage(
  corps: Record<string, unknown>,
  pageId: number | null,
  /**
   * Ce que la page porte DÉJÀ en base. Les traductions, pour ne pas effacer
   * les langues que la requête ne mentionne pas ; les blocs, parce qu'ils
   * servent de patron aux blocs traduits (voir `lireBlocsTraduits`) et qu'une
   * requête qui ne touche qu'à une traduction ne les renvoie pas.
   */
  enregistre: { translations: TraductionsPage | null; blocks: BlocPage[] },
): Promise<ChampsPage> {
  const champs: ChampsPage = {};

  if ("slug" in corps) champs.slug = await lireAdresse(corps.slug, pageId);

  if ("title" in corps) {
    const titre = String(corps.title ?? "").trim().slice(0, 200);
    if (!titre) throw new SaisieRefusee("Le titre de la page ne peut pas rester vide.");
    champs.title = titre;
  }

  if ("status" in corps) {
    const statut = String(corps.status ?? "");
    if (!(STATUTS as readonly string[]).includes(statut))
      throw new SaisieRefusee(
        "Cet état n'existe pas. Une page est en ligne, ou en brouillon.",
      );
    champs.status = statut as StatutPage;
  }

  if ("affichage" in corps) {
    const affichage = String(corps.affichage ?? "");
    if (!(AFFICHAGES as readonly string[]).includes(affichage))
      throw new SaisieRefusee(
        "Dites où cette page doit se montrer : sur le site, sur la tablette du stand, ou sur les deux.",
      );
    champs.affichage = affichage as Affichage;
  }

  // Un référencement vidé vaut « rien d'écrit à la main », pas « titre vide » :
  // la page retombe alors sur son propre titre, alors qu'une chaîne vide ferait
  // afficher un résultat sans titre dans Google.
  if ("seoTitle" in corps) champs.seoTitle = texteOuNull(corps.seoTitle, 200);
  if ("seoDescription" in corps)
    champs.seoDescription = texteOuNull(corps.seoDescription, 400);

  if ("blocks" in corps) champs.blocks = lireBlocs(corps.blocks, "");
  // Les blocs d'abord, les traductions ensuite, et l'ordre compte : une
  // requête qui réécrit le français ET une traduction dans le même geste doit
  // caler la traduction sur le NOUVEAU français, pas sur celui d'avant.
  if ("translations" in corps)
    champs.translations = lireTraductionsPage(
      corps.translations,
      enregistre.translations,
      champs.blocks ?? enregistre.blocks,
    );

  return champs;
}

/* -------------------------------------------------------------------------- */
/*  Relecture du menu                                                         */
/* -------------------------------------------------------------------------- */

/** Une entrée de menu telle que le back-office la renvoie. */
interface EntreeVoulue {
  id: number | null;
  label: string;
  href: string;
  visible: boolean;
  translations: TraductionsMenu | null;
  enfants: EntreeVoulue[];
}

/** Relit une entrée du menu. Les sous-entrées ne sont lues qu'au premier niveau. */
function lireEntree(brut: unknown, profondeur: number, vus: Set<number>): EntreeVoulue {
  const e = objet(brut, "Le menu");

  const label = String(e.label ?? "").trim().slice(0, 80);
  if (!label)
    throw new SaisieRefusee(
      "Une entrée de menu doit porter un nom. Nommez-la, ou retirez-la du menu.",
    );
  const href = adresse(e.href, `L'entrée « ${label} »`);

  const id = identifiantExistant(e.id, `L'entrée « ${label} »`);
  // La même entrée envoyée deux fois, une fois ici et une fois ailleurs dans
  // l'arbre : impossible de deviner où elle doit se ranger, et l'écrire deux
  // fois donnerait un résultat au hasard de l'ordre.
  if (id !== null) {
    if (vus.has(id))
      throw new SaisieRefusee(
        `L'entrée « ${label} » apparaît deux fois dans le menu. Rechargez la page et reprenez la modification.`,
      );
    vus.add(id);
  }

  const enfantsBruts = e.enfants === undefined || e.enfants === null ? [] : e.enfants;
  if (!Array.isArray(enfantsBruts))
    throw new SaisieRefusee(
      `Les sous-entrées de « ${label} » n'ont pas pu être lues. Rechargez la page et réessayez.`,
    );
  // Un seul niveau, et ce n'est pas une limite technique : le bandeau du site
  // déroule un sous-menu, pas deux. Une entrée rangée plus profond serait
  // invisible pour tout le monde sauf pour celle qui l'a écrite.
  if (profondeur > 0 && enfantsBruts.length)
    throw new SaisieRefusee(
      `« ${label} » est déjà une sous-entrée : elle ne peut pas en contenir d'autres. Le menu n'accepte qu'un seul niveau.`,
    );

  return {
    id,
    label,
    href,
    // Une entrée sans mention explicite est visible : c'est ce qu'on attend en
    // ajoutant une entrée au menu. Toute autre réponse que oui ou non est
    // refusée : masquer une entrée et la voir rester en ligne serait pire que
    // de devoir recommencer l'enregistrement.
    visible: ouiNon(e.visible, `L'affichage de « ${label} » dans le menu`, true),
    translations: lireTraductionsMenu(e.translations, label),
    enfants: enfantsBruts.map((enfant) => lireEntree(enfant, profondeur + 1, vus)),
  };
}

export function mountCms(app: Hono): void {
  /* ---------------------------------------------------------------------- */
  /*  Menu — côté site                                                      */
  /* ---------------------------------------------------------------------- */

  /**
   * La navigation du site, telle qu'elle doit s'afficher.
   *
   * Rien de masqué n'en sort, et une sous-entrée dont l'entrée principale est
   * masquée s'en va avec elle : elle n'a pas de place au premier niveau, et
   * l'y remonter donnerait un menu que personne n'a voulu.
   */
  app.get("/menu", async (c) => {
    const langue = langueDemandee(c);
    const lignes = await db
      .select({
        id: schema.menuItems.id,
        parentId: schema.menuItems.parentId,
        label: schema.menuItems.label,
        href: schema.menuItems.href,
        translations: schema.menuItems.translations,
      })
      .from(schema.menuItems)
      .where(
        and(
          eq(schema.menuItems.visible, true),
          // Un lien retiré du menu est archivé, pas effacé : il ne revient
          // sur le site que lorsqu'on le restaure au back-office.
          isNull(schema.menuItems.archivedAt),
        ),
      )
      .orderBy(asc(schema.menuItems.position), asc(schema.menuItems.id));

    const libelle = (l: { label: string; translations: TraductionsMenu | null }) =>
      utile(langue === "fr" ? undefined : l.translations?.[langue]?.label) ?? l.label;

    const enfantsPar = new Map<number, { id: number; label: string; href: string }[]>();
    for (const l of lignes) {
      if (l.parentId === null) continue;
      const liste = enfantsPar.get(l.parentId);
      const enfant = { id: l.id, label: libelle(l), href: l.href };
      if (liste) liste.push(enfant);
      else enfantsPar.set(l.parentId, [enfant]);
    }

    return c.json({
      entrees: lignes
        .filter((l) => l.parentId === null)
        .map((l) => ({
          id: l.id,
          label: libelle(l),
          href: l.href,
          enfants: enfantsPar.get(l.id) ?? [],
        })),
    });
  });

  /* ---------------------------------------------------------------------- */
  /*  Pages — côté site                                                     */
  /* ---------------------------------------------------------------------- */

  /**
   * Une page publiée, blocs compris et rangées de produits déjà remplies.
   *
   * Un brouillon n'existe pas ici, même pour qui devinerait son adresse : c'est
   * la même règle que pour un produit retiré de la vente. Une page réservée à la
   * tablette du stand non plus : elle est écrite pour être lue debout, devant
   * quelqu'un, et n'a rien à faire en ligne.
   */
  app.get("/pages/:slug", async (c) => {
    const langue = langueDemandee(c);
    // L'adresse demandée passe par la même moulinette que celle qui a été
    // enregistrée : un lien recopié à la main, « /pages/Nos-Magnets », mène
    // ainsi à la page au lieu de rendre une page introuvable.
    const slug = slugifier(c.req.param("slug"));
    if (!slug) return c.notFound();
    const [page] = await db
      .select(COLONNES_PUBLIQUES)
      .from(schema.pages)
      .where(
        and(
          eq(schema.pages.slug, slug),
          eq(schema.pages.status, "active"),
          // Une page archivée n'existe plus pour le site, même pour qui en
          // aurait gardé l'adresse : c'est la même règle qu'un brouillon.
          isNull(schema.pages.archivedAt),
          inArray(schema.pages.affichage, AFFICHAGES_SITE),
        ),
      );
    if (!page) return c.notFound();

    return c.json(await pagePubliee(page, langue));
  });

  /* ---------------------------------------------------------------------- */
  /*  Pages — côté stand                                                    */
  /* ---------------------------------------------------------------------- */

  /**
   * Les pages destinées à la tablette du stand, prêtes à afficher.
   *
   * Toutes d'un coup, et non une par adresse : la tablette les charge en
   * arrivant sur le salon, où la connexion est ce qu'elle est, et doit pouvoir
   * continuer à les feuilleter ensuite.
   *
   * Le code du stand est exigé, exactement comme pour l'état du stand. Un code
   * qui ne désigne aucun stand ouvert repart avec une liste VIDE, jamais avec
   * une explication : la tablette est posée devant des clients, et un message
   * qui distinguerait « mauvais code » de « rien à montrer » apprendrait à un
   * curieux qu'il y a quelque chose à trouver.
   */
  app.get("/stand/pages", async (c) => {
    const langue = langueDemandee(c);
    const stand = await standOuvertDuCode(codeDuStand(c));
    if (!stand) return c.json({ pages: [] });

    const lignes = await db
      .select(COLONNES_PUBLIQUES)
      .from(schema.pages)
      .where(
        and(
          eq(schema.pages.status, "active"),
          isNull(schema.pages.archivedAt),
          inArray(schema.pages.affichage, AFFICHAGES_STAND),
        ),
      )
      // Dans l'ordre réglé au back-office, sinon par titre : la vendeuse
      // cherche « Nos formats » dans une liste, et un classement par date
      // changerait de place à chaque enregistrement.
      .orderBy(...ordreDesPages());

    return c.json({
      pages: await Promise.all(
        lignes.map((page) => pagePubliee(page, langue)),
      ),
    });
  });

  /* ---------------------------------------------------------------------- */
  /*  Pages — back-office                                                   */
  /* ---------------------------------------------------------------------- */

  /**
   * La liste des pages, dans l'ordre réglé par la boutique — par titre tant
   * qu'elle n'en a rangé aucune.
   *
   * Par titre et non par date : c'est ainsi qu'on retrouve « Livraison et
   * retours » quand on le cherche, alors qu'un classement par date change de
   * place à chaque enregistrement.
   *
   * Les pages archivées viennent AVEC, marquées : l'écran les range dans sa
   * section « Archivées » sans avoir à redemander la liste. Les traductions du
   * titre aussi : le menu s'en sert pour proposer le nom d'une page dans les
   * cinq langues quand on la choisit comme destination.
   */
  app.get("/admin/pages", async (c) => {
    const lignes = await db
      .select({
        id: schema.pages.id,
        slug: schema.pages.slug,
        title: schema.pages.title,
        status: schema.pages.status,
        affichage: schema.pages.affichage,
        position: schema.pages.position,
        translations: schema.pages.translations,
        archivedAt: schema.pages.archivedAt,
        updatedAt: schema.pages.updatedAt,
      })
      .from(schema.pages)
      .orderBy(...ordreDesPages());
    return c.json({
      pages: lignes.map(({ translations, ...p }) => ({
        ...p,
        // Le titre seul : les blocs traduits n'ont rien à faire dans une liste.
        titres: Object.fromEntries(
          Object.entries(translations ?? {})
            .map(([l, t]) => [l, (t?.title ?? "").trim()] as const)
            .filter(([, titre]) => titre),
        ),
        archivedAt: p.archivedAt?.toISOString() ?? null,
        updatedAt: p.updatedAt.toISOString(),
      })),
    });
  });

  /**
   * Range les pages dans l'ordre voulu.
   *
   * Le tableau fait foi : la première reçoit le rang 1, la suivante le 2…
   * L'écran envoie les pages qu'il montre, archivées exceptées : une archivée
   * garde son ancien rang, qu'elle retrouve si on la restaure. Une seule
   * transaction : un ordre à moitié enregistré laisserait deux pages au même
   * rang sans que rien ne le dise.
   *
   * Avec `menu: true`, les liens du menu qui mènent à ces pages suivent le
   * même ordre entre eux (menu-ordre.ts), dans la même transaction.
   *
   * Déclarée AVANT « /admin/pages/:id » : sinon « ordre » serait lu comme
   * l'identifiant d'une page.
   */
  app.post("/admin/pages/ordre", async (c) => {
    const corps = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const ids = [
      ...new Set(
        (Array.isArray(corps.pages) ? corps.pages : [])
          .map((v) => Number(v))
          .filter((n) => Number.isInteger(n) && n > 0),
      ),
    ];
    if (!ids.length) return c.json({ error: "L'ordre envoyé était vide." }, 400);
    const connues = await db
      .select({ id: schema.pages.id, slug: schema.pages.slug })
      .from(schema.pages)
      .where(inArray(schema.pages.id, ids));
    const slugDe = new Map(connues.map((l) => [l.id, l.slug]));
    const rangs = ids.filter((id) => slugDe.has(id));
    let liensMenu = 0;
    await db.transaction(async (tx) => {
      for (let i = 0; i < rangs.length; i++)
        await tx
          .update(schema.pages)
          .set({ position: i + 1 })
          .where(eq(schema.pages.id, rangs[i]!));
      if (corps.menu === true)
        liensMenu = await menuSuitLOrdre(
          tx,
          new Map(rangs.map((id, i) => [`page:${slugDe.get(id)!.toLowerCase()}`, i])),
        );
    });
    return c.json({ ok: true, ranges: rangs.length, liensMenu });
  });

  /**
   * Une page et tout ce qu'il faut pour la composer.
   *
   * Les collections et les catégories viennent avec : sans elles, le bloc
   * « produits » offrirait un champ libre où il faudrait deviner le nom exact
   * d'une collection, et une faute de frappe donnerait une rangée vide sans
   * rien dire.
   */
  app.get("/admin/pages/:id", async (c) => {
    // Entier exigé, et pas seulement « un nombre » : une base de données à qui
    // l'on demande la page « 1.5 » refuse la question au lieu de répondre
    // qu'elle n'existe pas, et la boutique affiche alors une panne.
    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id)) return c.notFound();

    const [page] = await db.select().from(schema.pages).where(eq(schema.pages.id, id));
    if (!page) return c.notFound();

    const collections = await db
      .select({
        id: schema.collections.id,
        slug: schema.collections.slug,
        name: schema.collections.name,
      })
      .from(schema.collections)
      // Seulement les collections actives et non archivées, pour la même
      // raison que les catégories juste en dessous : une collection retirée ne
      // sort plus de produits, et la proposer ici ferait composer une rangée
      // condamnée à rester vide sans que rien n'explique pourquoi.
      .where(
        and(
          eq(schema.collections.active, true),
          isNull(schema.collections.archivedAt),
        ),
      )
      .orderBy(...ordreDesCollections());
    // Seulement les catégories actives et non archivées : une catégorie
    // retirée ne sort plus de produits, et la proposer ici ferait composer une
    // rangée qui restera vide sans que rien n'explique pourquoi.
    const categories = await db
      .select({
        id: schema.productCategories.id,
        name: schema.productCategories.name,
      })
      .from(schema.productCategories)
      .where(
        and(
          eq(schema.productCategories.active, true),
          isNull(schema.productCategories.archivedAt),
        ),
      )
      .orderBy(asc(schema.productCategories.position), asc(schema.productCategories.name));

    return c.json({
      page: {
        id: page.id,
        slug: page.slug,
        title: page.title,
        status: page.status,
        affichage: page.affichage,
        seoTitle: page.seoTitle,
        seoDescription: page.seoDescription,
        blocks: page.blocks ?? [],
        translations: page.translations ?? null,
        createdAt: page.createdAt.toISOString(),
        updatedAt: page.updatedAt.toISOString(),
      },
      collections,
      categories,
    });
  });

  /**
   * Crée une page.
   *
   * Elle naît en brouillon sauf mention contraire : on écrit une page avant de
   * la montrer, et une page publiée par défaut se retrouverait en ligne à moitié
   * rédigée.
   */
  app.post("/admin/pages", async (c) => {
    const corps = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    try {
      // Une page qui naît n'a encore ni traductions ni blocs : le patron des
      // blocs traduits sera donc celui que la requête apporte, s'il y en a un.
      const champs = await lireChampsPage(corps, null, {
        translations: null,
        blocks: [],
      });
      if (champs.slug === undefined)
        throw new SaisieRefusee(
          "L'adresse de la page ne peut pas rester vide. Utilisez des lettres et des chiffres, par exemple « nos-magnets ».",
        );
      if (champs.title === undefined)
        throw new SaisieRefusee("Le titre de la page ne peut pas rester vide.");

      const [creee] = await db
        .insert(schema.pages)
        .values({
          slug: champs.slug,
          title: champs.title,
          status: champs.status ?? "draft",
          // Une page écrite sans y penser va là où l'on écrit d'ordinaire : sur
          // le site. La destiner au stand est un choix, pas un oubli.
          affichage: champs.affichage ?? "site",
          seoTitle: champs.seoTitle ?? null,
          seoDescription: champs.seoDescription ?? null,
          blocks: champs.blocks ?? [],
          translations: champs.translations ?? null,
        })
        .returning({ id: schema.pages.id });
      if (!creee) throw new SaisieRefusee("Cette page n'a pas pu être créée. Réessayez.");
      return c.json({ id: creee.id }, 201);
    } catch (erreur) {
      return reponseErreur(c, erreur, "Cette page n'a pas pu être créée.");
    }
  });

  /** Met à jour une page. Une clé absente n'est pas touchée. */
  app.post("/admin/pages/:id", async (c) => {
    const id = Number(c.req.param("id"));
    const corps = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    try {
      if (!Number.isInteger(id))
        throw new SaisieRefusee("Cette page n'existe plus. Rechargez la liste.");

      // Les traductions déjà enregistrées repartent avec la relecture : le
      // back-office n'envoie souvent qu'une langue, et les autres doivent
      // survivre à l'enregistrement. Les blocs français partent avec elles :
      // un enregistrement de traduction seule ne les renvoie pas, et ce sont
      // eux qui donnent sa forme au contenu traduit.
      const [page] = await db
        .select({
          id: schema.pages.id,
          translations: schema.pages.translations,
          blocks: schema.pages.blocks,
        })
        .from(schema.pages)
        .where(eq(schema.pages.id, id));
      if (!page) throw new SaisieRefusee("Cette page n'existe plus. Rechargez la liste.");

      const champs = await lireChampsPage(corps, id, {
        translations: page.translations ?? null,
        blocks: page.blocks ?? [],
      });
      await db
        .update(schema.pages)
        .set({ ...champs, updatedAt: new Date() })
        .where(eq(schema.pages.id, id));
      return c.json({ ok: true });
    } catch (erreur) {
      return reponseErreur(c, erreur, "Cette page n'a pas pu être enregistrée.");
    }
  });

  /**
   * Archive une page, ou la restaure.
   *
   * La suppression définitive a été RETIRÉE : ce qu'une page contenait partait
   * avec elle, et rien ne la ramenait. Archivée, elle quitte le site et la
   * liste ordinaire, garde son texte et son adresse, et revient entière.
   *
   * Les entrées de menu qui pointaient sur elle ne sont pas touchées : le lien
   * mènera à une page introuvable tant qu'elle est rangée, ce qui se répare en
   * la restaurant — alors qu'un lien effacé au passage ne se répare pas.
   */
  app.post("/admin/pages/:id/archive", async (c) => {
    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id)) return c.notFound();
    const corps = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    // Défaut : on archive. Seul un « archived: false » explicite restaure.
    const archiver = corps.archived !== false;
    const [page] = await db
      .update(schema.pages)
      .set({ archivedAt: archiver ? new Date() : null, updatedAt: new Date() })
      .where(eq(schema.pages.id, id))
      .returning({ id: schema.pages.id, archivedAt: schema.pages.archivedAt });
    if (!page) return c.notFound();
    return c.json({ ok: true, archived: page.archivedAt != null });
  });

  /* ---------------------------------------------------------------------- */
  /*  Menu — back-office                                                    */
  /* ---------------------------------------------------------------------- */

  /**
   * Le menu entier, entrées masquées comprises — mais pas les archivées.
   *
   * Les liens retirés du menu partent dans `archives`, à part : l'écran les
   * montre sous le menu, avec un bouton « Restaurer ». Les mêler à l'arbre les
   * ferait réenregistrer dans le menu au premier « Enregistrer ».
   */
  app.get("/admin/menu", async (c) => {
    const toutes = await db
      .select()
      .from(schema.menuItems)
      .orderBy(asc(schema.menuItems.position), asc(schema.menuItems.id));
    const lignes = toutes.filter((l) => l.archivedAt === null);

    const enfantsPar = new Map<number, unknown[]>();
    for (const l of lignes) {
      if (l.parentId === null) continue;
      const enfant = {
        id: l.id,
        label: l.label,
        href: l.href,
        visible: l.visible,
        translations: l.translations ?? null,
      };
      const liste = enfantsPar.get(l.parentId);
      if (liste) liste.push(enfant);
      else enfantsPar.set(l.parentId, [enfant]);
    }

    // Le nom de l'entrée dont un sous-lien archivé dépendait : « Magnets »
    // tout seul dans la liste des archives ne dit pas d'où il vient.
    const nomPar = new Map(toutes.map((l) => [l.id, l.label]));

    return c.json({
      entrees: lignes
        .filter((l) => l.parentId === null)
        .map((l) => ({
          id: l.id,
          label: l.label,
          href: l.href,
          visible: l.visible,
          translations: l.translations ?? null,
          enfants: enfantsPar.get(l.id) ?? [],
        })),
      archives: toutes
        .filter((l) => l.archivedAt !== null)
        .map((l) => ({
          id: l.id,
          label: l.label,
          href: l.href,
          parent: l.parentId === null ? null : (nomPar.get(l.parentId) ?? null),
          archivedAt: l.archivedAt!.toISOString(),
        })),
    });
  });

  /**
   * Réécrit le menu entier.
   *
   * Le menu se pense comme un tout : on y ajoute une entrée, on en déplace deux
   * et on en retire une dans le même geste. La requête porte donc l'arbre
   * complet, l'ordre du tableau fait la position, et ce qui n'y figure plus
   * disparaît.
   *
   * D'où la transaction, qui n'est pas une précaution de style : réécrit à
   * moitié, le menu laisserait la boutique sans navigation, ou avec deux fois
   * la même entrée, sans que rien à l'écran ne dise pourquoi.
   */
  app.post("/admin/menu", async (c) => {
    const corps = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    try {
      // Une requête sans arbre n'est pas un menu vide voulu : c'est une requête
      // qu'on n'a pas su lire. L'appliquer effacerait toute la navigation.
      if (!Array.isArray(corps.entrees))
        throw new SaisieRefusee(
          "Le menu n'a pas pu être lu. Rechargez la page et reprenez la modification.",
        );

      const vus = new Set<number>();
      const voulues = (corps.entrees as unknown[]).map((e) => lireEntree(e, 0, vus));
      const total = voulues.length + voulues.reduce((n, e) => n + e.enfants.length, 0);
      if (total > ENTREES_MENU_MAX)
        throw new SaisieRefusee(
          `Le menu ne peut pas contenir plus de ${ENTREES_MENU_MAX} entrées.`,
        );

      await db.transaction(async (tx) => {
        const existantes = await tx
          .select({ id: schema.menuItems.id })
          .from(schema.menuItems);
        const connues = new Set(existantes.map((l) => l.id));
        for (const id of vus)
          if (!connues.has(id))
            throw new SaisieRefusee(
              "Une des entrées du menu n'existe plus. Rechargez la page et reprenez la modification.",
            );

        const gardees: number[] = [];

        /** Écrit une entrée et rend son identifiant, qu'elle soit neuve ou non. */
        const ecrire = async (
          entree: EntreeVoulue,
          parentId: number | null,
          position: number,
        ): Promise<number> => {
          const donnees = {
            parentId,
            label: entree.label,
            href: entree.href,
            position,
            visible: entree.visible,
            translations: entree.translations,
            // Une entrée présente dans l'arbre est, par définition, dans le
            // menu : la réécrire lève l'archivage, ce qui fait qu'un lien
            // restauré puis enregistré ne retombe pas dans les archives.
            archivedAt: null,
          };
          if (entree.id !== null) {
            await tx
              .update(schema.menuItems)
              .set(donnees)
              .where(eq(schema.menuItems.id, entree.id));
            return entree.id;
          }
          const [creee] = await tx
            .insert(schema.menuItems)
            .values(donnees)
            .returning({ id: schema.menuItems.id });
          if (!creee)
            throw new SaisieRefusee(
              "Le menu n'a pas pu être enregistré. Rechargez la page et réessayez.",
            );
          return creee.id;
        };

        // Les entrées de premier niveau d'abord : une sous-entrée nouvelle a
        // besoin de l'identifiant de son parent, y compris quand ce parent
        // vient lui aussi d'être créé.
        for (const [position, entree] of voulues.entries()) {
          const parentId = await ecrire(entree, null, position);
          gardees.push(parentId);
          for (const [rangEnfant, enfant] of entree.enfants.entries())
            gardees.push(await ecrire(enfant, parentId, rangEnfant));
        }

        // Le ménage vient en DERNIER, une fois chaque sous-entrée conservée
        // rattachée à son nouveau parent : archiver d'abord rangerait des
        // sous-entrées qu'on voulait garder.
        //
        // Archiver, et non supprimer : un lien retiré du menu se retrouve dans
        // « Liens retirés du menu », d'où il se restaure. La date d'archivage
        // déjà posée n'est pas réécrite — sinon toute la liste des archives
        // se redaterait d'aujourd'hui à chaque enregistrement du menu.
        const ranger = { archivedAt: new Date() };
        const dejaRangees = isNull(schema.menuItems.archivedAt);
        if (gardees.length)
          await tx
            .update(schema.menuItems)
            .set(ranger)
            .where(and(notInArray(schema.menuItems.id, gardees), dejaRangees));
        // Un menu volontairement vidé : la boutique gardera ses liens de
        // secours, et tout ce qu'il contenait part aux archives.
        else await tx.update(schema.menuItems).set(ranger).where(dejaRangees);
      });

      return c.json({ ok: true });
    } catch (erreur) {
      return reponseErreur(c, erreur, "Le menu n'a pas pu être enregistré.");
    }
  });

  /**
   * Remet dans le menu un lien qui en avait été retiré.
   *
   * On restaure ce qui était parti ENSEMBLE, dans les deux sens. Un même
   * enregistrement du menu pose la même date d'archivage sur toutes les lignes
   * qu'il retire : cette date suffit à retrouver le geste d'origine.
   *
   *  - un sous-lien ramène son entrée principale, sinon il ne serait rattaché
   *    à rien et ne réapparaîtrait nulle part — ni dans le menu, ni ailleurs ;
   *  - une entrée principale ramène les sous-liens partis avec elle, ce que
   *    l'écran avait annoncé en les retirant (« ses sous-liens partiront avec
   *    elle »). Un sous-lien retiré un autre jour, lui, reste rangé.
   *
   * Chacun revient à sa place d'avant, celle que sa `position` a gardée. Si le
   * menu a changé entre-temps, les flèches de l'écran le remettent où il faut.
   */
  app.post("/admin/menu/:id/restaurer", async (c) => {
    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id)) return c.notFound();
    try {
      await db.transaction(async (tx) => {
        const [ligne] = await tx
          .select({
            id: schema.menuItems.id,
            parentId: schema.menuItems.parentId,
            archivedAt: schema.menuItems.archivedAt,
          })
          .from(schema.menuItems)
          .where(eq(schema.menuItems.id, id));
        if (!ligne)
          throw new SaisieRefusee(
            "Ce lien n'existe plus. Rechargez la page et reprenez.",
          );

        const aRendre = new Set([ligne.id]);
        if (ligne.parentId !== null) aRendre.add(ligne.parentId);
        if (ligne.archivedAt !== null) {
          // Les sous-liens de cette entrée rangés dans le même geste.
          const compagnons = await tx
            .select({ id: schema.menuItems.id })
            .from(schema.menuItems)
            .where(
              and(
                eq(schema.menuItems.parentId, ligne.id),
                eq(schema.menuItems.archivedAt, ligne.archivedAt),
              ),
            );
          for (const l of compagnons) aRendre.add(l.id);
        }

        await tx
          .update(schema.menuItems)
          .set({ archivedAt: null })
          .where(inArray(schema.menuItems.id, [...aRendre]));
      });
      return c.json({ ok: true });
    } catch (erreur) {
      return reponseErreur(c, erreur, "Ce lien n'a pas pu être restauré.");
    }
  });
}

/**
 * La réponse à donner quand un enregistrement n'a pas abouti.
 *
 * Une saisie refusée porte sa propre phrase, écrite pour être lue. Tout le
 * reste — la base qui refuse au dernier moment ce que la relecture ne pouvait
 * pas voir — est journalisé pour nous et résumé en une phrase pour elle : la
 * transaction a tout annulé, il n'y a qu'à recommencer.
 */
function reponseErreur(c: Context, erreur: unknown, resume: string): Response {
  if (erreur instanceof SaisieRefusee) return c.json({ error: erreur.message }, 400);
  console.error("[cms] enregistrement impossible", erreur);
  return c.json({ error: `${resume} Vérifiez la saisie, puis réessayez.` }, 400);
}
