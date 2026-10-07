/**
 * LES ANCIENNES ADRESSES DE MEMORYLINE.FR, ET OÙ CHACUNE MÈNE.
 *
 * Le site remplace la boutique Shopify sous le même nom de domaine. Toutes ses
 * adresses — indexées par Google, gardées en favori, imprimées sur des
 * cartes — doivent mener quelque part le jour de la bascule, EN UN SEUL SAUT
 * et en 301 (« déplacé pour de bon »), le seul code qui transmet le
 * référencement de l'ancienne adresse à la nouvelle. Le middleware
 * (src/middleware.ts) applique ce fichier ; c'est ici, et nulle part
 * ailleurs, qu'on lit et qu'on corrige les correspondances.
 *
 * Relevé fait le 6 octobre 2026 sur le plan du site Shopify (191 fiches,
 * 19 collections, 3 pages, 1 blog) et sur les liens de son pied de page.
 *
 * ⚠ CHAQUE DESTINATION CHOISIE À LA MAIN EST À FAIRE VALIDER PAR MARGAUX.
 *
 * Une correspondance d'ici ne masque jamais un contenu publié depuis : une
 * fiche, un rayon ou une page recréés au back-office sous la même adresse
 * reprennent la main d'eux-mêmes (voir `destinationAncienne`). Et la table
 * « Redirections » du back-office passe avant tout ce fichier : c'est là qu'on
 * ajoute un cas sans toucher au code.
 */
import { assetUrl, type PlanDuSite } from "./api.ts";
import { adresseDuRayon } from "./referencement.ts";

/** Le rayon « Villes », tel que le menu y mène. */
const VILLES = adresseDuRayon("personnalisable", "villes");
/** Le rayon « Thèmes & paysages », tel que le menu y mène. */
const PAYSAGES = adresseDuRayon("personnalisable", "balades-paysages");
const PERSONNALISABLES = adresseDuRayon("personnalisable");
const PRETES = adresseDuRayon("prete_a_imprimer");

/**
 * Les fiches encore en ligne sur Shopify (et dans son plan du site) qui
 * n'existent pas dans le nouveau catalogue — dix-huit —, plus une redirection
 * que la boutique avait déjà posée dans Shopify.
 *
 * Règle suivie : l'affiche du MÊME LIEU la plus proche ; à défaut, le rayon
 * où ce lieu aurait été rangé. Si l'une de ces affiches est recréée au
 * back-office sous son ancienne adresse, sa ligne cesse d'agir d'elle-même.
 */
export const FICHES_RETIREES: Record<string, string> = {
  // BERCK : la seule affiche de Berck en vente (cerfs-volants).
  "berck-affiche-personnalisee": "/affiches/berck-cerfs-volants-affiche-personnalisee",
  // CAYEUX-SUR-MER Cabines : la vue générale de Cayeux.
  "cayeux-sur-mer-cabines-affiche-personnalisee": "/affiches/cayeux-sur-mer-affiche-personnalisee",
  // CRIEL Cabines : la seule affiche de Criel (plage et falaises).
  "criel-cabines-affiche-personnalisee": "/affiches/criel-plage-falaises-affiche-personnalisee",
  // CUCQ-STELLA Cabines : la seule affiche de Cucq-Stella (la plage).
  "cucq-stella-cabines-affiche-personnalisee": "/affiches/cucq-stella-plage-affiche-personnalisee",
  // DIEPPE Cerfs-volants, Falaises, Sunset (et sa copie) : la seule affiche
  // de Dieppe en vente, le port.
  "dieppe-cerfs-volants-affiche-personnalisee": "/affiches/dieppe-port-affiche-personnalisee",
  "dieppe-falaises-affiche-personnalisee": "/affiches/dieppe-port-affiche-personnalisee",
  "dieppe-sunset-affiche-personnalisee": "/affiches/dieppe-port-affiche-personnalisee",
  "dieppe-sunset-affiche-personnalisee-copie": "/affiches/dieppe-port-affiche-personnalisee",
  // FORT-MAHON Belles dunes : la seule affiche de Fort-Mahon (la plage).
  "fort-mahon-belles-dunes-affiche-personnalisee": "/affiches/fort-mahon-plage-affiche-personnalisee",
  // LE TOUQUET Cabines (deux versions) : la seule affiche du Touquet (la mairie).
  "le-touquet-cabines-affiche-personnalisee": "/affiches/le-touquet-mairie-affiche-personnalisee",
  "le-touquet-cabines-2-affiche-personnalisee": "/affiches/le-touquet-mairie-affiche-personnalisee",
  // LE TRÉPORT Fête de la mer : la fête se tient sur le port.
  "le-treport-fete-de-la-mer-affiche-personnalisee": "/affiches/le-treport-port-affiche-personnalisee",
  // MESNIL-VAL (adresse Shopify mal orthographiée « menisl ») : aucune affiche
  // de Mesnil-Val ; c'est un hameau de Criel-sur-Mer, d'où l'affiche de Criel.
  "menisl-val-affiche-personnalisee": "/affiches/criel-plage-falaises-affiche-personnalisee",
  // MERS-LES-BAINS Villas #2 : la première version des villas.
  "mers-les-bains-villas-2-affiche-personnalisee": "/affiches/mers-les-bains-villas-affiche-personnalisee",
  // SAINT-MALO Remparts : la seule affiche de Saint-Malo — mais elle est
  // PRÊTE À IMPRIMER, et non personnalisable.
  "saint-malo-remparts-affiche-personnalisee": "/affiches/saint-malo-affiche-prete-a-imprimer",
  // SAINT-VALERY-EN-CAUX (Seine-Maritime, à ne pas confondre avec
  // Saint-Valery-sur-Somme) : aucune affiche de ce lieu, le rayon Villes.
  "saint-valery-en-caux-affiche-personnalisee": VILLES,
  // SAINT-VALERY-SUR-SOMME Port : la vue générale de Saint-Valery (#2).
  "saint-valery-sur-somme-port-affiche-personnalisee": "/affiches/saint-valery-sur-somme-2-affiche-personnalisee",
  // VEULES-LES-ROSES : aucune affiche de ce lieu, le rayon Villes.
  "veules-les-roses-affiche-personnalisee": VILLES,
  // STRASBOURG : redirection déjà posée dans Shopify vers Colmar (relevée par
  // l'audit) ; les autres redirections Shopify restent à exporter de son
  // back-office et à saisir dans la table « Redirections ».
  "strasbourg-affiche-personnalisee": "/affiches/colmar-affiche-personnalisee",
};

