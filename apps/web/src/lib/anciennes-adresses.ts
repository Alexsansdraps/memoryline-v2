/**
 * LES ANCIENNES ADRESSES DE MEMORYLINE.FR, ET OÙ CHACUNE MÈNE.
 *
 * Le site remplace la boutique Shopify sous le même nom de domaine. Toutes ses
 * adresses — indexées par Google, gardées en favori, imprimées sur des
 * cartes — doivent mener quelque part le jour de la bascule, EN UN SEUL SAUT
 * et en 301 (« déplacé pour de bon »), le seul code qui transmet le
 * référencement de l'ancienne adresse à la nouvelle. Le middleware
 * (src/middleware.ts) applique ce fichier ; c'est ici, et nulle part
 * ailleurs, qu'on lit et qu'on corrige les correspondances — sauf celles des
 * collections, partagées avec le back-office dans
 * packages/types/src/rayons-sans-page.ts.
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
import { COLLECTIONS_DISPARUES, RAYONS_FUSIONNES } from "@memoryline/types";
import { assetUrl, type PlanDuSite } from "./api.ts";
import { adresseDuRayon } from "./referencement.ts";

/** Le rayon « Villes », tel que le menu y mène. */
const VILLES = adresseDuRayon("personnalisable", "villes");
const PERSONNALISABLES = adresseDuRayon("personnalisable");

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
 * Les rayons techniques de Shopify fusionnés dans une autre page
 * (RAYONS_FUSIONNES), et les collections Shopify vides qui mènent au rayon
 * le plus proche tant qu'elles le restent (COLLECTIONS_DISPARUES).
 *
 * Les deux tables vivent dans @memoryline/types (rayons-sans-page.ts) : le
 * back-office les lit aussi, pour ne plus proposer de ranger une page que le
 * site n'a pas (BO › Produits › Ordre d'affichage). C'est là qu'on les lit et
 * qu'on les corrige ; elles restent exportées d'ici pour le site.
 */
export { RAYONS_FUSIONNES, COLLECTIONS_DISPARUES };

/**
 * Les pages libres de Shopify dont l'adresse change. Une page publiée au
 * back-office sous la même adresse passe devant (la recréer avec son texte
 * est même le mieux pour /pages/affiches-personnalisables).
 */
export const PAGES_SHOPIFY: Record<string, string> = {
  // La page d'atterrissage « Affiches personnalisables » : le rayon du même nom.
  "affiches-personnalisables": PERSONNALISABLES,
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
  // Une collection filtrée par étiquette (/collections/villes/paris) : le
  // rayon lui-même. Les fiches vues depuis une collection sont prises plus
  // haut (/collections/<c>/products/<h>).
  if ((m = chemin.match(/^\/collections\/([^/]+)\/[^/]+$/)))
    return { vers: await rayon(m[1]!) };

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

  // Le blog et la page d'essai de Shopify n'ont pas d'équivalent : ils
  // répondent 410 (adresseDisparue, plus bas), plus l'accueil.

  // La recherche, le panier et le compte.
  if (chemin === "/search") return { vers: "/recherche", garder: ["q"] };
  if (chemin === "/cart") return { vers: "/panier" };
  if (chemin === "/account/login") return { vers: "/compte/connexion" };
  if (chemin === "/account/register") return { vers: "/compte/inscription" };
  // Droit à la connexion, et non à /compte, qui y renvoie à son tour (302) :
  // un saut au lieu de deux. Une cliente déjà connectée est renvoyée par la
  // page de connexion vers son compte.
  if (chemin === "/account") return { vers: "/compte/connexion" };
  // Les autres pages du compte (commandes, adresses…) et le lien « Se
  // connecter » du thème : la connexion, d'où une cliente connectée rejoint
  // son compte.
  if (/^\/account\/.+$/.test(chemin) || /^\/customer_authentication(\/.*)?$/.test(chemin))
    return { vers: "/compte/connexion" };
  // Un lien de code promo (/discount/NOEL10) : Shopify posait le code puis
  // menait à l'accueil. Le code se saisit au panier ; on mène à l'accueil,
  // suivi utm_* compris (AUDIT-SEO.md, MIG-6).
  if (/^\/discount\/[^/]+$/.test(chemin)) return { vers: "/" };

  return null;
}

/**
 * Les anciennes adresses de Shopify qui n'ont AUCUN équivalent : le blog
 * (« Infos », resté vide : aucun article dans le plan du site de Shopify) et
 * la page d'essai « mode boutique ». Elles répondent 410, « disparu pour de
 * bon ».
 *
 * Elles menaient à l'accueil. Mais Google traite une redirection vers
 * l'accueil comme une page introuvable déguisée (« soft 404 »), et la
 * visiteuse qui arrivait d'un vieux lien croyait à une erreur de lien. Le 410
 * dit vrai, et Google retire l'adresse plus vite qu'un 404
 * (AUDIT-SEO.md, MIG-5).
 *
 * Une page publiée au back-office sous /pages/mode-boutique, ou une
 * redirection posée au back-office (middleware.ts, lue avant), reprend la
 * main. API muette : on ne tranche pas, la page dira 404.
 */
