/**
 * Les bandeaux visuels, côté back-office : lire la liste (ou l'encart
 * d'accueil qu'elle reprend), l'écrire, et dire en français où et quand un
 * bandeau s'affiche. La forme d'un bandeau, ce qui le rend valide et ce qui
 * le met en ligne sont dans @memoryline/types (bandeaux-visuels.ts), partagés
 * avec le site.
 *
 * Toute la liste vit dans UN réglage, `bandeaux.visuels` : chaque écriture la
 * réécrit entière. Les écrans la relisent donc juste avant d'écrire, jamais
 * de mémoire — un second onglet resté ouvert n'efface pas ce qu'on vient
 * d'enregistrer ailleurs, sauf sur le bandeau même qu'il modifie.
 */
import {
  PAGE_ACCUEIL,
  PAGE_BOUTIQUE,
  PAGE_TOUS_LES_RAYONS,
  REGLAGE_BANDEAUX_VISUELS,
  bandeauDepuisEncart,
  lireBandeauxVisuels,
  pageGenre,
  pageLibre,
  pageRayon,
  type BandeauVisuel,
  type EtatBandeau,
} from "@memoryline/types";
import type { adminApi, CollectionBo, ResumePage } from "./api.ts";
import { LANGUES_TRADUITES } from "./traductions.ts";

type Api = ReturnType<typeof adminApi>;

export interface ListeBandeaux {
  bandeaux: BandeauVisuel[];
  /**
   * Vrai tant que rien n'a jamais été enregistré ici : la liste est alors
   * l'ancien encart d'accueil, repris tel quel. Il s'écrit dans la liste à la
   * première modification, quelle qu'elle soit.
   */
  repriseEncart: boolean;
}

/**
 * La valeur d'un réglage dans une langue. Une chaîne est du français — la
 * forme d'avant les traductions, toujours valable (voir contenu.astro).
 */
function valeurReglage(brut: unknown, langue: string): string {
  if (typeof brut === "string") return langue === "fr" ? brut : "";
  if (brut && typeof brut === "object" && !Array.isArray(brut)) {
    const v = (brut as Record<string, unknown>)[langue];
    return typeof v === "string" ? v : "";
  }
  return "";
}

/** La liste, relue en base — par la route ADMIN, qui ne filtre rien. */
export async function lireBandeaux(api: Api): Promise<ListeBandeaux> {
  const lignes = await api.settingsLignes();
  const parCle = new Map(lignes.map((l) => [l.key, l.value]));
  const enregistres = lireBandeauxVisuels(parCle.get(REGLAGE_BANDEAUX_VISUELS));
  if (enregistres) return { bandeaux: enregistres, repriseEncart: false };
  const encart = bandeauDepuisEncart(
    (cle, langue) => valeurReglage(parCle.get(cle), langue),
    LANGUES_TRADUITES.map((l) => l.code),
  );
  return { bandeaux: encart ? [encart] : [], repriseEncart: !!encart };
}

/**
 * Écrit la liste entière. Sans langue : la valeur remplace tout, c'est un
 * tableau et non un texte à traduire (les traductions sont dedans).
 */
export async function ecrireBandeaux(
  api: Api,
  bandeaux: BandeauVisuel[],
): Promise<void> {
  await api.setSetting(REGLAGE_BANDEAUX_VISUELS, bandeaux);
}

/**
 * Un identifiant neuf. Lettres, chiffres et tirets seulement : il nomme les
 * cases du bloc des traductions et les clés envoyées à la traduction
 * automatique, qui refuse tout le reste.
 */
export function nouvelId(existants: readonly BandeauVisuel[]): string {
  for (;;) {
    const id = `bv-${crypto.randomUUID().replace(/-/g, "").slice(0, 10)}`;
    if (!existants.some((b) => b.id === id)) return id;
  }
}

/* ------------------------------------------------------------------------ */
/* Les pages, en français                                                   */
/* ------------------------------------------------------------------------ */

export interface ChoixPage {
  cle: string;
  libelle: string;
  /** L'adresse, ou ce qu'il faut savoir : « masquée », « brouillon »… */
  detail?: string;
  /** Une page qui n'existe plus : cochée pour qu'on la voie, et qu'on la décoche. */
  introuvable?: boolean;
}

export interface GroupePages {
  titre: string;
  choix: ChoixPage[];
}

/** Les pages qui existent toujours, quelle que soit la boutique. */
const PAGES_FIXES: ChoixPage[] = [
  { cle: PAGE_ACCUEIL, libelle: "Accueil", detail: "/" },
  { cle: PAGE_BOUTIQUE, libelle: "Toutes les affiches", detail: "/affiches" },
  {
    cle: pageGenre("personnalisable"),
    libelle: "Affiches personnalisables",
    detail: "/affiches?genre=personnalisable",
  },
  {
    cle: pageGenre("prete_a_imprimer"),
    libelle: "Affiches prêtes à imprimer",
    detail: "/affiches?genre=prete_a_imprimer",
  },
  {
    cle: PAGE_TOUS_LES_RAYONS,
    libelle: "Tous les rayons",
    detail: "chaque collection, y compris celles créées plus tard",
  },
];