/**
 * Les rayons techniques de Shopify, et celui qui double un genre.
 *
 * Ils existent encore comme collections — on ne les supprime pas, d'autres
 * écrans peuvent s'en servir —, mais leur page ferait doublon avec une page
 * qui existe déjà. Leur ancienne adresse (/collections/…) ET leur page rayon
 * (/affiches?collection=…) mènent donc à cette page-là.
 */
export const RAYONS_FUSIONNES: Record<string, string> = {
  // « Page d'accueil / En vedette » : la vitrine de l'accueil de Shopify.
  frontpage: "/",
  // « Collection TOUT VOIR » : l'entrée « Tout voir » des personnalisables.
  "collection-tout-voir": PERSONNALISABLES,
  // « Personnages de dos » : ses 145 affiches sont toutes dans « Villes ».
  "personnages-de-dos": VILLES,
  // « Personnages de FACE » : ses 16 affiches sont toutes dans « Thèmes & paysages ».
  "personnages-de-face": PAYSAGES,
  // « Affiches prêtes à imprimer » : exactement les affiches de la page de ce
  // genre, celle du menu.
  "affiches-diverses": PRETES,
};

/**
 * Les collections Shopify vides, absentes du nouveau site : le rayon le plus
 * proche par le thème. Elles ne servent que tant que la collection n'a pas
 * d'affiche en vente — remplie au back-office, elle redevient son propre rayon.
 */
export const COLLECTIONS_DISPARUES: Record<string, string> = {
  // Thèmes, nature, saisons, activités : montagne, forêt, ferme, Noël, golf,
  // station de ski… sont dans « Thèmes & paysages ».
  themes: PAYSAGES,
  "nature-animaux": PAYSAGES,
  saisons: PAYSAGES,
  activites: PAYSAGES,
  "activites-passions": PAYSAGES,
  // Mots, cuisine, vintage : « Good vibes only », « Vivre pour l'apéro »,
  // « Team matcha », les affiches de voyage rétro… sont les prêtes à imprimer.
  "mots-citations": PRETES,
  cuisine: PRETES,
  vintage: PRETES,
  // Enfance : les affiches de famille sont les personnalisables.
  enfance: PERSONNALISABLES,
  // « Affiches » : le catalogue entier.
  affiches: "/affiches",
};

/**
 * Les pages libres de Shopify dont l'adresse change. Une page publiée au
 * back-office sous la même adresse passe devant (la recréer avec son texte
 * est même le mieux pour /pages/affiches-personnalisables).
 */
export const PAGES_SHOPIFY: Record<string, string> = {
  // La page d'atterrissage « Affiches personnalisables » : le rayon du même nom.
  "affiches-personnalisables": PERSONNALISABLES,
  // Une page d'essai de Shopify (« mode boutique ») : l'accueil.
  "mode-boutique": "/",
  cgv: "/pages/conditions-de-vente",
  "conditions-generales-de-vente": "/pages/conditions-de-vente",
  "politique-de-confidentialite": "/pages/confidentialite",
  contact: "/contact",
  "nous-contacter": "/contact",
};