export async function adresseDisparue(
  chemin: string,
  lirePlan: () => Promise<PlanDuSite | null>,
): Promise<boolean> {
  if (/^\/blogs(\/.*)?$/.test(chemin)) return true;
  if (chemin === "/pages/mode-boutique") {
    const plan = await lirePlan();
    return !!plan && !plan.pages.some((p) => p.slug === "mode-boutique");
  }
  return false;
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
  const sansTaille = nom.replace(
    /_(\d+x\d*|x\d+|pico|icon|thumb|small|compact|medium|large|grande|original|master)(_crop_[a-z]+)?(@\dx)?(\.[^.]+)$/i,
    "$4",
  );
  const visuel = trouver(nom) ?? trouver(sansTaille) ?? visuelDeLaFiche(sansTaille, plan);
  return visuel ? assetUrl(visuel, 1400) : null;
}

/**
 * Les visuels de memoryline.fr que l'import n'a pas gardés, et la fiche
 * Shopify qui les portait (plan du site de Shopify, relevé du 22/10 :
 * AUDIT-SEO.md, MIG-7). Ce sont ceux des fiches retirées, plus un ancien
 * visuel de Cayeux que sa fiche n'a plus. Liste figée : Shopify ne publiera
 * plus de nouvelles images.
 */
const IMAGES_DES_ANCIENNES_FICHES: Record<string, string> = {
  "berck-affichepersonnalisee.png": "berck-affiche-personnalisee",
  "cayeux-sur-mercabines-affichepersonnalisee.png": "cayeux-sur-mer-cabines-affiche-personnalisee",
  "cayeux-sur-mercabines-affichepersonnalisee_2aa0c661-06a9-472d-8214-771e95651b0d.png":
    "cayeux-sur-mer-affiche-personnalisee",
  "crielcabines-affichepersonnalisee.svg": "criel-cabines-affiche-personnalisee",
  "dieppecabines-affichepersonnalisee.png": "dieppe-sunset-affiche-personnalisee-copie",
  "dieppecerfs-volants-affichepersonnalisee.png": "dieppe-cerfs-volants-affiche-personnalisee",
  "dieppefalaises-affichepersonnalisee_794994d2-c266-409e-8e6f-5db2111e270f.png":
    "dieppe-falaises-affiche-personnalisee",
  "dieppeplage-affichepersonnalisee.png": "dieppe-sunset-affiche-personnalisee",
  "fortmahonbellesdunes-affichepersonnalisee.png": "fort-mahon-belles-dunes-affiche-personnalisee",
  "letouquetcabines-affichepersonnalisee.png": "le-touquet-cabines-2-affiche-personnalisee",
  "letouquetcabines_2-affichepersonnalisee.png": "le-touquet-cabines-affiche-personnalisee",
  "letreportfetedelameraffichepersonnalisee.svg": "le-treport-fete-de-la-mer-affiche-personnalisee",
  "mers-les-bainsvillas_2-affichepersonnalisee.png": "mers-les-bains-villas-2-affiche-personnalisee",
  "mesnil-val-affichepersonnalisee_1.png": "menisl-val-affiche-personnalisee",
  "saint-maloremparts-affichepersonnalisee_1_8eec70f2-67ee-4938-a29f-5b257ca43b71.png":
    "saint-malo-remparts-affiche-personnalisee",
  "saint-valery-en-caux-affichepersonnalisee_1.png": "saint-valery-en-caux-affiche-personnalisee",
  "saint-valery-sur-merport-affichepersonnalisee.png":
    "saint-valery-sur-somme-port-affiche-personnalisee",
  "stellacabines-affichepersonnalisee.png": "cucq-stella-cabines-affiche-personnalisee",
  "veules-les-roses-affichepersonnalisee_1.png": "veules-les-roses-affiche-personnalisee",
};

/**
 * Le visuel qui remplace une image de memoryline.fr sans équivalent : le
 * premier visuel de sa fiche si elle est encore en vente, sinon celui de la
 * fiche qui la remplace (FICHES_RETIREES), comme la page de la fiche y mène
 * déjà. Une fiche retirée qui ne mène qu'à un rayon (Veules-les-Roses,
 * Saint-Valery-en-Caux) n'a pas d'affiche à montrer : son image reste
 * introuvable, plutôt qu'une image sans rapport.
 */
function visuelDeLaFiche(nom: string, plan: PlanDuSite): string | undefined {
  const handle = IMAGES_DES_ANCIENNES_FICHES[nom.toLowerCase()];
  if (!handle) return undefined;
  const premier = (slug: string) => plan.produits.find((p) => p.slug === slug)?.images?.[0];
  const remplacante = FICHES_RETIREES[handle]?.match(/^\/affiches\/([^/?]+)$/)?.[1];
  return premier(handle) ?? (remplacante ? premier(remplacante) : undefined);
}

/** Le nom qu'un fichier de Shopify a reçu à l'import (fetch-assets.ts, localName), sans l'empreinte. */
function nomImporte(nom: string): string {
  const point = nom.lastIndexOf(".");
  const extension = point > 0 ? nom.slice(point) : "";
  const racine = nom.slice(0, nom.length - extension.length).slice(0, 60);
  return racine.normalize("NFD").replace(/[^a-zA-Z0-9._-]+/g, "-") + extension;
}
