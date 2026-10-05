/**
 * Les pages du site, vues comme des DESTINATIONS : là où un lien du menu peut
 * mener.
 *
 * Deux écrans en ont besoin et doivent dire la même chose. « Pages du site »
 * liste toutes les pages — celles qu'on écrit, mais aussi les rayons
 * (« Toutes les affiches », chaque collection) — et dit pour chacune si le
 * menu y mène. « Menu du site » propose ces mêmes pages au moment de choisir
 * où mène une entrée, au lieu de faire deviner une adresse.
 *
 * Une adresse se compare par ce qu'elle MONTRE, pas lettre à lettre : le menu
 * de la boutique mène à « Villes » par « /affiches?genre=personnalisable&
 * collection=villes », qui montre la même collection que
 * « /affiches?collection=villes ».
 */
import type { CollectionBo, CollectionEnLigne, MenuCms, ResumePage } from "./api.ts";

export interface Destination {
  /** Ce qui classe la destination dans les listes. */
  groupe: "boutique" | "collection" | "page";
  /** Le nom de la page, tel que la boutique le dit. */
  nom: string;
  /** L'adresse à poser dans le menu, sans préfixe de langue. */
  href: string;
  /** Le nom dans les autres langues, quand on le connaît (code → nom). */
  traductions?: Record<string, string>;
  /** Faux : la page ne répond pas sur le site (brouillon, masquée, vide…). */
  enLigne: boolean;
  /** Pourquoi elle ne répond pas, ou ce qu'il faut savoir d'elle. */
  remarque?: string;
  /** L'écran du back-office qui la règle. */
  reglage?: { libelle: string; href: string };
}

/**
 * Les pages que la boutique a d'office, hors de celles qu'on écrit. Leur nom
 * dans les autres langues vient du dictionnaire du site, que le back-office
 * ne lit pas : le menu les propose en français, la traduction se saisit à
 * côté comme pour toute entrée.
 */
export const PAGES_DE_LA_BOUTIQUE: Destination[] = [
  {
    groupe: "boutique",
    nom: "Accueil",
    href: "/",
    enLigne: true,
    reglage: { libelle: "Accueil et pied de page", href: "/contenu" },
  },
  {
    groupe: "boutique",
    nom: "Toutes les affiches",
    href: "/affiches",
    enLigne: true,
    remarque: "le catalogue entier, par nouveautés",
    reglage: { libelle: "Produits", href: "/produits" },
  },
  {
    groupe: "boutique",
    nom: "Affiches personnalisables",
    href: "/affiches?genre=personnalisable",
    enLigne: true,
    reglage: {
      libelle: "Ordre d'affichage",
      href: "/produits/ordre?genre=personnalisable",
    },
  },
  {
    groupe: "boutique",
    nom: "Affiches prêtes à imprimer",
    href: "/affiches?genre=prete_a_imprimer",
    enLigne: true,
    reglage: {
      libelle: "Ordre d'affichage",
      href: "/produits/ordre?genre=prete_a_imprimer",
    },
  },
  {
    groupe: "boutique",
    nom: "Contact",
    href: "/contact",
    enLigne: true,
    remarque: "le formulaire de contact",
  },
];

/**
 * L'ordre des collections au back-office : les rangées d'abord, à leur rang ;
 * les autres ensuite — les vides en dernier, ce sont des vestiges de l'import
 * —, par nom. Le même sur les écrans Collections, Pages du site et Menu du
 * site : la liste qu'on range est celle qu'on retrouve ailleurs, et
 * « Enregistrer l'ordre » fige ce qu'on voit.
 */
export function comparerCollections(a: CollectionBo, b: CollectionBo): number {
  if ((a.position === 0) !== (b.position === 0)) return a.position === 0 ? 1 : -1;
  if (a.position !== b.position) return a.position - b.position;
  if ((a.produits === 0) !== (b.produits === 0)) return a.produits === 0 ? 1 : -1;
  return a.name.localeCompare(b.name, "fr");
}