/**
 * Les pages légales que Shopify génère (/policies/…), liées dans son pied de
 * page. Une politique qui ne figure pas ici mène aux conditions de vente.
 */
export const POLITIQUES: Record<string, string> = {
  "privacy-policy": "/pages/confidentialite",
  "legal-notice": "/pages/mentions-legales",
  "terms-of-service": "/pages/conditions-de-vente",
  "refund-policy": "/pages/conditions-de-vente",
  "shipping-policy": "/pages/conditions-de-vente",
  "subscription-policy": "/pages/conditions-de-vente",
  "contact-information": "/contact",
};

/** Une destination : le chemin (sans préfixe de langue), et les paramètres à garder en plus du suivi. */
export interface Destination {
  vers: string;
  garder?: string[];
}

/**
 * Où mène une ancienne adresse, ou null si ce n'en est pas une.
 *
 * `chemin` arrive normalisé (minuscules, sans barre finale, sans préfixe de
 * langue). `lirePlan` rend le plan du site (lib/referencement.ts), ou null
 * quand l'API ne répond pas : on ne le lit QUE pour les quelques adresses où
 * un contenu publié depuis pourrait reprendre la main — une visite ordinaire
 * ne coûte aucun appel.
 */
export async function destinationAncienne(
  chemin: string,
  lirePlan: () => Promise<PlanDuSite | null>,
): Promise<Destination | null> {
  let m: RegExpMatchArray | null;

  /** Une fiche : elle-même, ou sa remplaçante si elle a quitté le catalogue. */
  const fiche = async (slug: string): Promise<string> => {
    const remplacante = FICHES_RETIREES[slug];
    if (!remplacante) return `/affiches/${slug}`;
    const plan = await lirePlan();
    if (plan?.produits.some((p) => p.slug === slug)) return `/affiches/${slug}`;
    // La remplaçante a pu quitter le catalogue à son tour (ou ne pas exister
    // sur ce serveur-ci) : le rayon Villes plutôt qu'une page introuvable.
    const cible = remplacante.match(/^\/affiches\/([^/?]+)$/)?.[1];
    if (plan && cible && !plan.produits.some((p) => p.slug === cible)) return VILLES;
    return remplacante;
  };

  /** Un rayon : sa forme du menu s'il est ouvert, sinon le plus proche. */
  const rayon = async (slug: string): Promise<string> => {
    const fusion = RAYONS_FUSIONNES[slug];
    if (fusion) return fusion;
    const plan = await lirePlan();
    const ouvert = plan?.rayons.find((r) => r.slug === slug);
    if (ouvert) return adresseDuRayon(ouvert.genre, slug);
    const proche = COLLECTIONS_DISPARUES[slug];
    if (proche) return proche;
    // API muette : on ne sait pas si le rayon existe, sa page tranchera.
    // Sinon, collection inconnue : le catalogue entier.
    return plan ? "/affiches" : adresseDuRayon(null, slug);
  };

  // Les plans du site : celui de Shopify (sitemap_products_1.xml…) et celui
  // que construisait Astro (sitemap-index.xml, sitemap-0.xml). Google les a
  // en mémoire ; il n'y en a plus qu'un.
  if (/^\/sitemap[-_][^/]*\.xml$/.test(chemin)) return { vers: "/sitemap.xml" };

  // Les fiches, sous leurs deux formes Shopify.
  if (chemin === "/products") return { vers: "/affiches" };
  if ((m = chemin.match(/^\/products\/([^/]+)$/))) return { vers: await fiche(m[1]!) };
  if ((m = chemin.match(/^\/collections\/[^/]+\/products\/([^/]+)$/)))
    return { vers: await fiche(m[1]!) };

  // Une fiche du nouveau site qui a quitté le catalogue (lien déjà suivi
  // une fois, ou recopié depuis Google).
  if ((m = chemin.match(/^\/affiches\/([^/]+)$/)) && FICHES_RETIREES[m[1]!]) {
    const vers = await fiche(m[1]!);
    return vers === chemin ? null : { vers };
  }

  // Les collections.
  if (chemin === "/collections" || chemin === "/collections/all")
    return { vers: "/affiches" };
  // Les listes par fournisseur et par type (/collections/vendors?q=CRIEL) :
  // le fournisseur, c'est le lieu — la recherche le retrouve.
  if (/^\/collections\/(vendors|types)$/.test(chemin))
    return { vers: "/recherche", garder: ["q"] };
  if ((m = chemin.match(/^\/collections\/([^/]+)$/))) return { vers: await rayon(m[1]!) };

  // Les pages libres renommées ou disparues.
  if ((m = chemin.match(/^\/pages\/([^/]+)$/)) && PAGES_SHOPIFY[m[1]!]) {
    const plan = await lirePlan();
    if (plan?.pages.some((p) => p.slug === m![1])) return null;
    return { vers: PAGES_SHOPIFY[m[1]!]! };
  }

  // Les pages légales de Shopify.
  if (chemin === "/policies") return { vers: "/pages/conditions-de-vente" };
  if ((m = chemin.match(/^\/policies\/([^/]+)$/)))
    return { vers: POLITIQUES[m[1]!] ?? "/pages/conditions-de-vente" };

  // Le blog : un seul, « Infos », resté vide. Le plus proche est l'accueil.
  if (/^\/blogs(\/.*)?$/.test(chemin)) return { vers: "/" };

  // La recherche, le panier et le compte.
  if (chemin === "/search") return { vers: "/recherche", garder: ["q"] };
  if (chemin === "/cart") return { vers: "/panier" };
  if (chemin === "/account/login") return { vers: "/compte/connexion" };
  if (chemin === "/account/register") return { vers: "/compte/inscription" };
  // Droit à la connexion, et non à /compte, qui y renvoie à son tour (302) :
  // un saut au lieu de deux. Une cliente déjà connectée est renvoyée par la
  // page de connexion vers son compte.
  if (chemin === "/account") return { vers: "/compte/connexion" };

  return null;
}