/**
 * Les pages qu'on peut cocher, rangées en trois groupes : les pages de la
 * boutique, ses rayons (les collections), ses pages libres.
 *
 * Les collections et les pages ARCHIVÉES n'y sont pas — elles ne sont plus
 * sur le site. Une page déjà choisie qui a disparu depuis reste proposée,
 * cochée et signalée : l'enregistrement ne doit pas la retirer sans qu'on
 * l'ait vue.
 */
export function groupesDePages(
  collections: CollectionBo[],
  pages: ResumePage[],
  dejaChoisies: readonly string[] = [],
): GroupePages[] {
  const rayons: ChoixPage[] = collections
    .filter((c) => !c.archivedAt)
    .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name, "fr"))
    .map((c) => ({
      cle: pageRayon(c.slug),
      libelle: c.name,
      detail: [
        `/affiches?collection=${c.slug}`,
        ...(c.active ? [] : ["masquée"]),
        ...(c.produits === 0 ? ["vide"] : []),
      ].join(" — "),
    }));
  const libres: ChoixPage[] = pages
    .filter((p) => !p.archivedAt)
    .sort((a, b) => a.title.localeCompare(b.title, "fr"))
    .map((p) => ({
      cle: pageLibre(p.slug),
      libelle: p.title,
      detail: [`/pages/${p.slug}`, ...(p.status === "active" ? [] : ["brouillon"])].join(
        " — ",
      ),
    }));
  const connues = new Set([...PAGES_FIXES, ...rayons, ...libres].map((c) => c.cle));
  const disparues: ChoixPage[] = dejaChoisies
    .filter((cle) => !connues.has(cle))
    .map((cle) => ({
      cle,
      libelle: libellePage(cle, collections, pages),
      detail: "n'existe plus sur le site",
      introuvable: true,
    }));
  return [
    { titre: "La boutique", choix: PAGES_FIXES },
    { titre: "Un rayon précis", choix: rayons },
    { titre: "Une page du site", choix: libres },
    ...(disparues.length ? [{ titre: "Introuvables", choix: disparues }] : []),
  ];
}

/** Le nom d'une page, pour la liste des bandeaux : « Rayon Villes ». */
export function libellePage(
  cle: string,
  collections: CollectionBo[],
  pages: ResumePage[],
): string {
  const fixe = PAGES_FIXES.find((p) => p.cle === cle);
  if (fixe) return fixe.libelle;
  if (cle.startsWith("rayon:")) {
    const slug = cle.slice("rayon:".length);
    const c = collections.find((x) => x.slug === slug);
    return `Rayon « ${c?.name ?? slug} »`;
  }
  if (cle.startsWith("page:")) {
    const slug = cle.slice("page:".length);
    const p = pages.find((x) => x.slug === slug);
    return `Page « ${p?.title ?? slug} »`;
  }
  return cle;
}

/* ------------------------------------------------------------------------ */
/* L'état, en français                                                      */
/* ------------------------------------------------------------------------ */

/** La pastille d'état : ce que la liste et la fiche disent d'un bandeau. */
export const PASTILLES: Record<EtatBandeau, { libelle: string; classe: string; aide: string }> = {
  "en-ligne": {
    libelle: "En ligne",
    classe: "bg-green-100 text-green-800",
    aide: "Il s'affiche en ce moment sur les pages choisies.",
  },
  programme: {
    libelle: "Programmé",
    classe: "bg-sky-100 text-sky-900",
    aide: "Il s'affichera tout seul à la date de début.",
  },
  termine: {
    libelle: "Terminé",
    classe: "bg-bo-bg text-bo-muted",
    aide: "Sa date de fin est passée : il ne s'affiche plus. Changez les dates pour le remettre.",
  },
  eteint: {
    libelle: "Désactivé",
    classe: "bg-bo-bg text-bo-muted",
    aide: "La case « Afficher ce bandeau » est décochée.",
  },
  "sans-image": {
    libelle: "Sans image",
    classe: "bg-amber-100 text-amber-900",
    aide: "Il ne s'affiche pas tant qu'il n'a pas d'image.",
  },
  "sans-page": {
    libelle: "Aucune page",
    classe: "bg-amber-100 text-amber-900",
    aide: "Aucune page n'est cochée : il ne s'affiche nulle part.",
  },
  archive: {
    libelle: "Archivé",
    classe: "bg-bo-bg text-bo-muted",
    aide: "Rangé hors du site. « Restaurer » le remet dans la liste.",
  },
};

/** Une date lisible : « 1 déc. 2026 à 00:00 », à l'heure de la boutique. */
export function dateLisible(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("fr-FR", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Paris",
  });
}

/** La période d'un bandeau, en une ligne : « du 1 déc. au 26 déc. », « toujours ». */
export function periode(b: BandeauVisuel): string {
  const debut = dateLisible(b.debut);
  const fin = dateLisible(b.fin);
  if (debut && fin) return `du ${debut} au ${fin}`;
  if (debut) return `à partir du ${debut}`;
  if (fin) return `jusqu'au ${fin}`;
  return "sans limite de dates";
}

/** Ce qui désigne un bandeau dans la liste : son nom, sinon son premier texte. */
export function nomDuBandeau(b: BandeauVisuel): string {
  return b.nom || b.titre || b.texte || b.bouton || b.alt || "Bandeau sans texte";
}