/** Ce que montre une adresse, réduit à une clé comparable. */
export function cleDAdresse(href: string): string {
  const brut = href.trim();
  if (!brut.startsWith("/")) return brut.toLowerCase();
  let adresse: URL;
  try {
    adresse = new URL(brut, "https://boutique.invalid");
  } catch {
    return brut.toLowerCase();
  }
  const chemin = adresse.pathname.replace(/\/+$/, "").toLowerCase() || "/";
  if (chemin === "/affiches") {
    const collection = adresse.searchParams.get("collection");
    if (collection) return `collection:${collection.toLowerCase()}`;
    const genre = adresse.searchParams.get("genre");
    if (genre) return `genre:${genre.toLowerCase()}`;
    return "affiches";
  }
  const page = /^\/pages\/([^/]+)$/.exec(chemin);
  if (page) return `page:${page[1]}`;
  return chemin;
}

/**
 * Toutes les destinations, dans l'ordre des listes : les pages de la
 * boutique, les collections dans l'ordre réglé, puis les pages écrites dans
 * l'ordre réglé. Les archivées n'y sont pas : elles ne répondent plus.
 */
export function destinations(
  collections: CollectionBo[],
  enLigne: CollectionEnLigne[] | null,
  pages: ResumePage[],
): Destination[] {
  const servies = enLigne ? new Set(enLigne.map((c) => c.id)) : null;
  const desCollections: Destination[] = collections
    .filter((c) => !c.archivedAt)
    .sort(comparerCollections)
    .map((c) => {
      const traductions: Record<string, string> = {};
      for (const [l, t] of Object.entries(c.translations ?? {}))
        if (t?.name?.trim()) traductions[l] = t.name.trim();
      // Sans la liste de la boutique (API muette), on ne prononce rien.
      const enService = servies ? servies.has(c.id) : true;
      return {
        groupe: "collection" as const,
        nom: c.name,
        href: `/affiches?collection=${c.slug}`,
        traductions,
        enLigne: c.active && enService,
        remarque: !c.active
          ? "collection masquée : sa page est introuvable"
          : !enService
            ? "aucune affiche en ligne : sa page est introuvable"
            : undefined,
        reglage: { libelle: "Collection", href: `/collections/${c.id}` },
      };
    });
  const desPages: Destination[] = pages
    .filter((p) => !p.archivedAt)
    .map((p) => ({
      groupe: "page" as const,
      nom: p.title,
      href: `/pages/${p.slug}`,
      traductions: p.titres ?? {},
      enLigne: p.status === "active" && p.affichage !== "stand",
      remarque:
        p.status !== "active"
          ? "brouillon : la page est introuvable tant qu'elle n'est pas en ligne"
          : p.affichage === "stand"
            ? "réservée à la tablette du stand"
            : undefined,
      reglage: { libelle: "Page", href: `/pages/${p.id}` },
    }));
  return [...PAGES_DE_LA_BOUTIQUE, ...desCollections, ...desPages];
}

/** Une entrée du menu qui mène quelque part, avec ce qui la situe. */
export interface LienDuMenu {
  label: string;
  /** Le nom de l'entrée dont c'est un sous-lien, ou null au premier niveau. */
  parent: string | null;
  visible: boolean;
}

/** Les entrées du menu (masquées comprises) qui mènent à une adresse. */
export function liensVers(menu: MenuCms | null, href: string): LienDuMenu[] {
  if (!menu) return [];
  const cle = cleDAdresse(href);
  const sortie: LienDuMenu[] = [];
  for (const e of menu.entrees) {
    if (cleDAdresse(e.href) === cle)
      sortie.push({ label: e.label, parent: null, visible: e.visible });
    for (const enfant of e.enfants ?? [])
      if (cleDAdresse(enfant.href) === cle)
        sortie.push({
          label: enfant.label,
          parent: e.label,
          // Un sous-lien d'une entrée masquée ne se voit pas non plus.
          visible: enfant.visible && e.visible,
        });
  }
  return sortie;
}