/**
 * LES IMAGES DE MEMORYLINE.FR (/cdn/shop/files/…).
 *
 * Shopify sert les visuels de la boutique sous le domaine lui-même
 * (memoryline.fr/cdn/shop/files/vieuxmoulinaffichepersonnalisee.jpg) : ce
 * sont ces adresses que Google Images a pu indexer, et que des sites ou des
 * épingles Pinterest ont recopiées. Après la bascule, elles répondraient 404.
 *
 * Or l'import a gardé le nom de chaque fichier : apps/api/scripts/fetch-assets.ts
 * a rangé chaque visuel sous « <empreinte>-<nom d'origine> », le nom coupé à
 * soixante caractères (avant l'extension) et ses caractères spéciaux changés
 * en tirets. On refait ici exactement ce calcul, et on cherche le visuel qui
 * porte ce nom parmi ceux des fiches en vente (plan du site, gardé cinq
 * minutes) : l'ancienne image mène à la même, en grand, par un 301 — le code
 * qui transmet aussi le référencement d'une image. Relevé le 7 octobre sur le
 * plan du site Shopify : 172 visuels sur 191 retrouvent le leur, chacun celui
 * de la même fiche. Les 19 autres restent en 404 : ceux des 18 fiches
 * retirées (FICHES_RETIREES), et l'ancien visuel de Cayeux-sur-Mer, que la
 * fiche n'a plus.
 *
 * Les anciennes tailles de Shopify (« _600x », « _grande », « @2x »…) sont
 * reconnues si le nom exact ne donne rien. Le logo de la boutique mène au logo.
 *
 * `nom` arrive décodé. null : pas d'équivalent, la page introuvable répond.
 */
export async function imageAncienne(
  nom: string,
  lirePlan: () => Promise<PlanDuSite | null>,
): Promise<string | null> {
  if (/^memoryline_logo/i.test(nom)) return "/logo-memory-line.png";
  const plan = await lirePlan();
  if (!plan) return null;
  const visuels = plan.produits.flatMap((p) => p.images ?? []);
  const trouver = (n: string) => {
    const voulu = nomImporte(n).toLowerCase();
    return visuels.find((v) => v.replace(/^\/assets\/[0-9a-f]{8}-/, "").toLowerCase() === voulu);
  };
  const visuel =
    trouver(nom) ??
    trouver(
      nom.replace(
        /_(\d+x\d*|x\d+|pico|icon|thumb|small|compact|medium|large|grande|original|master)(_crop_[a-z]+)?(@\dx)?(\.[^.]+)$/i,
        "$4",
      ),
    );
  return visuel ? assetUrl(visuel, 1400) : null;
}

/** Le nom qu'un fichier de Shopify a reçu à l'import (fetch-assets.ts, localName), sans l'empreinte. */
function nomImporte(nom: string): string {
  const point = nom.lastIndexOf(".");
  const extension = point > 0 ? nom.slice(point) : "";
  const racine = nom.slice(0, nom.length - extension.length).slice(0, 60);
  return racine.normalize("NFD").replace(/[^a-zA-Z0-9._-]+/g, "-") + extension;
}
