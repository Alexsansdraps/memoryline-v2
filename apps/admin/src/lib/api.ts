import type { CouleursImage, GroupeCouleur } from "@memoryline/types";
import {
  RECHERCHE_LIMITE_PANNEAU,
  type GroupeId,
  type ReponseRecherche,
} from "@memoryline/types/recherche";
import { apiInterne } from "./api-interne.ts";
/**
 * Client API du back-office. Lecture ET écriture (le BO modifie la config).
 * SSR -> on parle à l'API via le réseau interne Docker (api:3000) en conteneur,
 * sinon localhost:3000 en dev local.
 */
const API_URL =
  apiInterne();

/**
 * Appel API. `cookie` (optionnel) = en-tête Cookie de la requête entrante du
 * BO, à relayer pour authentifier les routes /admin/* protégées.
 */
async function req<T>(
  method: string,
  path: string,
  body?: unknown,
  cookie?: string,
): Promise<T> {
  const headers: Record<string, string> = {};
  if (body) headers["Content-Type"] = "application/json";
  if (cookie) headers["cookie"] = cookie;
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    // L'API refuse parfois pour une raison qui se lit (« 3 produits sont
    // rangés dans cette catégorie ») : la garder vaut mieux que d'afficher un
    // code que la cliente devrait interpréter.
    const brut = await res.text().catch(() => "");
    let raison = "";
    try {
      raison = String((JSON.parse(brut) as { error?: unknown }).error ?? "");
    } catch {
      /* réponse non JSON (404 du proxy, page d'erreur) : on garde le code */
    }
    throw new Error(
      raison || `API ${method} ${path} -> ${res.status}`,
    );
  }
  return res.json() as Promise<T>;
}

/**
 * Les textes d'une ligne dans les autres langues du site, tels que saisis au
 * back-office (sans repli sur le français) : langue → champ → texte. Une
 * langue ou un champ absent affiche le français sur le site.
 */
export type TraductionsDe<Champ extends string> = Partial<
  Record<string, Partial<Record<Champ, string>>>
> | null;

/** La réponse des routes d'enregistrement : le dictionnaire entier, enregistré. */
interface TraductionsEnregistrees<Champ extends string> {
  translations: TraductionsDe<Champ>;
}

export interface PromoRule {
  id: number;
  name: string;
  type: string;
  config: Record<string, unknown>;
  code: string | null;
  active: boolean;
  priority: number;
  startsAt: string | null;
  endsAt: string | null;
  /** Le nom — celui de la ligne de remise du panier — dans les autres langues. */
  translations?: TraductionsDe<"name">;
  /** Non nul = archivée : rangée dans « Promotions archivées », ne s'applique plus. */
  archivedAt?: string | null;
}

/**
 * Un message du bandeau d'annonce : un texte, un bouton facultatif (texte et
 * adresse), actif ou non, sa période et sa place dans le défilement. Il
 * n'annonce plus de promotion : celles-ci se règlent dans Promotions.
 */
export interface Banner {
  id: number;
  message: string;
  linkUrl: string | null;
  linkLabel: string | null;
  /** Historique : les couleurs se règlent désormais pour tout le bandeau. */
  bgColor: string | null;
  textColor: string | null;
  active: boolean;
  startsAt?: string | null;
  endsAt?: string | null;
  /** Sa place dans le défilement (puis l'ordre de création). */
  position?: number;
  /** Non nul = archivé : rangé dans « Messages archivés ». */
  archivedAt?: string | null;
  /** Le message et le texte du lien dans les autres langues. */
  translations?: TraductionsDe<"message" | "linkLabel">;
}

/** Ce qui vaut pour tout le bandeau : ses couleurs, et la durée de chaque message. */
export interface ReglagesBandeau {
  fond: string;
  texte: string;
  dureeSecondes: number;
}

/**
 * Le bandeau tel que le back-office le lit : les réglages (et s'ils ont déjà
 * été enregistrés), puis tous les messages, éteints et archivés compris.
 */
export interface BannerBo {
  reglages: ReglagesBandeau;
  reglagesEnregistres: boolean;
  messages: Banner[];
}

export interface Stats {
  products: number;
  collections: number;
  customers: number;
  orders: number;
  ordersByChannel: Record<string, number>;
}

/** Catégorie de personnages (table character_category). */
export interface CharacterCategory {
  id: number;
  slug: string;
  name: string;
  position: number;
  /**
   * Non nul = archivée : hors du configurateur et de la liste ordinaire,
   * rangée dans « Catégories archivées ». Ses personnages ne bougent pas.
   */
  archivedAt?: string | null;
  /** Le nom dans les autres langues : { en: { name }, … }. */
  translations?: Partial<Record<string, { name?: string }>> | null;
  /** Nombre de personnages non archivés rattachés (renvoyé par /admin/categories). */
  count?: number;
}

/** Cadre proposé en option lors de la personnalisation. */
export interface Cadre {
  id: number;
  /** Le nom (la couleur) dans les autres langues : { en: { name }, … }. */
  translations?: Partial<Record<string, { name?: string }>> | null;
  slug: string;
  name: string;
  /** Supplément pour une affiche A4, en centimes. */
  priceA4Cents: number;
  /** Supplément pour une affiche A3, en centimes : un cadre plus grand. */
  priceA3Cents: number;
  /** Poids du cadre, ajouté à celui de l'affiche quand il est vendu avec. */
  weightGrams: number;
  previewColor: string | null;
  active: boolean;
  position: number;
  /**
   * Non nul = archivé : hors du configurateur et de la liste ordinaire, rangé
   * dans « Cadres archivés ». Son nom reste lisible sur les commandes déjà
   * passées et dans le nom des fichiers d'impression.
   */
  archivedAt?: string | null;
}

/**
 * Type d'affiche : « de face », « de dos », et ceux créés au back-office.
 * Le `slug` relie personnages, pièces et produits à leur type ; il ne change
 * jamais après la création.
 */
export interface TypeAffiche {
  id: number;
  slug: string;
  name: string;
  foregroundUrl: string | null;
  active: boolean;
  position: number;
  /** Non nul = archivé : hors du site et des listes, restaurable. */
  archivedAt?: string | null;
  /** Ce qui s'y rattache — redit avant d'archiver. */
  usage?: { produits: number; personnages: number; pieces: number };
}

/** Compte d'accès au back-office. */
export interface CompteAdmin {
  id: number;
  email: string;
  /** « owner » (tous droits) ou « seller » (lecture seule). */
  role: string;
  createdAt: string;
  /** Une session ouverte en ce moment. */
  connecte: boolean;
  /** C'est le compte avec lequel on est connecté. */
  moi: boolean;
  /**
   * Non nul = archivé : le compte ne peut plus se connecter et quitte la
   * liste ordinaire, rangé dans « Comptes archivés ». L'historique des
   * commandes garde son nom.
   */
  archivedAt?: string | null;
  /**
   * Les stands confiés à un vendeur : il ne voit que leurs ventes, et
   * aucune si la liste est vide. Sans effet pour un propriétaire.
   */
  standIds?: number[];
}

/** Adresse laissée dans le formulaire de la lettre d'information. */
export interface Inscrit {
  id: number;
  email: string;
  langue: string | null;
  createdAt: string;
}

/**
 * Catégorie de produits (« Affiches », « Magnets »…). Elle porte le poids par
 * défaut de ce qu'elle contient : c'est là que la cliente le saisit une fois
 * pour toutes, les produits n'ayant à le reprendre qu'en cas d'exception.
 */
export interface CategorieProduit {
  id: number;
  slug: string;
  name: string;
  description: string | null;
  defaultWeightGrams: number;
  active: boolean;
  position: number;
  /**
   * Non nul = archivée : hors du site et de la liste ordinaire, rangée dans
   * « Catégories archivées ». Ses produits gardent leur rangement.
   */
  archivedAt?: string | null;
  /** Nombre de produits rangés dedans (renvoyé par /admin/product-categories). */
  produits?: number;
}

/**
 * Un bloc d'une page du site.
 *
 * Cinq formes possibles, pas une de plus : c'est ce qui permet à l'éditeur de
 * rester compréhensible sans formation. Le type est volontairement large côté
 * client — c'est l'API qui refuse un bloc mal formé, et elle seule.
 */
export interface BlocPage {
  type: "titre" | "texte" | "image" | "produits" | "bouton";
  [cle: string]: unknown;
}

/** Une page du site telle que la liste du back-office la montre. */
export interface ResumePage {
  id: number;
  slug: string;
  title: string;
  status: string;
  /** « site », « stand » ou « les-deux » : où la page se montre. */
  affichage?: string;
  /** Son rang dans « Pages du site » ; 0 = pas encore rangée. */
  position?: number;
  /** Le titre dans les autres langues, quand il est traduit. */
  titres?: Record<string, string>;
  /** Non nul = archivée : hors du site, rangée dans « Pages archivées ». */
  archivedAt?: string | null;
  updatedAt: string;
}

/** Une collection telle que la boutique la sert : active, et avec des affiches en ligne. */
export interface CollectionEnLigne {
  id: number;
  slug: string;
  name: string;
  produits: number;
}

/** Tout ce qu'il faut pour éditer une page, et de quoi remplir ses listes. */
export interface PageCms {
  page: {
    id: number;
    slug: string;
    title: string;
    status: string;
    seoTitle: string | null;
    seoDescription: string | null;
    blocks: BlocPage[];
    /** « site », « stand » ou « les-deux » : où la page se montre. */
    affichage?: string;
    /**
     * Par langue : le nom, le texte, et le référencement (titre et
     * description Google). Hors du français, un référencement non traduit
     * laisse le site retomber sur le nom traduit.
     */
    translations: Record<
      string,
      { title?: string; blocks?: BlocPage[]; seoTitle?: string; seoDescription?: string }
    > | null;
    createdAt: string;
    updatedAt: string;
  };
  collections: { id: number; slug: string; name: string }[];
  categories: { id: number; name: string }[];
}

/** Une entrée du menu du site, avec ses sous-liens. */
export interface EntreeMenu {
  id?: number;
  label: string;
  href: string;
  visible: boolean;
  translations?: Record<string, { label?: string }> | null;
  enfants: EntreeMenu[];
}

/** Un lien retiré du menu, gardé pour pouvoir le remettre. */
export interface LienArchive {
  id: number;
  label: string;
  href: string;
  /** Nom de l'entrée dont il était le sous-lien, ou null au premier niveau. */
  parent: string | null;
  /** Son identifiant : les sous-liens rangés partent avec une entrée supprimée. Absent des anciennes réponses. */
  parentId?: number | null;
  archivedAt: string;
}

/** La réponse d'une suppression définitive réussie (apps/api/src/suppression.ts). */
export interface SuppressionFaite {
  ok: true;
  supprime: true;
}

export interface MenuCms {
  entrees: EntreeMenu[];
  /** Les liens retirés du menu, restaurables. Absent des anciennes réponses. */
  archives?: LienArchive[];
}

/** Ce qu'un import ferait, ou vient de faire, sur une fiche produit. */
export interface LigneImport {
  /** L'adresse du produit dans le fichier : c'est elle qui identifie. */
  handle: string;
  nom: string;
  action: "creation" | "mise-a-jour" | "inchange" | "refus";
  /** Pourquoi la ligne est refusée, en français. */
  raison?: string;
  /** Ce qui change, phrase par phrase : « prix A3 : 29 € vers 31 € ». */
  changements: string[];
  collections: string[];
  formats: { format: string; prixCents: number; sku: string | null }[];
  /** Renseigné après application : de quoi enchaîner sur les images. */
  produitId?: number;
  /** Vrai quand la fiche n'a encore aucune image. */
  sansImage?: boolean;
}

/** Le résultat d'un import, qu'il ait été appliqué ou seulement simulé. */
export interface ResultatImport {
  applique: boolean;
  lignes: number;
  produits: number;
  /** Collections créées au passage, parce qu'une étiquette les nommait. */
  collectionsCreees: string[];
  apercu: LigneImport[];
  erreurs: { ligne: number; message: string }[];
}

/**
 * Une collection : la façon dont la boutique range ses affiches.
 *
 * C'est ce que l'ancienne boutique appelait déjà collection, et ce que le
 * back-office appelait catégorie. Un seul mot désormais, et un seul endroit :
 * les catégories étaient restées vides depuis le premier jour.
 */
export interface CollectionBo {
  id: number;
  slug: string;
  name: string;
  description: string | null;
  position: number;
  active: boolean;
  /**
   * Non nul = archivée : hors boutique et hors liste ordinaire, rangée dans
   * « Collections archivées ». Son rangement d'affiches reste intact.
   */
  archivedAt?: string | null;
  /** Poids d'un article de cette collection, quand rien de plus précis ne le dit. */
  defaultWeightGrams: number | null;
  /** Nombre de produits dedans, tous statuts confondus. */
  produits: number;
  /** Le nom (titre du rayon) et la description dans les autres langues. */
  translations?: TraductionsDe<"name" | "description">;
}

/** Un produit vu depuis sa collection : de quoi le reconnaître d'un coup d'œil. */
export interface ProduitDeCollection {
  id: number;
  name: string;
  slug: string;
  status: string;
  image: string | null;
  prixMin: number | null;
  prixMax: number | null;
  formats: string[];
}

/** Une page de liste du site dont la boutique règle l'ordre des affiches. */
export interface PageARanger {
  /** « tout », « personnalisable », « prete_a_imprimer » ou « collection:<id> ». */
  cle: string;
  nom: string;
  /** Son adresse sur le site, sans le domaine. */
  lien: string;
  /** Affiches en ligne sur cette page. */
  enLigne: number;
  /** Où elle se montre en plus : « vitrine de l'accueil », « rangée de la page … ». */
  usages: string[];
  /**
   * Une collection sans page à elle sur le site : fusionnée dans un autre
   * rayon (« Personnages de dos » → « Villes »), ou vide (son adresse répond
   * « introuvable », ou mène au rayon le plus proche). Absent ou null : elle
   * a sa page. `versCle` : la page de l'écran qui range ce qu'on y voit.
   */
  sansPage?: {
    raison: "fusionnee" | "vide";
    vers: string | null;
    versNom: string | null;
    versCle: string | null;
  } | null;
}

/**
 * Un stand : un endroit et un moment où l'on vend en personne.
 *
 * Plusieurs peuvent être ouverts en même temps, chacun avec son code : c'est
 * ce qui permet de savoir, des mois plus tard, lequel a bien marché.
 */
export interface StandBo {
  id: number;
  /**
   * Le code d'accès de la tablette. Null pour un vendeur : seule la
   * propriétaire le voit et le donne (il permet d'enregistrer des ventes).
   */
  code: string | null;
  nom: string;
  ouvert: boolean;
  createdAt: string;
  closedAt: string | null;
  /**
   * Non nul = archivé : hors de la liste ordinaire, rangé dans « Stands
   * archivés ». Toujours fermé, donc sa tablette n'accepte plus rien. Ses
   * ventes gardent son nom.
   */
  archivedAt?: string | null;
  /** Commandes prises sur ce stand, paniers en cours exclus. */
  commandes: number;
  /** Ce qu'elles totalisent, en centimes. */
  cents: number;
}

/**
 * Un lieu où retirer sa commande (apps/api/src/lieux-retrait.ts) : le chalet
 * du marché de Noël, l'atelier. Proposé à la caisse s'il est actif et pas
 * archivé, dans l'ordre réglé.
 */
export interface LieuRetraitBo {
  id: number;
  nom: string;
  /** Sur plusieurs lignes ; ne se traduit pas. */
  adresse: string | null;
  /** Horaires, accès… sur plusieurs lignes. */
  description: string | null;
  active: boolean;
  position: number;
  translations?: TraductionsDe<"nom" | "description"> | null;
  /** Non nul = archivé : hors de la caisse, rangé dans « Lieux archivés ». */
  archivedAt?: string | null;
}

/**
 * Une redirection d'ancienne adresse (apps/api/src/redirections-ecran.ts),
 * telle que BO › Redirections la montre.
 */
export interface RedirectionBo {
  id: number;
  /** Chemin du site, sans langue, en minuscules : « /products/vieux-moulin ». */
  fromPath: string;
  /** Chemin du site, ou adresse complète d'un autre site. */
  toPath: string;
  /** 301 (définitive) ou 302 (temporaire). */
  code: number;
  /** Non nul = archivée : elle ne s'applique plus. */
  archivedAt: string | null;
  /** Forme /affiches/… → /affiches/… : celle que pose un changement d'adresse d'affiche. */
  affiche: boolean;
  externe: boolean;
  /** Où elle mène au bout du compte (« Affiche « Colmar » ») et ce qui cloche ; null pour une archivée. */
  cible: { libelle: string | null; alerte: string | null } | null;
  /** Où le site la conduit, quand sa nouvelle adresse est elle-même redirigée ; null sinon. */
  finale: string | null;
  /** Les anciennes adresses dont la redirection passe par celle-ci. */
  relais: string[];
}

/**
 * Ce que rend un ajout, une modification ou une restauration : la
 * redirection écrite, ou la page qu'elle détournerait (`aConfirmer`, avec
 * l'adresse et ce vers quoi elle mènerait), auquel cas rien n'est écrit tant
 * qu'on ne renvoie pas `confirmer`.
 */
export type ReponseRedirection =
  | {
      ok: true;
      redirection: RedirectionBo;
      /**
       * Ce que l'API a corrigé ou constaté : chemin ramené, cible remplacée
       * par sa destination finale, redirections qui passent par elle…
       */
      notes: string[];
    }
  | { ok: false; aConfirmer: string; fromPath?: string; toPath?: string; notes: string[] };

/** L'aperçu (ou le compte rendu) d'un import de redirections. */
export interface ResultatImportRedirections {
  applique: boolean;
  lignes: number;
  /** Les colonnes reconnues dans l'en-tête, ou null sans en-tête. */
  entete: { ancienne: string; nouvelle: string } | null;
  apercu: {
    ligne: number;
    ancienne: string;
    nouvelle: string;
    fromPath: string | null;
    toPath: string | null;
    action: "creation" | "deja-la" | "refus";
    raison: string | null;
    notes: string[];
    /** Pour une ligne à créer : où elle mène, et ce qui cloche (une affiche introuvable…). */
    cible: { libelle: string | null; alerte: string | null } | null;
  }[];
  compte: { creation: number; "deja-la": number; refus: number };
}

/**
 * L'identité de la boutique sur ses factures (BO › Factures) : mentions
 * obligatoires, figées sur chaque facture au moment de son numéro.
 */
export interface ReglagesFacture {
  /** Une ligne par ligne d'adresse, 4 au plus. */
  adresse: string;
  /** 14 chiffres, ou null. */
  siret: string | null;
  /** « 123 456 789 00012 », tel qu'imprimé. */
  siretGroupe: string | null;
  mention: string | null;
}

/**
 * Une case de l'écran Paiements, telle que l'API la décrit : JAMAIS sa
 * valeur. « bo » : saisie ici (avec sa fin) ; « env » : renseignée dans le
 * .env du serveur (sans rien d'elle) ; « a_ressaisir » : la clé de
 * chiffrement du serveur a changé depuis l'enregistrement.
 */
export interface CasePaiement {
  champ: string;
  libelle: string;
  etat: "vide" | "bo" | "env" | "a_ressaisir";
  le: string | null;
  par: string | null;
  fin: string | null;
  /** L'effacer retirerait le prestataire de la caisse : confirmation exigée. */
  effacementRetire: boolean;
  /**
   * Ce que l'effacer changerait à la caisse : « retire » (le prestataire
   * n'y est plus proposé), « serveur » (elle reprend les clés des réglages du
   * serveur), null (rien : la case ne sert pas au jeu en service).
   */
  apresEffacement: "retire" | "serveur" | null;
}

/** Une colonne (essai ou pour de vrai) d'un prestataire. */
export interface ColonnePaiement {
  champs: CasePaiement[];
  /** Ce qui sert vraiment dans ce mode. */
  source: "bo" | "env" | "incomplet_env" | "incomplet" | "aucune";
  /** Ce jeu sert-il en ce moment aux nouveaux paiements ? */
  actif: boolean;
  /** Colonne live complète, en attente d'une vérification réussie pour servir. */
  enAttente: boolean;
  verifiable: boolean;
  /** Ce que « Vérifier » essaierait : les clés saisies ici, celles du serveur, ou rien. */
  verifieQuoi: "bo" | "env" | null;
  /** Colonne entamée ici : ce qui manque pour la vérifier (« la clé publique »). */
  manque: string[];
  verification: {
    ok: boolean;
    message: string;
    compte: string | null;
    /** D'où venaient les clés vérifiées. */
    source: "bo" | "env" | null;
    le: string;
    par: string | null;
    /** Faux si une valeur a changé depuis : à refaire. */
    aJour: boolean;
  } | null;
}

/** L'écran BO › Réglages › Paiements (apps/api/src/paiements-reglages.ts). */
export interface EtatPaiements {
  resume: string;
  ton: "essai" | "reel" | "mixte" | "aucun";
  /** Ce que dit l'interrupteur ; « env » : jamais touché, le .env décide. */
  choisi: "essai" | "reel" | "env";
  actif: {
    stripe: { mode: "test" | "live"; source: "bo" | "env" } | null;
    paypal: { mode: "test" | "live"; source: "bo" | "env" } | null;
  };
  chiffrement: {
    possible: boolean;
    source: "APP_SECRET" | "DATABASE_URL" | null;
    /** La colonne « Pour de vrai » est-elle ouverte (APP_SECRET longue) ? */
    live: boolean;
    /** Sinon, pourquoi, et quoi faire. */
    raisonLive: string | null;
  };
  bascule: { possible: boolean; raisons: string[] };
  stripe: { test: ColonnePaiement; live: ColonnePaiement };
  paypal: { test: ColonnePaiement; live: ColonnePaiement };
  /** Le compte Stripe live reconnu à la dernière vérification réussie. */
  compteStripeLive: string | null;
  webhook: {
    adresse: string;
    local: boolean;
    evenement: string;
    derniersAvis: { test: string | null; live: string | null };
    /** Le dernier avis refusé : signé avec le secret d'un mode, il se disait de l'autre. */
    avisRefuse: { le: string; secret: "test" | "live"; avis: "test" | "live" } | null;
  };
  /** Où partent les courriers maintenant, et s'ils pourraient partir pour de vrai (Resend). */
  courriels: { voie: "boite" | "resend" | "aucun"; reelsPrets: boolean; manque?: string[] };
  etiquettes: {
    reelles: boolean;
    /** « mode » : elles suivent l'interrupteur (dès qu'il a été réglé). */
    source: "bo" | "env" | "mode";
    configure: boolean;
    /** Ce que diraient les réglages du serveur (SENDCLOUD_ACHATS_REELS). */
    serveur: boolean;
  };
  journal: {
    id: number;
    le: string;
    par: string | null;
    action: string;
    prestataire: string | null;
    mode: string | null;
    champ: string | null;
    valeur: string | null;
    /** Une clé enregistrée à la place d'une autre. */
    remplace: boolean;
    message: string | null;
  }[];
}

/** Ce qu'une écriture de l'écran Paiements répond : une phrase, jamais une valeur. */
export interface ReponsePaiements {
  ok: boolean;
  code?: string;
  message: string;
  verification?: {
    ok: boolean;
    message: string;
    compte: string | null;
    le: string;
    source?: "bo" | "env";
  } | null;
}

/** Où partent les courriers de la boutique en ce moment. */
export interface EtatCourriers {
  configure: boolean;
  /** Vrai quand tout part dans la boîte d'essai, donc vers personne. */
  enEssai: boolean;
  expediteur: string | null;
  copie: string | null;
  boiteTestUrl: string | null;
  /** La phrase que la boutiquière lira : « si j'envoie maintenant, où ça va ». */
  resume: string;
  /** L'adresse du site écrite dans les courriers ; null = ni logo ni liens valables. */
  adressePublique: string | null;
}

/** Un des courriers que la boutique sait envoyer. */
export interface ModeleCourrier {
  id: string;
  nom: string;
  /** À quel moment la boutique l'envoie, en une phrase. */
  quand: string;
  besoinCommande: boolean;
}

/**
 * Un produit vu du back-office.
 *
 * Le site n'a pas besoin du statut ni du poids ; la boutiquière, si. C'est la
 * même table, ce n'est pas la même lecture.
 */
export interface ProduitAdmin {
  id: number;
  name: string;
  slug: string;
  kind: string;
  /** active | draft | archived. Affiché « Actif », « Désactivé », « Archivé ». */
  status: string;
  /**
   * Prix de repli, utilisé seulement par un produit sans aucun format. Ce
   * n'est PAS le prix payé : celui-là est sur la variante.
   */
  basePriceCents: number;
  /** Fourchette des prix des formats. Null quand le produit n'en a aucun. */
  prixMin: number | null;
  prixMax: number | null;
  /**
   * Le prix de chaque format, en centimes (GET /admin/products). Null pour
   * un format dont deux variantes n'ont pas le même prix. Absent d'une API
   * d'avant ce champ : la grille retombe alors sur la fourchette.
   */
  prixParFormat?: Record<string, number | null>;
  /** Les formats existants pour ce produit, par exemple ["A4", "A3"]. */
  formats: string[];
  categoryId: number | null;
  categoryName: string | null;
  /** Null = le produit prend le poids par défaut de sa catégorie. */
  weightGrams: number | null;
  /** Ce qui sera réellement pesé, cadre non compris. */
  poidsEffectif: number;
  aiEnabled: boolean;
  imageUrl: string | null;
  variantes: number;
  /** Ses collections, archivées comprises (marquées). */
  collections: { id: number; name: string; archivee?: boolean }[];
  /** Le type d'affiche (slug d'un type) ; null = celui de la boutique par défaut. */
  defaultView?: string | null;
  /** Seulement quand la liste est demandée `avecDescription`. */
  description?: string | null;
}

/** Une ligne de l'aperçu de la modification groupée : ce qui change, champ par champ. */
export interface ApercuMasse {
  id: number;
  nom: string;
  changements: { champ: string; avant: string; apres: string }[];
  /** La 301 que posera le changement d'adresse, s'il y en a un. */
  redirection: { de: string; vers: string } | null;
}

/** La liste des produits, et de quoi remplir les filtres et les onglets. */
export interface ListeProduitsAdmin {
  produits: ProduitAdmin[];
  categories: { id: number; name: string }[];
  collections: { id: number; name: string }[];
  /** Tous les formats du catalogue, pour ne viser qu'un format à la fois. */
  formats: string[];
  /** Nombres par statut, tous filtres appliqués sauf celui du statut. */
  compte: { tous: number; active: number; draft: number; archived: number };
}

/** Un format d'une affiche : c'est lui qui porte le prix réellement payé. */
export interface VarianteFiche {
  id: number;
  format: string;
  priceCents: number;
  /** Prix barré affiché à côté du prix, quand il y en a un. */
  compareAtCents: number | null;
  /** Ce que le format coûte à produire, pour le calcul de la marge. */
  costCents: number | null;
  sku: string | null;
  barcode: string | null;
  /** Null = ce format prend le poids du produit. */
  weightGrams: number | null;
  poidsEffectif: number;
  /** Null = stock non suivi, ce qui est le cas des affiches. */
  stockQty: number | null;
  stockPolicy: string;
  widthMm: number | null;
  heightMm: number | null;
}

/** Tout ce que la fiche produit du back-office affiche et enregistre. */
export interface FicheProduit {
  produit: {
    id: number;
    name: string;
    slug: string;
    description: string | null;
    status: string;
    kind: string;
    vendor: string | null;
    productType: string | null;
    tags: string[];
    seoTitle: string | null;
    seoDescription: string | null;
    categoryId: number | null;
    weightGrams: number | null;
    poidsEffectif: number;
    aiEnabled: boolean;
    basePriceCents: number;
    createdAt: string;
    updatedAt: string;
  };
  categories: { id: number; name: string; defaultWeightGrams: number }[];
  collections: { id: number; name: string }[];
  collectionsDuProduit: number[];
  images: { id: number; url: string; alt: string | null; position: number }[];
  variantes: VarianteFiche[];
  /** Les étiquettes déjà posées ailleurs, proposées en suggestion. */
  etiquettesConnues: string[];
}

/** Ce qu'une affiche a rapporté sur une période, remboursements déduits. */
export interface VentesProduit {
  produit: string | null;
  jours: number;
  debut: string;
  fin: string;
  unites: number;
  acheteurs: number;
  commandes: number;
  ventesNettesCents: number;
  serie: { jour: string; cents: number }[];
  parCanal: { canal: string; unites: number; cents: number }[];
  clients: { nouveaux: number; recurrents: number };
}

/** Tout ce qu'il faut pour régler le poids d'un produit et de ses formats. */
export interface LogistiqueProduit {
  produit: {
    id: number;
    name: string;
    categoryId: number | null;
    /** Null = le produit prend le poids par défaut de sa catégorie. */
    weightGrams: number | null;
  };
  categorie: CategorieProduit | null;
  categories: CategorieProduit[];
  variantes: {
    id: number;
    format: string;
    sku: string | null;
    /** Null = la variante prend le poids du produit. */
    weightGrams: number | null;
    /** Ce qui sera réellement pesé, cadre non compris. */
    poidsEffectif: number;
  }[];
}

/** Une borne de poids habituelle d'un transporteur — sans prix. */
export interface TrancheStandard {
  minWeightGrams: number;
  /** Null = pas de limite haute. */
  maxWeightGrams: number | null;
  label: string;
}

/** Bornes habituelles des deux transporteurs, pour pré-remplir une grille. */
export interface TranchesStandard {
  colissimo: TrancheStandard[];
  mondial_relay: TrancheStandard[];
}

/** Une ligne de grille tarifaire : un prix pour une tranche de poids. */
export interface TarifLivraisonBO {
  id: number;
  methodId: number;
  zoneId: number;
  priceCents: number;
  freeFromCents: number | null;
  minWeightGrams: number;
  /** Null = pas de limite haute. */
  maxWeightGrams: number | null;
  active: boolean;
  /**
   * Non nul = archivée : la tranche ne facture plus rien et quitte la grille,
   * rangée dans « Tranches archivées ».
   */
  archivedAt?: string | null;
}

/** Catalogue de livraison tel que le back-office le manipule. */
export interface CatalogueLivraisonBO {
  zones: {
    id: number;
    slug: string;
    name: string;
    countries: string[] | null;
    position: number;
  }[];
  modes: {
    id: number;
    slug: string;
    name: string;
    description: string | null;
    kind: string;
    carrier: string | null;
    pickupLocation: string | null;
    /**
     * Votre remarque libre sur ce mode, à côté de la liste calculée
     * `ouverture`. Back-office uniquement : la route `/shipping` du site ne
     * publie pas cette colonne, le client ne la voit jamais.
     */
    notePreparation: string | null;
    /**
     * Le nom, la précision et le lieu de retrait dans les autres langues :
     * ce que la caisse montre, et ce que redisent les courriels et la
     * facture. La note de préparation, écrite pour la boutique, n'en a pas.
     */
    translations?: TraductionsDe<"name" | "description" | "pickupLocation">;
    active: boolean;
    position: number;
    /**
     * Non nul = archivé : hors du tunnel de commande et de la liste
     * ordinaire, rangé dans « Modes archivés ». Les commandes déjà parties
     * continuent d'afficher son nom.
     */
    archivedAt?: string | null;
    /**
     * TOUT ce qui empêche ce mode de sortir sur le site — liste vide quand il
     * en sort.
     *
     * Calculé par l'API, avec la règle qui filtre vraiment le site. Le
     * back-office ne la recalcule pas : deux versions finiraient par
     * afficher « proposé » sur un mode que personne ne voit.
     */
    masqueRaisons?: string[];
    /**
     * La même chose vue à l'endroit : ce qu'il reste à faire pour ouvrir ce
     * mode, et ce qui est déjà fait, une ligne par étape.
     *
     * Calculée par l'API elle aussi : c'est elle qui sait quels comptes
     * transporteurs sont branchés, et c'est la même règle que
     * `masqueRaisons` — deux copies finiraient par se contredire sur le même
     * écran.
     */
    ouverture?: { fait: boolean; titre: string; detail: string }[];
  }[];
  tarifs: TarifLivraisonBO[];
  /**
   * Les transporteurs connus de l'API, avec leur état d'intégration et le
   * contrat à demander — dans les mots du transporteur, pour pouvoir le
   * réclamer tel quel au téléphone.
   */
  transporteurs?: {
    code: string;
    nom: string;
    integre: boolean;
    contrat: string;
    aupres: string;
  }[];
  /**
   * Les natures de mode connues de l'API (à domicile, point relais, retrait).
   * La liste vit là-bas : une copie ici finirait par proposer une nature que
   * l'API refuse.
   */
  natures?: {
    code: string;
    nom: string;
    demande: string;
    aide: string;
  }[];
  /**
   * Nombre de lieux de retrait actifs (Livraison › Lieux de retrait). Sans
   * aucun, un mode « retrait sur place » ne sort pas à la caisse.
   */
  lieuxRetraitActifs?: number;
}

/** Chiffres d'une période de commandes, et de la précédente pour comparer. */
export interface StatsCommandes {
  jours: number;
  periode: {
    commandes: number;
    articles: number;
    caCents: number;
    portCents: number;
    /** Commandes payées de la période qui restent à préparer. */
    aTraiter: number;
  };
  precedent: {
    commandes: number;
    articles: number;
    caCents: number;
    portCents: number;
  };
  /** Nombre de commandes par jour, du plus ancien au plus récent. */
  serie: number[];
}

/** Statuts calculés côté API (voir apps/api/src/commandes.ts). */
export type StatutFinancier =
  | "draft"
  | "pending"
  | "authorized"
  | "paid"
  | "partially_refunded"
  | "refunded"
  | "voided";
export type StatutExpedition =
  | "unfulfilled"
  | "partially_fulfilled"
  | "fulfilled";

export interface OrderRow {
  id: number;
  number: string;
  channel: string;
  status: string;
  totalCents: number;
  createdAt?: string;
  /** Nom du client, absent pour une commande prise au salon. */
  customerName?: string | null;
  customerEmail?: string | null;
  customerId?: number | null;
  /** Non null = commande préparée et partie. */
  fulfilledAt?: string | null;
  /** Nombre d'articles, quantités comprises. */
  articles?: number;
  /** Aperçus des premières affiches (3 au plus), adresses relatives à l'API, signées. */
  apercus?: string[];
  /** Nombre d'affiches différentes (lignes de commande). */
  lignes?: number;
  /**
   * Les affiches à imprimer, dans l'ordre des vignettes : la liste propose
   * leurs PDF d'impression sans ouvrir la commande.
   */
  affiches?: { id: number; titre: string | null; format: string | null }[];
  /** Quantités déjà parties. */
  expedies?: number;
  rembourseCents?: number;
  statutFinancier?: StatutFinancier;
  statutExpedition?: StatutExpedition;
  /** Payée avec les clés d'ESSAI alors que la boutique encaisse pour de vrai. */
  payeeEnEssai?: boolean;
  tags?: string[] | null;
  shippingLabel?: string | null;
  /** La description du mode le jour de la commande (« livré avant 13 h »). */
  shippingDescription?: string | null;
  legacyName?: string | null;
  /**
   * Non nul = archivée : hors de la liste ordinaire, de l'export et des
   * actions groupées. Elle se relit et se restaure depuis « Commandes
   * archivées ». Rien n'est effacé, et son statut n'a pas bougé.
   */
  archivedAt?: string | null;
}

/** Filtres de la liste des commandes — tous combinables. */
export interface FiltresCommandes {
  channel?: string;
  /** Identifiant d'un stand : ne garde que ce qui y a été vendu. */
  stand?: number;
  q?: string;
  financial?: string;
  fulfillment?: string;
  tag?: string;
  from?: string;
  to?: string;
  limit?: number;
  /**
   * « 1 » pour ne voir QUE les commandes archivées — la vue « Archivées ».
   * Absent, la liste ne montre que les autres : les deux ne se mélangent
   * jamais, sinon on ne saurait plus ce qui est rangé.
   */
  archived?: string;
}

/** Une expédition et ce qu'elle contenait. */
export interface Expedition {
  id: number;
  orderId: number;
  carrier: string | null;
  trackingNumber: string | null;
  trackingUrl: string | null;
  status: string;
  createdAt: string;
  cancelledAt: string | null;
  lignes: { id: number; orderItemId: number; quantity: number }[];
}

/** Un remboursement et son détail. */
export interface Remboursement {
  id: number;
  orderId: number;
  amountCents: number;
  shippingCents: number;
  reason: string | null;
  note: string | null;
  restock: boolean;
  gateway: string | null;
  externalRef: string | null;
  createdAt: string;
  lignes: {
    id: number;
    orderItemId: number;
    quantity: number;
    amountCents: number;
  }[];
}

/** Une écriture du grand livre. */
export interface Mouvement {
  id: number;
  kind: string;
  status: string;
  amountCents: number;
  gateway: string | null;
  externalRef: string | null;
  message: string | null;
  createdAt: string;
}

/** Un panier laissé en plan, tel que le back-office le présente. */
export interface PanierAbandonne {
  id: number;
  number: string;
  totalCents: number;
  articles: number;
  nom: string | null;
  email: string;
  createdAt: string;
  /** Dernière fois que le panier a bougé — l'horloge de l'abandon. */
  derniereActivite: string;
  relanceAt: string | null;
  recupereLe: string | null;
  etat: "abandonne" | "relance" | "recupere" | "trop_ancien" | "renonce";
  /** L'état en une phrase : « Abandonné il y a 3 h », « Récupéré le 4 mars ». */
  etatLibelle: string;
  /** Pourquoi la relance automatique a renoncé. Null quand elle n'a pas renoncé. */
  motifRenoncement: string | null;
  /** Le lien qui remet ce panier dans le navigateur de la cliente. */
  lienRecuperation: string;
  relancable: boolean;
  /** Combien de relances sont parties pour ce panier. */
  nombreRelances: number;
  /** « 2e relance prévue le 3 octobre à 09:00 », ou null s'il n'y en aura pas. */
  prochaineRelance: string | null;
}

/** Les réglages de la relance, tenus dans le back-office. */
export interface ReglagesRelance {
  active: boolean;
  /** La 1re relance, en heures après l'abandon. */
  palierHeures: number;
  plancherMinutes: number;
  baseLegale: "consentement" | "interet_legitime";
  /** La 2e relance, en heures après l'abandon ; null = pas de 2e relance. */
  relance2Heures: number | null;
  /** La 3e, de même. */
  relance3Heures: number | null;
  /** N'envoyer qu'entre ces heures (heure de Paris) ; null = à toute heure. */
  plage: { debut: number; fin: number } | null;
}

/** Les cinq morceaux du courriel de relance que la boutique réécrit. */
export interface TextesRelance {
  objet: string;
  accroche: string;
  message: string;
  bouton: string;
  conclusion: string;
}

/** Les langues des courriels, le français d'abord. */
export type LangueCourriel = "fr" | "en" | "de" | "it" | "es";

/** Une relance (1re, 2e, 3e) et son courriel, dans la langue demandée. */
export interface CourrielRelance {
  etape: 1 | 2 | 3;
  /** « 1re relance ». */
  nom: string;
  /** Les textes qui partiront dans cette langue. */
  textes: TextesRelance;
  /** Les textes d'origine de cette langue, pour « Revenir au texte d'origine ». */
  origine: TextesRelance;
  /** La boutique a-t-elle écrit son texte dans CETTE langue ? */
  personnalise: boolean;
  /** Les langues dans lesquelles cette relance a déjà son texte. */
  langues: LangueCourriel[];
  /** Hors du français : les textes français, d'où l'on traduit. */
  francais: TextesRelance | null;
  /** Vrai si cette relance est programmée dans les réglages. */
  programmee: boolean;
  /** « 10 h après l'abandon », ou null si elle n'est pas programmée. */
  quand: string | null;
}

/** L'écran de réécriture des courriels de relance. */
export interface EcranCourrielsRelance {
  langue: LangueCourriel;
  etapes: CourrielRelance[];
  variables: { nom: string; sens: string }[];
  active: boolean;
  /** Faux si le serveur n'a pas de clé de traduction automatique. */
  traductionDisponible: boolean;
}

/** Ce que rapporte la relance, en chiffres. */
export interface ChiffresRelance {
  relancables: number;
  montantEnJeu: number;
  relancesEnvoyees: number;
  paniersRecuperes: number;
  montantRecupere: number;
}

/** Tout l'écran des paniers abandonnés, en un seul aller-retour. */
export interface EcranPaniers {
  reglages: ReglagesRelance;
  /** Le délai plancher réellement appliqué à cette liste, en minutes. */
  plancher: number;
  paliers: number[];
  /** Les délais proposés pour la 2e et la 3e relance, en heures après l'abandon. */
  paliersSuivants: number[];
  /** La limite au-delà de laquelle plus rien ne part : 336 h, soit 14 jours. */
  fenetreHeures: number;
  courrierConfigure: boolean;
  chiffres: ChiffresRelance;
  paniers: PanierAbandonne[];
  /**
   * Pour chaque relance, ses textes ont-ils été réécrits (dans au moins une
   * langue), et dans quelles langues ?
   */
  courriels: { etape: 1 | 2 | 3; personnalise: boolean; langues?: LangueCourriel[] }[];
}

/** Ce qu'un passage du travailleur a fait. */
export interface BilanPassage {
  examines: number;
  envoyes: number;
  renonces: number;
  echecs: number;
  /** Pourquoi le passage n'a rien fait, quand ce n'est pas faute de paniers. */
  motif?: string | null;
}

export interface OrderItem {
  id: number;
  title: string | null;
  quantity: number;
  unitPriceCents: number;
}

export interface OrderDetail {
  order: OrderRow & {
    createdAt?: string;
    legacyName?: string | null;
    promoCode?: string | null;
    shippingCents?: number;
    shippingName?: string | null;
    shippingLine1?: string | null;
    shippingLine2?: string | null;
    shippingPostalCode?: string | null;
    shippingCity?: string | null;
    shippingCountry?: string | null;
    shippingPhone?: string | null;
    relayPointId?: string | null;
    relayPointLabel?: string | null;
    internalNote?: string | null;
    tags?: string[] | null;
    shippingMethod?: string | null;
    /** Quand la commande a été annulée, et pourquoi. Null = elle ne l'est pas. */
    cancelledAt?: string | null;
    cancelReason?: string | null;
    /**
     * Le numéro de la FACTURE, attribué à sa première édition et jamais
     * réattribué. Absent tant que personne n'a édité la facture.
     */
    invoiceNumber?: string | null;
    invoicedAt?: string | null;
  };
  /**
   * Où la cliente vient chercher sa commande, pour un retrait sur place : le
   * lieu figé à la caisse (nom, adresse, texte), ou, pour une commande
   * d'avant les lieux de retrait, le nom du stand (`ancien`). Null sinon.
   */
  lieuRetrait?: {
    nom: string;
    adresse: string | null;
    description: string | null;
    ancien: boolean;
  } | null;
  items: (OrderItem & {
    format?: string | null;
    /** « paysage » pour une affiche couchée ; null = portrait. */
    orientation?: "paysage" | null;
    cadre?: string | null;
    /**
     * La couleur d'aperçu du cadre (« #2b2b2b »), pour border la grande
     * vignette de la fiche comme dans le panier. Null sans cadre.
     */
    cadreCouleur?: string | null;
    /** Les lignes du texte de l'affiche, dans l'ordre où elles s'impriment. */
    lignesAffiche?: (string | null)[] | null;
    /** Forme d'avant les trois lignes — les commandes déjà passées la portent. */
    titreAffiche?: string | null;
    sousTitreAffiche?: string | null;
    personnages?: number;
    /**
     * L'aperçu de l'affiche commandée, rendu comme le fichier d'impression.
     * Adresse relative à l'API, signée : à préfixer par `apiUrl`.
     */
    apercu?: string;
    /** Quantités déjà parties / déjà rendues, et ce qu'il reste à faire. */
    expedie?: number;
    rembourse?: number;
    aExpedier?: number;
    aRembourser?: number;
  })[];
  expeditions?: Expedition[];
  remboursements?: Remboursement[];
  mouvements?: Mouvement[];
  statutFinancier?: StatutFinancier;
  statutExpedition?: StatutExpedition;
  rembourseCents?: number;
  /** Ce qui reste remboursable sur les frais de port. */
  portRemboursableCents?: number;
  customer?: { id: number; name: string; email: string } | null;
  paiements?: {
    provider: string;
    status: string | null;
    externalRef: string | null;
    amountCents: number;
    /** « test » ou « live » : les clés avec lesquelles ce paiement a été ouvert. */
    mode?: string | null;
  }[];
  /**
   * Payée avec les clés d'ESSAI de ce prestataire alors que la boutique
   * encaisse pour de vrai : aucun argent n'est arrivé.
   */
  payeeEnEssai?: "stripe" | "paypal" | null;
  /** Journal de la commande, du plus récent au plus ancien. */
  journal?: {
    id: number;
    kind: string;
    message: string;
    author: string | null;
    createdAt: string;
  }[];
  commandesDuClient?: number;
}

/**
 * Client de la boutique, tel que la liste du CRM le présente : sa fiche et ce
 * qu'il a acheté. `compte` distingue le client inscrit (il a un mot de passe,
 * il retrouve ses commandes) du simple visiteur créé par une commande.
 */
export interface Client {
  id: number;
  name: string | null;
  email: string | null;
  phone: string | null;
  createdAt: string;
  acceptsMarketing: boolean;
  tags: string[] | null;
  compte: boolean;
  commandes: number;
  caCents: number;
  derniereCommande: string | null;
}

/**
 * Segments proposés par l'API. « inactifs » = au moins une commande, mais
 * plus rien depuis 90 jours ; « sans-commande » = inscrit qui n'a jamais
 * acheté.
 */
export type SegmentClients =
  | "compte"
  | "optin"
  | "inactifs"
  | "fideles"
  | "sans-commande";

/** Filtres de la liste des clients. */
export interface FiltresClients {
  q?: string;
  segment?: SegmentClients | string;
  limit?: number;
}

/**
 * Une ligne de l'écran « Clients » : la fiche et ses achats, plus ce que
 * Shopify y montrait — l'abonnement aux e-mails et l'emplacement.
 */
export interface ClientListe extends Client {
  /** Reçoit la lettre : case cochée sur sa fiche, OU inscrite au formulaire. */
  abonne: boolean;
  /** Inscrite au formulaire de la lettre, indépendamment de sa fiche. */
  inscritLettre: boolean;
  ville: string | null;
  /** Tel qu'enregistré (souvent « FR ») ; `paysNom` est lisible. */
  pays: string | null;
  paysNom: string | null;
  origine: string | null;
  origineStand: string | null;
}

/** Une page de la liste des clients, triée sur TOUTE la liste filtrée. */
export interface PageClients {
  total: number;
  page: number;
  pages: number;
  parPage: number;
  tri: string;
  inverse: boolean;
  /** Le total dépensé de toute la liste filtrée, pas seulement de la page. */
  caTotalCents: number;
  clients: ClientListe[];
}

/** Ce qu'un import ferait, ou vient de faire, d'une ligne de fichier de clientes. */
export interface LigneImportClient {
  /** La ligne du tableur : l'en-tête est la ligne 1. */
  ligne: number;
  email: string;
  nom: string;
  action: "creation" | "mise-a-jour" | "inchange" | "refus";
  raison?: string;
  changements: string[];
  /** L'abonnement aux e-mails que la fiche portera. */
  abonne: boolean | null;
  /** « Lille, France » : l'adresse qui entre au carnet, s'il y en a une. */
  emplacement: string | null;
  clientId?: number;
}

/** Le résultat d'un import de clientes, appliqué ou seulement simulé. */
export interface ResultatImportClients {
  applique: boolean;
  lignes: number;
  compte: Record<LigneImportClient["action"], number>;
  colonnesReconnues: string[];
  colonnesIgnorees: string[];
  apercu: LigneImportClient[];
}

/** Adresse du carnet d'un client — il la gère depuis son espace, pas le BO. */
export interface AdresseClient {
  id: number;
  label: string | null;
  name: string | null;
  line1: string | null;
  line2: string | null;
  postalCode: string | null;
  city: string | null;
  country: string | null;
  phone: string | null;
  isDefaultShipping: boolean;
  isDefaultBilling: boolean;
  createdAt?: string;
}

/** Fiche complète : la personne, son carnet d'adresses, son historique. */
export interface ClientDetail {
  customer: Client & {
    /** Note interne, jamais montrée au client. */
    note?: string | null;
    /** Quand il a accepté d'être démarché ; vide s'il ne l'a jamais accepté. */
    marketingOptInAt?: string | null;
    lastLoginAt?: string | null;
  };
  adresses: AdresseClient[];
  commandes: {
    id: number;
    number: string;
    createdAt: string;
    totalCents: number;
    articles: number;
    statutFinancier?: StatutFinancier;
    statutExpedition?: StatutExpedition;
  }[];
  stats: { commandes: number; caCents: number; panierMoyenCents: number };
}

export interface CharacterType {
  id: number;
  slug: string;
  name: string;
  /** Le nom dans les autres langues : { en: { name }, … }. */
  translations?: TraductionsDe<"name">;
  /** Ancien champ texte, conservé le temps de la bascule — lire categoryId. */
  category: string | null;
  /** Catégorie du personnage (table character_category), null = non rangé. */
  categoryId: number | null;
  position: number;
  archivedAt: string | null;
  /** Proposé aux clients du site ? Faux = « Masqué » (0073), sans être archivé. */
  active: boolean;
  baseSvgUrl: string | null;
  baseColorZones: Record<string, string> | null;
  /** Groupes de couleurs du dessin (nuances réunies, noms, nuanciers). */
  baseGroupesCouleurs?: GroupeCouleur[] | null;
  /** Groupes proposés au client (zones de référence) ; null = la peau seule. */
  baseZonesProposees?: string[] | null;
  /**
   * Familles de couleurs, quand le dessin de base est une image EN PIXELS
   * (photo ou illustration enregistrée en SVG). Null = dessin vectoriel.
   */
  baseCouleursImage?: CouleursImage | null;
  /** Type d'affiche (slug) sous lequel ce personnage est dessiné. */
  orientation?: string;
  /**
   * Calage vertical : position du bas réel du dessin dans le viewBox (0..1).
   * Sert à aligner les pieds de tous les personnages sur le muret.
   */
  bottomPct?: number;
  /**
   * Taille de ce personnage, en facteur de la largeur de référence.
   * 1 = la largeur commune d'avant ce réglage, 0,6 = nettement plus petit.
   */
  facteurTaille?: number;
  /** Décalage de côté sur l'affiche, en fraction de sa largeur (0 = centré). */
  decalageX?: number;
  /**
   * Pièces autorisées par emplacement, en POSITIONS de pièces génériques.
   * Absent = pas encore paramétré, le configurateur propose alors tout.
   */
  slotVariants?: Partial<
    Record<"clothes" | "pants" | "hair" | "accessory", number[]>
  > | null;
  /**
   * Calage des pièces sur ce personnage, par emplacement : décalage en
   * pourcents du cadre et facteur de taille. Absent = pièce posée telle
   * qu'elle a été dessinée.
   */
  slotAdjust?: Partial<
    Record<
      "clothes" | "pants" | "hair" | "accessory",
      { dx: number; dy: number; scale: number }
    >
  > | null;
  /**
   * Tenue portée d'emblée par le client, en positions de pièces :
   * { clothes: 3, hair: 7 }. Utile aux personnages importés nus.
   */
  defaultAssets?: Partial<
    Record<"clothes" | "pants" | "hair" | "accessory", number>
  > | null;
}

export interface Asset {
  id: number;
  characterTypeId: number | null;
  slot: string;
  name: string;
  svgUrl: string | null;
  /** Type d'affiche (slug) sous lequel cette pièce est dessinée. */
  view: string | null;
  colorZones: Record<string, string> | null;
  /**
   * Zones de couleur que le client ne peut pas changer (petits détails :
   * ruban, élastique…) : le réglage PROPRE à la pièce. Vide = toutes les
   * zones sont proposées ; null = la pièce suit le réglage de sa catégorie.
   */
  zonesMasquees?: string[] | null;
  /**
   * La part du dessin peinte par chaque zone (0 à 1), mesurée par l'API :
   * elle désigne la couleur principale. Null tant qu'elle n'est pas mesurée.
   */
  partsDesZones?: Record<string, number> | null;
  /** Nuances réunies sous une seule couleur, et leurs noms (« ruban »). */
  groupesCouleurs?: GroupeCouleur[] | null;
  /** Familles de couleurs, quand le dessin de la pièce est une image en pixels. */
  couleursImage?: CouleursImage | null;
  position: number;
  /** Non null = pièce archivée : masquée du configurateur, jamais supprimée. */
  archivedAt?: string | null;
  /** Catégorie de pièces (« Casquettes »…), qui porte le nuancier. */
  pieceCategoryId?: number | null;
}

/**
 * Catégorie de pièces : un rangement plus fin que l'emplacement, et surtout
 * le nuancier proposé au client pour les pièces qu'elle contient.
 */
export interface CategoriePiece {
  id: number;
  slug: string;
  name: string;
  slot: string;
  colors: string[];
  /**
   * Les couleurs proposées au client pour chaque pièce sans réglage propre :
   * « toutes », ou « principale » (la plus étendue, les détails gardent la
   * couleur du dessin).
   */
  couleursProposees?: "toutes" | "principale";
  active: boolean;
  position: number;
  /**
   * Non nul = archivée : hors du configurateur et de la liste ordinaire,
   * rangée dans « Catégories archivées ». Ses pièces gardent leur rangement
   * et reprennent le nuancier de leur emplacement.
   */
  archivedAt?: string | null;
  /** Nombre de pièces rangées dedans. */
  pieces?: number;
}

/** Un visuel (arrière-plan) disponible pour un produit. */
export interface ProductBackground {
  id: number;
  url: string;
  name: string | null;
  position: number;
  /**
   * Non nul = archivé : retiré des choix du configurateur, mais toujours
   * imprimable pour les commandes passées dessus.
   */
  archivedAt?: string | null;
}

/** Configuration du configurateur pour un produit donné. */
export interface ProductConfig {
  id: number;
  slug: string;
  name: string;
  /**
   * Les trois lignes pré-remplies de l'affiche, dans l'ordre. Les colonnes
   * gardent leurs anciens noms : 161 affiches les remplissent déjà, les
   * renommer coûterait une migration pour rien.
   */
  defaultTitle: string | null;
  defaultSubtitle: string | null;
  defaultLine3: string | null;
  /** Slug du type d'affiche du produit. */
  defaultView: string | null;
  foregroundUrl: string | null;
  backgrounds: ProductBackground[];
  /** L'affiche est générée par IA à partir d'une photo du client. */
  aiEnabled?: boolean;
  /** Consignes de style propres à cette affiche, ajoutées au style commun. */
  aiStylePrompt?: string | null;
}

/** Réglages IA d'une affiche, tels que l'API les renvoie après écriture. */
export interface ProduitIA {
  id: number;
  name?: string;
  aiEnabled: boolean;
  aiStylePrompt: string | null;
}

/**
 * Une image fabriquée par le modèle à partir de la photo d'un client.
 * `apercu` porte TOUJOURS le filigrane ; l'image nette n'existe qu'une fois la
 * commande payée et ne s'ouvre que par /admin/ia/full/:publicId.
 */
export interface GenerationIA {
  id: number;
  publicId: string;
  productId: number | null;
  /** Nom de l'affiche, déjà résolu par l'API. */
  produit: string | null;
  cartId: string | null;
  orderItemId: number | null;
  customerId: number | null;
  status: "en_cours" | "prete" | "echec";
  model: string | null;
  size: string | null;
  costCents: number;
  erreur: string | null;
  /** Le texte envoyé au modèle : style de la boutique, de l'affiche, du client. */
  prompt: string | null;
  ip: string | null;
  createdAt: string;
  paidAt: string | null;
  aApercu: boolean;
  aPleine: boolean;
  apercu: string | null;
  pleine: string | null;
}

/** Une page de générations, la plus récente d'abord. */
export interface ListeGenerationsIA {
  lignes: GenerationIA[];
  /** Nombre total de générations répondant au filtre, toutes pages confondues. */
  total: number;
  /** Ce que ces générations ont coûté. */
  coutCents: number;
  page: number;
  limite: number;
}

/** Filtres de la galerie des générations. */
export interface FiltresIA {
  statut?: string;
  page?: number;
  limite?: number;
}

/** Ce que la génération d'images coûte, et ce qu'elle rate. */
export interface StatsIA {
  /** Faux si la clé OpenAI manque : plus rien ne peut être généré. */
  configuree: boolean;
  modele: string;
  taille: string;
  mois: {
    debut: string;
    essais: number;
    pretes: number;
    echecs: number;
    payees: number;
    tauxEchec: number;
    depenseCents: number;
  };
  /** Plafond mensuel de dépense (réglage « ia.plafondMensuelCents »). */
  plafondCents: number;
  resteCents: number;
  plafondAtteint: boolean;
  /** Ce que coûte une image avec le modèle et la taille réglés. */
  coutParImageCents: number;
  /** Délai au-delà duquel une photo non achetée peut être effacée. */
  purgeJours: number;
  total: { essais: number; coutCents: number };
}

/**
 * Ce que la purge des photos de visiteurs a effacé — ou, en simulation,
 * effacerait. La même purge passe d'elle-même toutes les heures dans l'API.
 */
export interface BilanPurgeIa {
  jours: number;
  simulation: boolean;
  /** Générations jamais achetées vidées de leurs fichiers. */
  lignes: number;
  /** Fichiers de ces générations : photo, aperçu, pleine définition, impression. */
  fichiers: number;
  /** Photos qui n'ont servi à aucune génération. */
  orphelins: number;
  /** Photos du relais téléphone → tablette restées sur le disque. */
  relais: number;
  /** L'âge, en heures, à partir duquel une photo inutilisée est effacée. */
  heuresPhotosInutilisees: number;
  /** Pourquoi la purge n'a rien fait, quand elle n'a rien fait exprès. */
  motif: string | null;
}

/**
 * Une carte cadeau : de l'argent déjà encaissé, à rendre en affiches.
 *
 * `initialAmountCents` ne bouge jamais, c'est ce qui a été payé le jour de la
 * vente. `balanceCents` est ce qu'il en reste, recopié du journal de la carte.
 */
export interface CarteCadeau {
  id: number;
  code: string;
  initialAmountCents: number;
  balanceCents: number;
  /** « active » ou « disabled ». Une carte ne se supprime pas. */
  status: string;
  expiresAt: string | null;
  customerId: number | null;
  clientNom: string | null;
  clientEmail: string | null;
  note: string | null;
  createdAt: string;
  disabledAt: string | null;
  /** Nombre de fois où la carte a servi à payer quelque chose. */
  utilisations: number;
}

/**
 * Un mouvement du journal d'une carte.
 *
 * `amountCents` est NÉGATIF quand la carte paie, positif à l'achat et aux
 * recharges. Le journal fait foi : le solde n'en est que la somme.
 */
export interface MouvementCarteCadeau {
  id: number;
  amountCents: number;
  label: string | null;
  orderId: number | null;
  /** Le numéro de la commande payée, quand le mouvement en désigne une. */
  numeroCommande: string | null;
  createdAt: string;
}

/** Une carte, son journal, et la personne à qui elle a été remise. */
export interface DetailCarteCadeau {
  carte: Omit<CarteCadeau, "clientNom" | "clientEmail" | "utilisations">;
  mouvements: MouvementCarteCadeau[];
  client: { id: number; nom: string | null; email: string | null } | null;
}

/**
 * La liste des cartes, et ce que la boutique doit encore en affiches.
 *
 * `totalEnCirculationCents` ne compte que les cartes encore échangeables :
 * une carte désactivée ou périmée a cessé d'être une dette.
 */
export interface ListeCartesCadeaux {
  cartes: CarteCadeau[];
  totalEnCirculationCents: number;
  cartesEnCirculation: number;
}

/** Les ventes que regardent les statistiques : le site, les stands, ou toutes. */
export type CanalAnalytique = "site" | "stands" | "tout";

/**
 * Crée un client API lié au cookie de session de la requête entrante.
 * À utiliser dans les pages : `const api = adminApi(Astro.request)`.
 */
/** Ce que l'écran des statistiques reçoit, en un seul appel. */
export interface Analytique {
  /** Le canal effectivement lu : « tout » quand la demande n'en nommait aucun. */
  canal: CanalAnalytique;
  /** Le stand regardé ; null pour tous. Un stand choisi impose « stands ». */
  stand: number | null;
  /** Dates de Paris, « 2026-10-05 », bornes comprises. */
  periode: { debut: string; fin: string; jours: number };
  /** La période d'avant, de même durée, à laquelle chaque écart compare. */
  precedente: { debut: string; fin: string };
  /** Le pas de la courbe : un point par jour, par semaine ou par mois. */
  pas: "day" | "week" | "month";
  resume: {
    caCents: number;
    commandes: number;
    panierMoyenCents: number;
    clients: number;
    /** Null quand la période précédente était vide : on ne compare pas à rien. */
    evolution: {
      caCents: number | null;
      commandes: number | null;
      panierMoyenCents: number | null;
    };
    precedent: { caCents: number; commandes: number; panierMoyenCents: number };
  };
  parJour: { jour: string; caCents: number; commandes: number }[];
  meilleuresVentes: {
    nom: string;
    slug: string | null;
    quantite: number;
    caCents: number;
  }[];
  parCanal: { canal: string; commandes: number; caCents: number }[];
  parFormat: { format: string; quantite: number; caCents: number }[];
  /** Des personnes : « nouvelle » se juge sur la première commande payée, tous canaux. */
  clients: { nouvelles: number; revenantes: number };
  /**
   * Les paniers du SITE — y compris sous « Tout ». Null sous « Stands », où la
   * vente se règle sur place et où rien ne s'abandonne.
   */
  paniers: {
    abandonnes: number;
    enAttente: number;
    perduCents: number;
    transformation: number | null;
  } | null;
  /** Les villes de livraison. Vide sous « Stands » : une vente de stand est remise sur place. */
  lieux: { ville: string; commandes: number }[];
  /**
   * Stand par stand. Rempli sous « Stands » seulement — tous les stands, même
   * quand un seul est choisi, pour qu'on le voie à côté des autres.
   */
  parStand: { id: number | null; stand: string; commandes: number; caCents: number }[];
  /** Par sorte d'affiche : « personnalisable », « prete_a_imprimer », « ia », « autre ». */
  parGenre: { genre: string; quantite: number; caCents: number }[];
  /** Les stands qui ont déjà vendu, à proposer au choix. */
  stands: { id: number; nom: string }[];
}

/**
 * Un style d'affiche IA tel que le back-office le manipule.
 *
 * `prompt` n'existe QUE côté administration : la route publique ne renvoie
 * jamais la consigne, seulement le titre et les images.
 */
export interface StyleIa {
  id: number;
  title: string;
  prompt: string;
  images: string[];
  position: number;
  active: boolean;
  /**
   * Non nul = archivé : hors du site et de la liste ordinaire, rangé dans
   * « Styles archivés ». Sa consigne et ses images sont gardées entières.
   */
  archivedAt?: string | null;
  translations: Partial<Record<string, { title?: string }>> | null;
}

/** Une chose archivée, telle que l'écran « Archives » l'affiche. */
export interface ElementArchive {
  id: number;
  libelle: string;
  detail: string | null;
  /** ISO, ou null quand la ligne n'a gardé aucune date. */
  date: string | null;
}

/**
 * Une nature de chose archivée : les pages, les collections, les fonds…
 *
 * `dateSource` dit ce que la date raconte. « archivage » = l'heure exacte du
 * rangement. « modification » = le dernier enregistrement, seule date connue
 * pour les produits, dont l'archivage est un statut et non une date : l'écran
 * doit écrire « Modifié le » plutôt qu'une date d'archivage inventée.
 */
export interface GroupeArchives {
  cle: string;
  titre: string;
  /** L'écran où cette nature se range et se restaure aussi. */
  ecran: string;
  /** Son nom dans le menu de gauche, pour que le lien se lise. */
  ecranNom: string;
  dateSource: "archivage" | "modification";
  elements: ElementArchive[];
}

export function adminApi(request?: Request) {
  const cookie = request?.headers.get("cookie") ?? undefined;
  return {
    /**
     * La recherche du haut, côté DONNÉES (GET /admin/recherche) : affiches,
     * commandes, clientes, textes du site… Les écrans et l'aide viennent du
     * back-office lui-même ; c'est lib/recherche-bo.ts qui réunit les deux.
     * Sans `groupes`, l'API cherche partout. `connus` : les mots tapés que les
     * écrans connaissent, que l'API ne doit donc pas corriger.
     */
    recherche: (p: {
      q: string;
      groupes?: readonly GroupeId[];
      limite?: number;
      connus?: readonly string[];
    }) =>
      req<ReponseRecherche>(
        "GET",
        "/admin/recherche?q=" +
          encodeURIComponent(p.q) +
          (p.groupes ? "&groupes=" + p.groupes.join(",") : "") +
          "&limite=" +
          (p.limite ?? RECHERCHE_LIMITE_PANNEAU) +
          (p.connus?.length ? "&connus=" + encodeURIComponent(p.connus.join(",")) : ""),
        undefined,
        cookie,
      ),
    /**
     * Tout ce qui est archivé, d'un coup. Lecture seule : la restauration
     * passe par la route d'archivage de chaque nature, la seule qui en
     * connaisse les règles.
     */
    archives: () =>
      req<{
        groupes: GroupeArchives[];
        total: number;
        /** Comptées seulement : elles ont leur onglet « Archivées ». */
        commandesArchivees: number;
        /** Comptés seulement : un lien se restaure avec sa famille, côté menu. */
        liensMenuArchives: number;
      }>("GET", "/admin/archives", undefined, cookie),
    /**
     * Archive une lettre, ou la restaure. Seul un BROUILLON archivé se
     * supprime définitivement (DELETE /admin/lettres/:id, appelé par
     * lettre.astro) : une lettre partie garde la trace de qui l'a reçue, et
     * l'effacer emportait cette trace avec elle.
     */
    archiverLettre: (id: number, archived = true) =>
      req<{ ok: boolean }>(
        "POST",
        `/admin/lettres/${id}/archive`,
        { archived },
        cookie,
      ),
    /**
     * Supprime définitivement une lettre ARCHIVÉE et jamais envoyée. L'API
     * refuse (409, raison en clair) une lettre partie : l'erreur levée porte
     * sa phrase.
     */
    supprimerLettre: (id: number) =>
      req<{ ok: boolean }>("DELETE", `/admin/lettres/${id}`, undefined, cookie),
    stats: () => req<Stats>("GET", "/admin/stats", undefined, cookie),
    /** Toutes les promotions, archivées comprises (marquées par `archivedAt`). */
    promos: () => req<PromoRule[]>("GET", "/admin/promos", undefined, cookie),
    /** Crée (sans id) ou modifie une promotion ; l'API refuse en clair un réglage incohérent. */
    upsertPromo: (data: Partial<PromoRule>) =>
      req<PromoRule>("POST", "/admin/promos", data, cookie),
    /** Allume ou éteint une promotion. */
    basculerPromo: (id: number) =>
      req<PromoRule>("POST", `/admin/promos/${id}/toggle`, {}, cookie),
    /** Archive une promotion, ou la restaure (elle revient éteinte). */
    archiverPromo: (id: number, archive = true) =>
      req<{ ok: boolean; archived: boolean }>(
        "POST",
        `/admin/promos/${id}/archive`,
        { archive },
        cookie,
      ),
    /**
     * Supprime DÉFINITIVEMENT une promotion archivée. L'API refuse (409) ce qui n'est pas
     * archivé et ce qui sert encore, avec une phrase à montrer telle quelle.
     */
    supprimerPromo: (id: number) =>
      req<{ ok: boolean; supprime: boolean }>("DELETE", `/admin/promos/${id}`, undefined, cookie),
    /** Le nom d'une promotion dans UNE langue (vide = le français s'affiche). */
    setPromoTranslation: (id: number, data: { lang: string; name: string }) =>
      req<TraductionsEnregistrees<"name">>(
        "POST",
        `/admin/promos/${id}/translations`,
        data,
        cookie,
      ),
    /**
     * Le message et le texte du lien du bandeau dans UNE langue. Un champ
     * envoyé vide est retiré, un champ non envoyé garde sa traduction.
     */
    setBannerTranslation: (
      id: number,
      data: { lang: string; message?: string; linkLabel?: string },
    ) =>
      req<TraductionsEnregistrees<"message" | "linkLabel">>(
        "POST",
        `/admin/banner/${id}/translations`,
        data,
        cookie,
      ),
    /** Le bandeau du back-office : réglages et messages, éteints et archivés compris. */
    bannerBo: () => req<BannerBo>("GET", "/admin/banners", undefined, cookie),
    /**
     * Crée un message (sans id, en fin de défilement) ou le modifie. N'écrit
     * ni sa place, ni ses traductions, ni aucune promotion.
     */
    upsertBanner: (
      data: Pick<Banner, "message" | "linkUrl" | "linkLabel" | "active"> & {
        id?: number;
        startsAt?: string | null;
        endsAt?: string | null;
      },
    ) => req<Banner>("POST", "/admin/banners", data, cookie),
    /** Allume ou éteint un message. */
    basculerMessageBandeau: (id: number) =>
      req<Banner>("POST", `/admin/banners/${id}/toggle`, {}, cookie),
    /** Archive un message, ou le restaure (il revient éteint, en fin de défilement). */
    archiverMessageBandeau: (id: number, archive = true) =>
      req<{ ok: boolean; archived: boolean }>(
        "POST",
        `/admin/banners/${id}/archive`,
        { archive },
        cookie,
      ),
    /** Supprime pour de bon un message ARCHIVÉ ; l'API refuse (409, en clair) tout autre. */
    supprimerMessageBandeau: (id: number) =>
      req<SuppressionFaite>("DELETE", `/admin/banners/${id}`, undefined, cookie),
    /** L'ordre du défilement : tous les messages non archivés, dans l'ordre voulu. */
    ordreBandeau: (ids: number[]) =>
      req<{ ok: boolean }>("POST", "/admin/banners/ordre", { ids }, cookie),
    /** Les couleurs du bandeau et la durée de chaque message. */
    reglagesBandeau: (r: ReglagesBandeau) =>
      req<{ reglages: ReglagesBandeau }>("POST", "/admin/banners/reglages", r, cookie),
    /**
     * Les réglages tels que le back-office doit les voir.
     *
     * La route ADMIN, et non la route publique : celle-ci retire les clés
     * « ia. », « salon. » et « relance. ». Le back-office y lisait donc une
     * consigne de style IA toujours vide, et l'enregistrait vide par-dessus
     * la vraie. Le résultat garde la forme d'un dictionnaire clé → valeur
     * pour ne rien casser chez les appelants.
     */
    settings: async () => {
      const lignes = await req<
        { key: string; value: unknown; label: string | null; group: string | null }[]
      >("GET", "/admin/settings", undefined, cookie);
      return Object.fromEntries(lignes.map((l) => [l.key, l.value]));
    },
    /** Les lignes entières : label, groupe, et toutes les langues. */
    settingsLignes: () =>
      req<
        {
          key: string;
          label: string | null;
          group: string | null;
          value: unknown;
          updatedAt: string;
        }[]
      >("GET", "/admin/settings", undefined, cookie),
    /**
     * Enregistre un réglage. `lang` fusionne dans la langue demandée sans
     * toucher aux autres ; sans `lang`, la valeur remplace tout.
     */
    setSetting: (key: string, value: unknown, lang?: string) =>
      req<unknown>(
        "POST",
        "/admin/settings",
        lang ? { key, value, lang } : { key, value },
        cookie,
      ),
    orders: (filtres?: string | FiltresCommandes) => {
      const f: FiltresCommandes =
        typeof filtres === "string" ? { channel: filtres } : (filtres ?? {});
      const p = new URLSearchParams();
      for (const [k, v] of Object.entries(f))
        if (v !== undefined && v !== null && v !== "") p.set(k, String(v));
      const qs = p.toString();
      return req<OrderRow[]>(
        "GET",
        `/admin/orders${qs ? `?${qs}` : ""}`,
        undefined,
        cookie,
      );
    },
    /**
     * Tous les stands, avec ce que chacun a rapporté.
     *
     * « orphelines » compte les ventes de stand d'avant que les stands soient
     * plusieurs, et qui n'ont pas pu être rattachées : les taire ferait un
     * trou dans les chiffres.
     */
    stands: () =>
      req<{
        stands: StandBo[];
        orphelines: { commandes: number; cents: number };
      }>("GET", "/admin/stands", undefined, cookie),
    /** Ouvre un nouveau stand. Le code est tiré par le serveur. */
    creerStand: (corps: { nom: string; ouvert?: boolean }) =>
      req<{ ok: true; stand: StandBo }>("POST", "/admin/stands", corps, cookie),
    /** Renomme, ouvre, ferme, ou donne un nouveau code d'accès. */
    majStand: (
      id: number,
      corps: { nom?: string; ouvert?: boolean; nouveauCode?: boolean },
    ) =>
      req<{ ok: true; stand: StandBo }>(
        "POST",
        `/admin/stands/${id}`,
        corps,
        cookie,
      ),
    /**
     * Archive un stand, ou le restaure. Il n'y a plus de suppression : un
     * stand effacé laissait ses ventes sans rien qui dise où elles avaient
     * été faites. Archiver le FERME aussi — sa tablette n'accepte plus rien.
     * `commandes` dit combien de ventes s'y rattachent, pour le redire.
     */
    archiverStand: (id: number, archived = true) =>
      req<{ ok: true; archived: boolean; commandes: number }>(
        "POST",
        `/admin/stands/${id}/archive`,
        { archived },
        cookie,
      ),
    /**
     * Supprime DÉFINITIVEMENT un stand archivé. L'API refuse (409) ce qui n'est pas
     * archivé et ce qui sert encore, avec une phrase à montrer telle quelle.
     */
    supprimerStand: (id: number) =>
      req<{ ok: boolean; supprime: boolean }>("DELETE", `/admin/stands/${id}`, undefined, cookie),
    /**
     * Archive une commande, ou la restaure. Il n'y a plus de suppression :
     * elle emportait en cascade les lignes, les expéditions, les
     * remboursements et les mouvements d'argent.
     *
     * À ne pas confondre avec l'annulation : archiver RANGE — la commande
     * quitte la liste mais garde son statut, son argent et sa place dans les
     * chiffres. C'est l'annulation qui la sort du chiffre d'affaires.
     */
    archiverCommande: (id: number, archived = true) =>
      req<{ ok: true; archived: boolean; numero: string }>(
        "POST",
        `/admin/orders/${id}/archive`,
        { archived },
        cookie,
      ),
    /**
     * Supprime DÉFINITIVEMENT une commande archivée (panier ou commande jamais payée). L'API refuse (409) ce qui n'est pas
     * archivé et ce qui sert encore, avec une phrase à montrer telle quelle.
     */
    supprimerCommande: (id: number) =>
      req<{ ok: boolean; supprime: boolean }>("DELETE", `/admin/orders/${id}`, undefined, cookie),
    /** Étiquettes déjà employées, les plus fréquentes d'abord. */
    orderTags: () =>
      req<{ name: string; n: number }[]>(
        "GET",
        "/admin/orders/tags",
        undefined,
        cookie,
      ),
    /** Remplace les étiquettes d'une commande. */
    setOrderTags: (id: number, tags: string[]) =>
      req<{ id: number; tags: string[] }>(
        "POST",
        `/admin/orders/${id}/tags`,
        { tags },
        cookie,
      ),
    /**
     * Action groupée sur les commandes cochées.
     *
     * « supprimer » n'existe plus : elle effaçait les ventes pour de bon.
     * « archiver » les range, « restaurer » les ressort.
     */
    bulkOrders: (
      ids: number[],
      action: "fulfil" | "unfulfil" | "tag" | "untag" | "archiver" | "restaurer",
      tags?: string[],
    ) =>
      // `numeros` n'accompagne que l'archivage : nommer ce qui a quitté la
      // liste évite d'avoir à la relire pour savoir ce qu'on vient de ranger.
      req<{ ok: boolean; count: number; numeros?: string[] }>(
        "POST",
        "/admin/orders/bulk",
        { ids, action, tags },
        cookie,
      ),
    /** Enregistre une expédition (transporteur + suivi + contenu du colis). */
    createFulfillment: (
      id: number,
      data: {
        items?: { orderItemId: number; quantity: number }[];
        carrier?: string;
        trackingNumber?: string;
        trackingUrl?: string;
      },
    ) =>
      req<Expedition>("POST", `/admin/orders/${id}/fulfillments`, data, cookie),
    /**
     * Le bloc « Bordereau transporteur » : état, options SendCloud et prix.
     * `tous` : les services de tous les transporteurs, pas seulement le payé.
     */
    bordereau: (id: number, poidsGrammes?: number, tous?: boolean) => {
      const q = new URLSearchParams();
      if (poidsGrammes) q.set("poids", String(poidsGrammes));
      if (tous) q.set("tous", "1");
      const qs = q.toString();
      return req<EtatBordereau>(
        "GET",
        `/admin/orders/${id}/bordereau${qs ? `?${qs}` : ""}`,
        undefined,
        cookie,
      );
    },
    /** ACHÈTE le bordereau chez SendCloud (sauf en mode essai). */
    acheterBordereau: (
      id: number,
      data: {
        methodeCode: string;
        poidsGrammes: number;
        prixAnnonceCents: number | null;
        cleDemande: string;
        auteur?: string;
      },
    ) => req<Bordereau>("POST", `/admin/orders/${id}/bordereau`, data, cookie),
    terminerBordereau: (id: number) =>
      req<Bordereau>("POST", `/admin/orders/${id}/bordereau/terminer`, {}, cookie),
    annulerBordereau: (id: number, auteur?: string) =>
      req<{ bordereau: Bordereau; message: string }>(
        "POST",
        `/admin/orders/${id}/bordereau/annuler`,
        { auteur },
        cookie,
      ),
    cancelFulfillment: (id: number) =>
      req<Expedition>("POST", `/admin/fulfillments/${id}/cancel`, {}, cookie),
    /** Rembourse tout ou partie d'une commande. */
    refundOrder: (
      id: number,
      data: {
        items?: { orderItemId: number; quantity: number }[];
        shippingCents?: number;
        /** Un montant libre, à la place des articles et du port. */
        amountCents?: number;
        /** Tout ce qui reste : les articles restants et le port restant. */
        tout?: boolean;
        reason?: string;
        note?: string;
        restock?: boolean;
        viaPsp?: boolean;
        author?: string;
      },
    ) => req<Remboursement>("POST", `/admin/orders/${id}/refunds`, data, cookie),
    /**
     * Corrige l'adresse de livraison d'une commande passée. Seuls les champs
     * envoyés changent ; `livrerALAdresse` quitte le point relais choisi.
     * `bordereauVivant` : une étiquette déjà achetée porte l'ancienne adresse.
     */
    updateOrderAddress: (
      id: number,
      data: Record<string, string | boolean | null | undefined>,
    ) =>
      req<{ ok: boolean; modifie: boolean; bordereauVivant: boolean }>(
        "POST",
        `/admin/orders/${id}/address`,
        data,
        cookie,
      ),
    /**
     * Annule une commande.
     *
     * À ne pas confondre avec la suppression : une commande annulée reste
     * lisible et garde son histoire, elle sort seulement des chiffres et ne
     * peut plus rien expédier.
     */
    annulerCommande: (
      id: number,
      data: {
        motif?: string;
        motifLibre?: string;
        rembourser?: boolean;
        restock?: boolean;
        viaPsp?: boolean;
        note?: string;
        author?: string;
      },
    ) =>
      req<{
        ok: true;
        numero: string;
        annuleeLe: string;
        motif: string | null;
        rembourseCents: number;
        /** Ce que l'annulation laisse dû à la cliente. Zéro le plus souvent. */
        resteADevoir: number;
      }>("POST", `/admin/orders/${id}/cancel`, data, cookie),
    /**
     * Marque une commande payée alors que l'argent est arrivé hors du site
     * (virement, chèque, espèces). Idempotent : `deja` dit qu'elle l'était.
     */
    encaisserCommande: (
      id: number,
      data: { moyen: string; reference?: string; author?: string },
    ) =>
      req<{
        ok: true;
        deja?: boolean;
        message?: string;
        encaissee?: boolean;
        montantCents?: number;
        moyen?: string;
        reference?: string | null;
      }>("POST", `/admin/orders/${id}/encaisser`, data, cookie),
    /** Envoie la facture à la cliente, en pièce jointe. */
    envoyerFacture: (id: number, author?: string) =>
      req<{ ok: true; numeroFacture: string; destinataire: string }>(
        "POST",
        `/admin/orders/${id}/facture/envoyer`,
        { author },
        cookie,
      ),
    /** Renvoie la confirmation au client. */
    resendConfirmation: (id: number) =>
      req<{ ok: boolean }>(
        "POST",
        `/admin/orders/${id}/renvoyer-confirmation`,
        {},
        cookie,
      ),
    /**
     * L'écran des paniers abandonnés : réglages, chiffres et liste.
     *
     * `plancher` (en minutes) permet de regarder la liste avec un autre délai
     * que celui enregistré, sans toucher aux réglages. Omis, c'est le réglage
     * de la boutique qui s'applique.
     */
    abandonedCarts: (plancher?: number) =>
      req<EcranPaniers>(
        "GET",
        plancher === undefined
          ? "/admin/carts/abandoned"
          : `/admin/carts/abandoned?plancher=${plancher}`,
        undefined,
        cookie,
      ),
    /** Enregistre les réglages de la relance. */
    reglagesRelance: (r: Partial<ReglagesRelance>) =>
      req<{ reglages: ReglagesRelance }>(
        "POST",
        "/admin/relance/reglages",
        r,
        cookie,
      ),
    /** Envoie la relance d'un panier abandonné, à la main. */
    relancerPanier: (id: number) =>
      req<{ ok: boolean }>("POST", `/admin/carts/${id}/relancer`, {}, cookie),
    /** Déclenche un passage du travailleur tout de suite. */
    passageRelance: () =>
      req<{ bilan: BilanPassage }>("POST", "/admin/relance/passage", {}, cookie),
    /**
     * Les courriels des trois relances dans une langue : textes, textes
     * d'origine, variables. Sans langue : le français.
     */
    courrielsRelance: (langue: LangueCourriel = "fr") =>
      req<EcranCourrielsRelance>(
        "GET",
        `/admin/relance/courriels?langue=${encodeURIComponent(langue)}`,
        undefined,
        cookie,
      ),
    /** Enregistre les textes d'une relance dans une langue. */
    enregistrerCourrielRelance: (
      etape: number,
      textes: TextesRelance,
      langue: LangueCourriel = "fr",
    ) =>
      req<{ textes: TextesRelance; personnalise: boolean }>(
        "PUT",
        `/admin/relance/courriels/${etape}`,
        { textes, langue },
        cookie,
      ),
    /** « Revenir au texte d'origine », dans une langue. */
    retablirCourrielRelance: (etape: number, langue: LangueCourriel = "fr") =>
      req<{ textes: TextesRelance; personnalise: boolean }>(
        "DELETE",
        `/admin/relance/courriels/${etape}?langue=${encodeURIComponent(langue)}`,
        undefined,
        cookie,
      ),
    /**
     * Le texte français d'une relance, traduit automatiquement dans une autre
     * langue. RIEN n'est enregistré : l'écran pose la proposition dans les
     * champs. `avertissement` dit ce qu'il faut vérifier (variable perdue…).
     */
    proposerTraductionRelance: (etape: number, langue: LangueCourriel) =>
      req<{ textes: Partial<TextesRelance>; avertissement: string | null }>(
        "POST",
        `/admin/relance/courriels/${etape}/traduction`,
        { langue },
        cookie,
      ),
    /**
     * Le courriel d'une relance tel qu'il partira, avec les textes en cours de
     * saisie (rien n'est enregistré ni envoyé). Sans textes : ceux d'aujourd'hui.
     */
    apercuCourrielRelance: (
      etape: number,
      textes?: TextesRelance,
      langue: LangueCourriel = "fr",
    ) =>
      req<{ sujet: string; html: string; texte: string }>(
        "POST",
        "/admin/courriers/relance/apercu",
        { etape, langue, ...(textes ? { textes } : {}) },
        cookie,
      ),
    /** S'envoie le courriel d'une relance, à l'adresse du compte connecté. */
    essaiCourrielRelance: (
      etape: number,
      textes?: TextesRelance,
      langue: LangueCourriel = "fr",
    ) =>
      req<{ ok: boolean; parti: boolean; destinataire: string; resume: string }>(
        "POST",
        "/admin/courriers/relance/essai",
        { etape, langue, ...(textes ? { textes } : {}) },
        cookie,
      ),
    orderDetail: (id: number) =>
      req<OrderDetail>("GET", `/admin/orders/${id}`, undefined, cookie),
    frames: () => req<Cadre[]>("GET", "/admin/frames", undefined, cookie),
    /** Traduction AUTOMATIQUE proposée (rien n'est enregistré) : champ → texte traduit. */
    proposerTraduction: (lang: string, champs: Record<string, string>) =>
      req<{ champs: Record<string, string> }>("POST", "/admin/traduire", { lang, champs }, cookie),
    /** Nom d'une catégorie de personnages dans une langue (vide = retire). */
    traduireCategorie: (id: number, lang: string, name: string) =>
      req<unknown>("POST", `/admin/categories/${id}/translations`, { lang, name }, cookie),
    /** Nom (couleur) d'un cadre dans une langue (vide = retire). */
    traduireCadre: (id: number, lang: string, name: string) =>
      req<unknown>("POST", `/admin/frames/${id}/translations`, { lang, name }, cookie),
    upsertFrame: (data: {
      id?: number;
      name: string;
      priceA4Cents: number;
      priceA3Cents: number;
      weightGrams?: number;
      previewColor?: string;
      active: boolean;
      position: number;
    }) => req<Cadre>("POST", "/admin/frames", data, cookie),
    /**
     * Archive un cadre, ou le restaure. Il n'y a plus de suppression : le
     * prix est bien figé sur la ligne de commande, mais le NOM du cadre se
     * relit — sur les commandes passées, dans les courriers, et jusque dans
     * le nom du fichier d'impression. `commandes` dit combien de lignes
     * vendues le citent, pour le redire à l'écran.
     */
    archiverCadre: (id: number, archived = true) =>
      req<{ ok: boolean; archived: boolean; commandes: number }>(
        "POST",
        `/admin/frames/${id}/archive`,
        { archived },
        cookie,
      ),
    /**
     * Supprime DÉFINITIVEMENT un cadre archivé. L'API refuse (409) ce qui n'est pas
     * archivé et ce qui sert encore, avec une phrase à montrer telle quelle.
     */
    supprimerCadre: (id: number) =>
      req<{ ok: boolean; supprime: boolean }>("DELETE", `/admin/frames/${id}`, undefined, cookie),
    /** Poids d'un cadre seul — se règle en pesant, pas en vendant. */
    setFrameWeight: (id: number, weightGrams: number) =>
      req<Cadre>("POST", `/admin/frames/${id}/poids`, { weightGrams }, cookie),

    subscribers: () =>
      req<Inscrit[]>("GET", "/admin/newsletter", undefined, cookie),
    deleteSubscriber: (id: number) =>
      req<{ ok: boolean }>("DELETE", `/admin/newsletter/${id}`, undefined, cookie),
    shipping: () =>
      req<CatalogueLivraisonBO>("GET", "/admin/shipping", undefined, cookie),
    createShippingMethod: (data: {
      name: string;
      kind: string;
      carrier?: string;
      description?: string;
      pickupLocation?: string;
      notePreparation?: string;
    }) => req<unknown>("POST", "/admin/shipping/methods", data, cookie),
    /**
     * Range les modes dans l'ordre voulu. On envoie la liste ENTIÈRE, pas un
     * « monte d'un cran » : deux modes ont le droit d'être à la même position
     * en base, et un échange deux à deux n'aurait alors rien échangé.
     */
    ordonnerModesLivraison: (ids: number[]) =>
      req<{ ok: boolean; count: number }>(
        "POST",
        "/admin/shipping/methods/ordre",
        { ids },
        cookie,
      ),
    /**
     * Archive un mode de livraison, ou le restaure. Il n'y a plus de
     * suppression : elle était refusée dès qu'une commande était partie avec
     * ce mode, et quand elle passait, elle emportait toute la grille
     * tarifaire. Archiver le décoche aussi. `commandes` dit combien sont
     * parties avec lui.
     */
    archiverModeLivraison: (id: number, archived = true) =>
      req<{ ok: boolean; archived: boolean; commandes: number }>(
        "POST",
        `/admin/shipping/methods/${id}/archive`,
        { archived },
        cookie,
      ),
    /**
     * Supprime DÉFINITIVEMENT un mode de livraison archivé, avec ses tarifs. L'API refuse (409) ce qui n'est pas
     * archivé et ce qui sert encore, avec une phrase à montrer telle quelle.
     */
    supprimerModeLivraison: (id: number) =>
      req<{ ok: boolean; supprime: boolean }>("DELETE", `/admin/shipping/methods/${id}`, undefined, cookie),
    /**
     * Modifie un mode. Ni le slug ni la NATURE ne se changent : le slug
     * voyage dans les commandes déjà parties, et la nature décide de ce qu'on
     * demande au client — la changer laisserait des commandes avec une
     * adresse et sans point de retrait.
     */
    updateShippingMethod: (
      id: number,
      data: {
        name?: string;
        description?: string;
        carrier?: string;
        pickupLocation?: string;
        notePreparation?: string;
        active?: boolean;
      },
    ) => req<unknown>("POST", `/admin/shipping/methods/${id}`, data, cookie),
    /**
     * Le nom, la précision et le lieu de retrait d'un mode dans UNE langue.
     * Un champ envoyé vide est retiré (le français s'affiche), un champ non
     * envoyé garde sa traduction.
     */
    setShippingMethodTranslation: (
      id: number,
      data: { lang: string; name?: string; description?: string; pickupLocation?: string },
    ) =>
      req<TraductionsEnregistrees<"name" | "description" | "pickupLocation">>(
        "POST",
        `/admin/shipping/methods/${id}/translations`,
        data,
        cookie,
      ),
    /** Les lieux de retrait, archivés compris (marqués), dans l'ordre de la caisse. */
    lieuxRetrait: () =>
      req<LieuRetraitBo[]>("GET", "/admin/pickup-points", undefined, cookie),
    /** Crée un lieu de retrait, ou le modifie (avec `id`). */
    enregistrerLieuRetrait: (data: {
      id?: number;
      nom: string;
      adresse: string;
      description: string;
      active: boolean;
    }) => req<LieuRetraitBo>("POST", "/admin/pickup-points", data, cookie),
    /** Archive un lieu (il quitte la caisse), ou le restaure. */
    archiverLieuRetrait: (id: number, archive = true) =>
      req<{ ok: true; archive: boolean }>(
        "POST",
        `/admin/pickup-points/${id}/archive`,
        { archive },
        cookie,
      ),
    /**
     * Supprime DÉFINITIVEMENT un lieu de retrait archivé. L'API refuse (409) ce qui n'est pas
     * archivé et ce qui sert encore, avec une phrase à montrer telle quelle.
     */
    supprimerLieuRetrait: (id: number) =>
      req<{ ok: boolean; supprime: boolean }>("DELETE", `/admin/pickup-points/${id}`, undefined, cookie),
    /** L'ordre de la caisse : les identifiants, dans l'ordre voulu. */
    rangerLieuxRetrait: (ids: number[]) =>
      req<{ ok: true }>("POST", "/admin/pickup-points/ordre", { ids }, cookie),
    /** Les redirections, vivantes et archivées, les plus récentes d'abord. */
    redirections: () =>
      req<{ vivantes: RedirectionBo[]; archivees: RedirectionBo[] }>(
        "GET",
        "/admin/redirections",
        undefined,
        cookie,
      ),
    /** Ajoute une redirection. Sur une page qui existe, rien n'est écrit sans `confirmer`. */
    ajouterRedirection: (data: {
      fromPath: string;
      toPath: string;
      code: number;
      confirmer?: boolean;
    }) => req<ReponseRedirection>("POST", "/admin/redirections", data, cookie),
    /** Change la cible et le code d'une redirection vivante (l'ancienne adresse reste). */
    modifierRedirection: (id: number, data: { toPath: string; code: number }) =>
      req<ReponseRedirection>("POST", `/admin/redirections/${id}`, data, cookie),
    /** Archive une redirection (elle ne s'applique plus), ou la restaure. */
    archiverRedirection: (id: number, archive = true, confirmer = false) =>
      req<ReponseRedirection>(
        "POST",
        `/admin/redirections/${id}/archive`,
        { archive, confirmer },
        cookie,
      ),
    /** Supprime pour de bon une redirection ARCHIVÉE ; l'API dit en clair pourquoi elle refuse. */
    supprimerRedirection: (id: number) =>
      req<SuppressionFaite>("DELETE", `/admin/redirections/${id}`, undefined, cookie),
    /** Un fichier de redirections : l'aperçu, ou l'import pour de bon (`appliquer`). */
    importerRedirections: (texte: string, appliquer: boolean) =>
      req<ResultatImportRedirections>(
        "POST",
        "/admin/redirections/import",
        { texte, appliquer },
        cookie,
      ),
    /** Le nom et le texte d'un lieu dans UNE langue (l'adresse ne se traduit pas). */
    setLieuRetraitTranslation: (
      id: number,
      data: { lang: string; nom?: string; description?: string },
    ) =>
      req<TraductionsEnregistrees<"nom" | "description">>(
        "POST",
        `/admin/pickup-points/${id}/translations`,
        data,
        cookie,
      ),
    /** L'adresse, le SIRET et la mention imprimés sur les factures (facturation.ts). */
    facturation: () =>
      req<ReglagesFacture>("GET", "/admin/facturation", undefined, cookie),
    /**
     * Enregistre les trois réglages. Refusé (400, en français) si l'adresse
     * dépasse 4 lignes de 50 caractères, ou si le SIRET n'a pas 14 chiffres.
     * `avertissement` : le SIRET ne passe pas sa clé de contrôle (enregistré
     * quand même).
     */
    enregistrerFacturation: (data: { adresse: string; siret: string; mention: string }) =>
      req<ReglagesFacture & { ok: true; avertissement: string | null }>(
        "POST",
        "/admin/facturation",
        data,
        cookie,
      ),
    /**
     * L'écran Paiements (paiements-reglages.ts) : l'état, sans aucune valeur.
     * Les écritures répondent une phrase ; un refus lève une erreur dont le
     * message vient de l'API, en français, et ne contient jamais la valeur.
     */
    paiements: () => req<EtatPaiements>("GET", "/admin/paiements", undefined, cookie),
    enregistrerClePaiement: (data: { prestataire: string; mode: string; champ: string; valeur: string }) =>
      req<ReponsePaiements>("POST", "/admin/paiements/cle", data, cookie),
    archiverClePaiement: (data: { prestataire: string; mode: string; champ: string; confirme?: boolean }) =>
      req<ReponsePaiements>("POST", "/admin/paiements/archiver", data, cookie),
    verifierPaiement: (data: { prestataire: string; mode: string }) =>
      req<ReponsePaiements & { compte: string | null; le: string }>(
        "POST",
        "/admin/paiements/verifier",
        data,
        cookie,
      ),
    modePaiement: (data: { mode: "essai" | "reel" | "env"; confirme?: boolean }) =>
      req<ReponsePaiements>("POST", "/admin/paiements/mode", data, cookie),
    /** `reelles: "env"` rend la main aux réglages du serveur (SENDCLOUD_ACHATS_REELS). */
    etiquettesReelles: (data: { reelles: boolean | "env"; confirme?: boolean }) =>
      req<ReponsePaiements>("POST", "/admin/paiements/etiquettes", data, cookie),
    /** Une ligne de grille : un prix pour un mode, une zone, une tranche. */
    upsertShippingRate: (data: {
      id?: number;
      methodId: number;
      zoneId: number;
      priceCents: number;
      freeFromCents: number | null;
      minWeightGrams: number;
      maxWeightGrams: number | null;
      active: boolean;
    }) => req<TarifLivraisonBO>("POST", "/admin/shipping/rates", data, cookie),
    /**
     * Archive une tranche de la grille, ou la restaure. Il n'y a plus de
     * suppression : un prix négocié, une borne de poids et une franchise de
     * port ne vivent nulle part ailleurs. La restauration est refusée si une
     * autre tranche a repris cette borne de poids entre-temps.
     */
    archiverTarifLivraison: (id: number, archived = true) =>
      req<{ ok: boolean; archived: boolean }>(
        "POST",
        `/admin/shipping/rates/${id}/archive`,
        { archived },
        cookie,
      ),
    /**
     * Supprime DÉFINITIVEMENT une tranche archivée. L'API refuse (409) ce qui n'est pas
     * archivé et ce qui sert encore, avec une phrase à montrer telle quelle.
     */
    supprimerTarifLivraison: (id: number) =>
      req<{ ok: boolean; supprime: boolean }>("DELETE", `/admin/shipping/rates/${id}`, undefined, cookie),
    /**
     * Remplace TOUTE la grille d'un mode dans une zone. Une tranche retirée de
     * l'écran doit disparaître de la base : la seule façon sûre est d'envoyer
     * la grille entière plutôt que ligne à ligne.
     */
    setShippingGrille: (data: {
      methodId: number;
      zoneId: number;
      freeFromCents: number | null;
      tranches: {
        minWeightGrams: number;
        maxWeightGrams: number | null;
        priceCents: number;
      }[];
    }) =>
      req<{ ok: boolean; count: number }>(
        "POST",
        "/admin/shipping/rates/grille",
        data,
        cookie,
      ),
    /** Bornes habituelles des transporteurs, pour pré-remplir une grille. */
    tranchesStandard: () =>
      req<TranchesStandard>(
        "GET",
        "/admin/shipping/tranches-standard",
        undefined,
        cookie,
      ),
    updateShippingZone: (
      id: number,
      data: { name?: string; countries?: string },
    ) => req<unknown>("POST", `/admin/shipping/zones/${id}`, data, cookie),
    /** Note interne d'une commande — jamais montrée au client. */
    setOrderNote: (id: number, note: string) =>
      req<{ id: number; internalNote: string | null }>(
        "POST",
        `/admin/orders/${id}/note`,
        { note },
        cookie,
      ),
    /** Ajoute un commentaire au journal d'une commande. */
    addOrderComment: (id: number, message: string, author?: string) =>
      req<unknown>(
        "POST",
        `/admin/orders/${id}/comment`,
        { message, author },
        cookie,
      ),
    /** Marque une commande traitée (ou la remet à traiter). */
    fulfilOrder: (id: number, fulfilled: boolean) =>
      req<{ id: number; fulfilledAt: string | null }>(
        "POST",
        `/admin/orders/${id}/fulfil`,
        { fulfilled },
        cookie,
      ),
    /** `stand` restreint les chiffres à un seul stand de salon. */
    orderStats: (days: number, channel?: string, stand?: number) =>
      req<StatsCommandes>(
        "GET",
        `/admin/stats/orders?days=${days}${channel ? `&channel=${channel}` : ""}${
          stand ? `&stand=${stand}` : ""
        }`,
        undefined,
        cookie,
      ),
    customers: (filtres?: FiltresClients) => {
      const p = new URLSearchParams();
      for (const [k, v] of Object.entries(filtres ?? {}))
        if (v !== undefined && v !== null && v !== "") p.set(k, String(v));
      const qs = p.toString();
      return req<Client[]>(
        "GET",
        `/admin/customers${qs ? `?${qs}` : ""}`,
        undefined,
        cookie,
      );
    },
    customerDetail: (id: number) =>
      req<ClientDetail>("GET", `/admin/customers/${id}`, undefined, cookie),
    /**
     * Champs qu'on corrige au back-office (téléphone mal saisi, étiquettes,
     * note). Le carnet d'adresses, lui, appartient au client : il n'est pas
     * modifiable d'ici.
     */
    updateCustomer: (
      id: number,
      data: {
        name?: string;
        email?: string;
        phone?: string;
        note?: string;
        tags?: string[];
        acceptsMarketing?: boolean;
      },
    ) => req<Client>("POST", `/admin/customers/${id}`, data, cookie),
    /**
     * L'écran « Clients » : une page de cinquante, triée sur toute la liste.
     * `sens: "inverse"` retourne le tri de la colonne.
     */
    clientsListe: (filtres: {
      q?: string;
      segment?: string;
      tri?: string;
      sens?: string;
      page?: number;
      parPage?: number;
    }) => {
      const p = new URLSearchParams();
      for (const [k, v] of Object.entries(filtres))
        if (v !== undefined && v !== null && v !== "") p.set(k, String(v));
      const qs = p.toString();
      return req<PageClients>(
        "GET",
        `/admin/customers/liste${qs ? `?${qs}` : ""}`,
        undefined,
        cookie,
      );
    },
    /** Pose ou retire une étiquette sur les clientes cochées. */
    etiqueterClients: (ids: number[], corps: { ajouter?: string; retirer?: string }) =>
      req<{ ok: true; modifiees: number; cochees: number }>(
        "POST",
        "/admin/customers/etiquettes",
        { ids, ...corps },
        cookie,
      ),
    /** Lit un fichier de clientes ; ne l'écrit qu'avec `appliquer`. */
    importerClients: (csv: string, appliquer: boolean) =>
      req<ResultatImportClients>(
        "POST",
        "/admin/customers/import",
        { csv, appliquer },
        cookie,
      ),
    users: () => req<CompteAdmin[]>("GET", "/admin/users", undefined, cookie),
    /**
     * Change le mot de passe du compte CONNECTÉ, quel que soit son rôle
     * (l'ancien est demandé). Ses autres sessions sont fermées.
     */
    changerMonMotDePasse: (ancien: string, nouveau: string) =>
      req<{ ok: boolean }>("POST", "/auth/mot-de-passe", { ancien, nouveau }, cookie),
    upsertUser: (data: {
      id?: number;
      email: string;
      role: string;
      password?: string;
      /** Absent = on n'y touche pas ; [] = plus aucun stand confié. */
      standIds?: number[];
    }) => req<{ id: number; email: string }>("POST", "/admin/users", data, cookie),
    /**
     * Archive un compte, ou le restaure. Il n'y a plus de suppression : les
     * journaux des commandes citent le NOM de qui a expédié, remboursé ou
     * annulé, et un compte effacé rendait ces lignes anonymes.
     *
     * Un compte archivé ne peut plus se connecter, et ses sessions ouvertes
     * sont fermées — c'est la seule suppression que cet archivage s'autorise.
     */
    archiverCompte: (id: number, archived = true) =>
      req<{ ok: boolean; archived: boolean }>(
        "POST",
        `/admin/users/${id}/archive`,
        { archived },
        cookie,
      ),
    /**
     * Supprime DÉFINITIVEMENT un compte archivé. L'API refuse (409) ce qui n'est pas
     * archivé et ce qui sert encore, avec une phrase à montrer telle quelle.
     */
    supprimerCompte: (id: number) =>
      req<{ ok: boolean; supprime: boolean }>("DELETE", `/admin/users/${id}`, undefined, cookie),
    logoutUser: (id: number) =>
      req<{ ok: boolean }>(
        "POST",
        `/admin/users/${id}/deconnecter`,
        {},
        cookie,
      ),
    views: () =>
      req<TypeAffiche[]>("GET", "/admin/views", undefined, cookie),
    upsertView: (data: {
      id?: number;
      name: string;
      foregroundUrl?: string | null;
      active?: boolean;
      position?: number;
    }) => req<TypeAffiche>("POST", "/admin/views", data, cookie),
    /**
     * Archive un type d'affiche, ou le restaure. Il n'y a plus de suppression :
     * le `slug` relie produits, personnages et pièces à leur type, et l'effacer
     * les laissait pointer dans le vide.
     */
    archiverView: (id: number, archived = true) =>
      req<{
        ok: boolean;
        archived: boolean;
        usage: { produits: number; personnages: number; pieces: number };
      }>("POST", `/admin/views/${id}/archive`, { archived }, cookie),
    /**
     * Supprime DÉFINITIVEMENT un type d'affiche archivé. L'API refuse (409) ce qui n'est pas
     * archivé et ce qui sert encore, avec une phrase à montrer telle quelle.
     */
    supprimerView: (id: number) =>
      req<{ ok: boolean; supprime: boolean }>("DELETE", `/admin/views/${id}`, undefined, cookie),
    pieceCategories: () =>
      req<CategoriePiece[]>("GET", "/admin/piece-categories", undefined, cookie),
    upsertPieceCategory: (data: {
      id?: number;
      name: string;
      slot: string;
      colors: string[];
      active?: boolean;
      position?: number;
      couleursProposees?: "toutes" | "principale";
    }) => req<CategoriePiece>("POST", "/admin/piece-categories", data, cookie),
    /**
     * Archive une catégorie de pièces, ou la restaure. Il n'y a plus de
     * suppression : l'effacer dispersait ses pièces et emportait son nuancier.
     * `dedans` dit combien de pièces elle range, pour le redire à l'écran.
     */
    archiverCategoriePiece: (id: number, archived = true) =>
      req<{ ok: boolean; archived: boolean; dedans: number }>(
        "POST",
        `/admin/piece-categories/${id}/archive`,
        { archived },
        cookie,
      ),
    /**
     * Supprime définitivement une catégorie de pièces ARCHIVÉE. L'API refuse
     * (409, raison en clair) tant qu'elle range des pièces en service ou
     * qu'une couleur prend son nuancier : l'erreur levée porte sa phrase.
     */
    supprimerCategoriePiece: (id: number) =>
      req<{ ok: true; supprime: true }>("DELETE", `/admin/piece-categories/${id}`, undefined, cookie),
    /**
     * Les nuanciers des personnages (peau, cheveux / pelage, vêtements,
     * pantalon) et, pour chacun, s'il a été réglé par la boutique.
     */
    nuanciersBase: () =>
      req<{
        nuanciers: Record<"peau" | "cheveux" | "vetements" | "pantalon", string[]>;
        modifies: Record<string, boolean>;
      }>("GET", "/admin/nuanciers-base", undefined, cookie),
    /**
     * Enregistre UN nuancier des personnages, dans l'ordre donné ;
     * `couleurs: null` le remet à ses couleurs d'origine.
     */
    enregistrerNuancierBase: (nuancier: string, couleurs: string[] | null) =>
      req<{ ok: true }>(
        "POST",
        "/admin/nuanciers-base",
        { nuancier, couleurs },
        cookie,
      ),
    /** Range un lot de pièces dans une catégorie (null = les en sort). */
    setAssetsCategory: (ids: number[], pieceCategoryId: number | null) =>
      req<{ ok: boolean; count: number }>(
        "POST",
        "/admin/assets/category",
        { ids, pieceCategoryId },
        cookie,
      ),
    categories: () =>
      req<CharacterCategory[]>("GET", "/admin/categories", undefined, cookie),
    upsertCategory: (data: { id?: number; name: string; position?: number }) =>
      req<CharacterCategory>("POST", "/admin/categories", data, cookie),
    /**
     * Archive une catégorie de personnages, ou la restaure. Il n'y a plus de
     * suppression : l'effacer vidait le rangement de chaque personnage, et
     * seule une remise à la main les y ramenait. `dedans` dit combien elle en
     * range, pour le redire à l'écran.
     */
    archiverCategoriePersonnage: (id: number, archived = true) =>
      req<{ ok: boolean; archived: boolean; dedans: number }>(
        "POST",
        `/admin/categories/${id}/archive`,
        { archived },
        cookie,
      ),
    /**
     * Supprime définitivement une catégorie de personnages ARCHIVÉE. L'API
     * refuse (409, raison en clair) tant qu'elle range des personnages en
     * service : l'erreur levée porte sa phrase.
     */
    supprimerCategoriePersonnage: (id: number) =>
      req<{ ok: true; supprime: true }>("DELETE", `/admin/categories/${id}`, undefined, cookie),
    /** Remplace la composition de la catégorie par la liste cochée. */
    setCategoryCharacters: (id: number, characterIds: number[]) =>
      req<{ category: string; attached: number; detached: number }>(
        "POST",
        `/admin/categories/${id}/characters`,
        { characterIds },
        cookie,
      ),
    characters: () =>
      req<{ types: CharacterType[]; assets: Asset[]; categories: CharacterCategory[] }>(
        "GET",
        "/admin/characters",
        undefined,
        cookie,
      ),
    /** Le nom d'un personnage dans UNE langue (vide = le français s'affiche). */
    setCharacterTranslation: (id: number, data: { lang: string; name: string }) =>
      req<TraductionsEnregistrees<"name">>(
        "POST",
        `/admin/characters/${id}/translations`,
        data,
        cookie,
      ),
    upsertCharacter: (data: Partial<CharacterType>) =>
      req<CharacterType>("POST", "/admin/characters", data, cookie),
    setCharacterBase: (
      id: number,
      data: {
        baseSvgUrl?: string | null;
        baseColorZones?: Record<string, string> | null;
        baseGroupesCouleurs?: GroupeCouleur[] | null;
        baseZonesProposees?: string[] | null;
        baseCouleursImage?: CouleursImage | null;
      },
    ) => req<CharacterType>("POST", `/admin/characters/${id}/base`, data, cookie),
    /** Archive ou restaure une pièce (la suppression définitive n'existe plus). */
    archiveAsset: (id: number, archived: boolean) =>
      req<{ ok: boolean; archived: boolean }>(
        "POST",
        `/admin/assets/${id}/archive`,
        { archived },
        cookie,
      ),
    /**
     * Supprime définitivement une pièce ARCHIVÉE. L'API refuse (409, raison
     * en clair) tant qu'une commande la porte ou qu'elle est la tenue par
     * défaut d'un personnage en service : l'erreur levée porte sa phrase.
     */
    supprimerPiece: (id: number) =>
      req<{ ok: true; supprime: true }>("DELETE", `/admin/assets/${id}`, undefined, cookie),
    archiveCharacter: (id: number, archived: boolean) =>
      req<CharacterType>(
        "POST",
        `/admin/characters/${id}/archive`,
        { archived },
        cookie,
      ),
    /**
     * Supprime définitivement un personnage ARCHIVÉ. L'API refuse (409,
     * raison en clair) tant qu'une commande le porte : l'erreur levée porte
     * sa phrase.
     */
    supprimerPersonnage: (id: number) =>
      req<{ ok: true; supprime: true }>("DELETE", `/admin/characters/${id}`, undefined, cookie),
    /** Montre (true) ou masque (false) un personnage sur le site. */
    personnageVisible: (id: number, active: boolean) =>
      req<{ id: number; active: boolean }>(
        "POST",
        `/admin/characters/${id}/visible`,
        { active },
        cookie,
      ),
    /** Déplace des personnages vers une catégorie (null = sans catégorie). */
    moveCharacters: (ids: number[], categoryId: number | null) =>
      req<{ ok: boolean; moved: number }>(
        "POST",
        "/admin/characters/category",
        { ids, categoryId },
        cookie,
      ),
    /** Enregistre les pièces autorisées d'un personnage, par emplacement. */
    setSlotVariants: (
      id: number,
      data: Partial<
        Record<"clothes" | "pants" | "hair" | "accessory", number[]>
      >,
    ) =>
      req<{ ok: boolean; slotVariants: Record<string, number[]> }>(
        "POST",
        `/admin/characters/${id}/slot-variants`,
        data,
        cookie,
      ),
    reorderCharacters: (
      items: { id: number; position: number; category?: string | null }[],
    ) =>
      req<{ ok: boolean; count: number }>(
        "POST",
        "/admin/characters/reorder",
        { items },
        cookie,
      ),
    assets: () => req<Asset[]>("GET", "/admin/assets", undefined, cookie),
    upsertAsset: (data: Partial<Asset>) =>
      req<Asset>("POST", "/admin/assets", data, cookie),
    setAssetColors: (id: number, colorZones: Record<string, string>) =>
      req<Asset>("POST", `/admin/assets/${id}/colors`, { colorZones }, cookie),
    /**
     * La liste des produits telle que le back-office la voit, brouillons et
     * archives compris. La route publique /products ne sert plus ici : elle
     * ne montre que ce qui est en vente.
     */
    produitsAdmin: (params?: {
      statut?: string;
      q?: string;
      categorie?: number;
      collection?: number;
      /** Demander précisément ces produits-là, sans charger tout le reste. */
      ids?: number[];
      limit?: number;
      /** Joindre la description de chaque affiche (grille de masse seulement). */
      avecDescription?: boolean;
    }) => {
      const p = new URLSearchParams();
      if (params?.ids?.length) p.set("ids", params.ids.join(","));
      if (params?.statut && params.statut !== "tous") p.set("statut", params.statut);
      if (params?.q) p.set("q", params.q);
      if (params?.categorie) p.set("categorie", String(params.categorie));
      if (params?.collection) p.set("collection", String(params.collection));
      if (params?.limit) p.set("limit", String(params.limit));
      if (params?.avecDescription) p.set("avecDescription", "1");
      const suite = p.toString();
      return req<ListeProduitsAdmin>(
        "GET",
        `/admin/products${suite ? `?${suite}` : ""}`,
        undefined,
        cookie,
      );
    },
    /**
     * Lit un fichier d'import de fiches produit.
     *
     * Sans `appliquer`, RIEN n'est écrit : on rend seulement ce qui se
     * passerait. Un import de quarante affiches ne se lance pas à l'aveugle.
     */
    importerProduits: (csv: string, appliquer = false) =>
      req<ResultatImport>(
        "POST",
        "/admin/products/import",
        { csv, appliquer },
        cookie,
      ),

    /* --- Collections : la façon de ranger les affiches ------------------ */
    collections: () =>
      req<{ collections: CollectionBo[] }>(
        "GET",
        "/admin/collections",
        undefined,
        cookie,
      ),
    /** Une collection et les produits qui y sont rangés, dans l'ordre voulu. */
    collection: (id: number) =>
      req<{ collection: CollectionBo; produits: ProduitDeCollection[] }>(
        "GET",
        `/admin/collections/${id}`,
        undefined,
        cookie,
      ),
    creerCollection: (corps: { name: string }) =>
      req<{ id: number }>("POST", "/admin/collections", corps, cookie),
    /**
     * Range les collections : le tableau fait foi, la première prend le rang
     * 1. C'est l'ordre de toutes les listes de collections, site compris.
     */
    ordonnerCollections: (collections: number[], menu = false) =>
      req<{ ok: true; ranges: number; liensMenu: number }>(
        "POST",
        "/admin/collections/ordre",
        // `menu` : les liens du menu vers ces collections suivent l'ordre.
        { collections, menu },
        cookie,
      ),
    /**
     * Les collections dont la page existe sur le site : actives, et avec au
     * moins une affiche en ligne. Les autres répondent « page introuvable ».
     */
    collectionsEnLigne: () =>
      req<CollectionEnLigne[]>("GET", "/collections", undefined, cookie),
    /** Renomme, décrit, active, ou fixe le poids par défaut. */
    majCollection: (
      id: number,
      corps: {
        name?: string;
        description?: string | null;
        active?: boolean;
        defaultWeightGrams?: number | null;
        position?: number;
      },
    ) => req<{ ok: true }>("POST", `/admin/collections/${id}`, corps, cookie),
    /**
     * Le nom et la description (HTML) d'une collection dans UNE langue. Un
     * champ envoyé vide est retiré, un champ non envoyé garde sa traduction.
     */
    setCollectionTranslation: (
      id: number,
      data: { lang: string; name?: string; description?: string },
    ) =>
      req<TraductionsEnregistrees<"name" | "description">>(
        "POST",
        `/admin/collections/${id}/translations`,
        data,
        cookie,
      ),
    /**
     * Archive la collection, ou la restaure.
     *
     * Le rangement des affiches n'est pas touché : `dedans` dit combien elle en
     * range, pour pouvoir le redire à l'écran. C'est ce qui permet de la
     * restaurer complète.
     */
    archiverCollection: (id: number, archived = true) =>
      req<{ ok: true; archived: boolean; dedans: number }>(
        "POST",
        `/admin/collections/${id}/archive`,
        { archived },
        cookie,
      ),
    /**
     * Supprime définitivement une collection ARCHIVÉE et vide. Refusée (409,
     * raison en clair) si des affiches y sont rangées, ou si le menu ou une
     * page la cite encore.
     */
    supprimerCollection: (id: number) =>
      req<{ ok: true; supprime: true }>("DELETE", `/admin/collections/${id}`, undefined, cookie),
    /** Range des produits dans la collection, ou les en sort. */
    produitsDeCollection: (
      id: number,
      corps: { ajouter?: number[]; retirer?: number[] },
    ) =>
      req<{ ok: true; dedans: number }>(
        "POST",
        `/admin/collections/${id}/produits`,
        corps,
        cookie,
      ),
    /**
     * Fixe l'ordre des produits dans la collection.
     *
     * Le tableau fait foi : la position devient l'indice. Ceux qui n'y
     * figurent pas gardent leur place derrière.
     */
    ordreCollection: (id: number, produits: number[]) =>
      req<{ ok: true; ranges: number }>(
        "POST",
        `/admin/collections/${id}/ordre`,
        { produits },
        cookie,
      ),

    /* --- Contenu du site : pages libres et menu ------------------------ */
    /** Les pages créées depuis le back-office. */
    pages: () =>
      req<{ pages: ResumePage[] }>("GET", "/admin/pages", undefined, cookie),
    /** Une page, plus les collections et catégories pour ses blocs produits. */
    page: (id: number) =>
      req<PageCms>("GET", `/admin/pages/${id}`, undefined, cookie),
    creerPage: (corps: { slug: string; title: string }) =>
      req<{ id: number }>("POST", "/admin/pages", corps, cookie),
    /** Range les pages : le tableau fait foi, la première prend le rang 1. */
    ordonnerPages: (pages: number[], menu = false) =>
      req<{ ok: true; ranges: number; liensMenu: number }>(
        "POST",
        "/admin/pages/ordre",
        // `menu` : les liens du menu vers ces pages suivent l'ordre.
        { pages, menu },
        cookie,
      ),
    /** Enregistre une page. Les clés absentes ne sont pas touchées. */
    enregistrerPage: (id: number, corps: Record<string, unknown>) =>
      req<{ ok: true }>("POST", `/admin/pages/${id}`, corps, cookie),
    /**
     * Archive une page, ou la restaure. La page garde son texte et son
     * adresse : elle quitte le site, elle ne disparaît pas.
     */
    archiverPage: (id: number, archived = true) =>
      req<{ ok: true; archived: boolean }>(
        "POST",
        `/admin/pages/${id}/archive`,
        { archived },
        cookie,
      ),
    /** Supprime pour de bon une page ARCHIVÉE ; refusée (409) tant que le menu ou une redirection y mène. */
    supprimerPage: (id: number) =>
      req<SuppressionFaite>("DELETE", `/admin/pages/${id}`, undefined, cookie),
    /** Le menu du site, entrées masquées comprises — et les liens retirés. */
    menu: () => req<MenuCms>("GET", "/admin/menu", undefined, cookie),
    /**
     * Remplace TOUT l'arbre du menu : l'ordre du tableau fait la position.
     * Ce qui n'y figure plus part aux archives, d'où il se restaure.
     */
    enregistrerMenu: (entrees: unknown[]) =>
      req<{ ok: true }>("POST", "/admin/menu", { entrees }, cookie),
    /** Remet dans le menu un lien qui en avait été retiré. */
    restaurerLienMenu: (id: number) =>
      req<{ ok: true }>("POST", `/admin/menu/${id}/restaurer`, {}, cookie),
    /** Supprime pour de bon un lien retiré du menu, avec ses sous-liens rangés. */
    supprimerLienMenu: (id: number) =>
      req<SuppressionFaite>("DELETE", `/admin/menu/${id}`, undefined, cookie),

    /* --- Ordre d'affichage de chaque page de liste --------------------- */
    /** Les affiches actives d'un genre, dans l'ordre où la boutique les montre. */
    ordreGenre: (genre: string) =>
      req<{ genre: string; rangees: number; produits: ProduitDeCollection[] }>(
        "GET",
        `/admin/products/ordre?genre=${encodeURIComponent(genre)}`,
        undefined,
        cookie,
      ),
    /** Enregistre l'ordre d'un genre : les affiches reçues prennent leur rang. */
    enregistrerOrdreGenre: (genre: string, produits: number[]) =>
      req<{ ok: true; ranges: number }>(
        "POST",
        "/admin/products/ordre",
        { genre, produits },
        cookie,
      ),
    /**
     * Les pages de liste du site que l'on peut ranger : « Toutes les
     * affiches », les deux genres, puis chaque collection en ligne — avec ce
     * qu'elle range en plus (vitrine de l'accueil, rangée d'une page).
     */
    pagesARanger: () =>
      req<{ pages: PageARanger[] }>(
        "GET",
        "/admin/products/ordre/pages",
        undefined,
        cookie,
      ),
    /**
     * Les affiches en ligne d'une page, dans l'ordre du site. `page` vaut
     * « tout », un genre, ou « collection:<id> ».
     */
    ordrePage: (page: string) => {
      const collection = /^collection:(\d+)$/.exec(page)?.[1];
      return req<{
        page: string;
        /** Null pour une collection : son ordre est toujours un choix. */
        rangees: number | null;
        /** Brouillons et archives de la page, qui ne se rangent pas ici. */
        horsLigne: number;
        produits: ProduitDeCollection[];
      }>(
        "GET",
        collection
          ? `/admin/products/ordre?collection=${collection}`
          : `/admin/products/ordre?genre=${encodeURIComponent(page)}`,
        undefined,
        cookie,
      );
    },

    /* --- Statistiques de vente ----------------------------------------- */
    /** Tout l'écran en un appel : résumé, courbe, meilleures ventes, clientes. */
    analytique: (
      filtres: {
        depuis?: string;
        jusqu?: string;
        canal?: CanalAnalytique;
        /** Un seul stand ; il impose le canal des stands. */
        stand?: number | null;
      } = {},
    ) => {
      const p = new URLSearchParams();
      for (const [k, v] of Object.entries(filtres)) if (v) p.set(k, String(v));
      const qs = p.toString();
      return req<Analytique>(
        "GET",
        `/admin/analytique${qs ? `?${qs}` : ""}`,
        undefined,
        cookie,
      );
    },

    /* --- Styles d'affiche IA ------------------------------------------- */
    /** Tous les styles, éteints compris : c'est l'écran qui les range. */
    stylesIa: () =>
      req<StyleIa[]>("GET", "/admin/ia/prompts", undefined, cookie),
    creerStyleIa: (corps: Record<string, unknown>) =>
      req<StyleIa>("POST", "/admin/ia/prompts", corps, cookie),
    majStyleIa: (id: number, corps: Record<string, unknown>) =>
      req<StyleIa>("PUT", `/admin/ia/prompts/${id}`, corps, cookie),
    /** Le titre d'un style dans une autre langue ; vide, le français s'affiche. */
    traduireStyleIa: (id: number, lang: string, title: string) =>
      req<{ translations: StyleIa["translations"] }>(
        "POST",
        `/admin/ia/prompts/${id}/translations`,
        { lang, title },
        cookie,
      ),
    /**
     * Archive un style, ou le restaure. Il n'y a plus de suppression : la
     * consigne et les images d'un style ne vivent nulle part ailleurs.
     */
    archiverStyleIa: (id: number, archived = true) =>
      req<{ ok: true; archived: boolean }>(
        "POST",
        `/admin/ia/prompts/${id}/archive`,
        { archived },
        cookie,
      ),
    /** Supprime définitivement un style ARCHIVÉ (ses images restent sur le disque). */
    supprimerStyleIa: (id: number) =>
      req<{ ok: true; supprime: true }>("DELETE", `/admin/ia/prompts/${id}`, undefined, cookie),

    /* --- Essai des courriers ------------------------------------------- */
    /** Où partent les courriers en ce moment : boîte d'essai, ou vrais clients. */
    etatCourriers: () =>
      req<EtatCourriers>("GET", "/admin/courriers/etat", undefined, cookie),
    modelesCourriers: () =>
      req<{ modeles: ModeleCourrier[] }>(
        "GET",
        "/admin/courriers/modeles",
        undefined,
        cookie,
      ),
    /** Le courrier tel qu'il arrivera, sans rien envoyer. */
    /**
     * `langue` : celle du courrier. Absente, c'est celle que la cliente de la
     * commande recevrait (le français pour la commande d'exemple).
     */
    apercuCourrier: (modele: string, commande?: string, langue?: string) => {
      const p = new URLSearchParams();
      if (commande) p.set("commande", commande);
      if (langue) p.set("langue", langue);
      const qs = p.toString();
      return req<{
        modele: string;
        sujet: string;
        html: string;
        source: string;
        commande?: string;
        /** La langue dans laquelle le courrier a été rendu. */
        langue?: string;
      }>(
        "GET",
        `/admin/courriers/apercu/${encodeURIComponent(modele)}${qs ? `?${qs}` : ""}`,
        undefined,
        cookie,
      );
    },
    /** Envoie un courrier d'essai. La réponse dit où il est réellement allé. */
    essaiCourrier: (corps: {
      modele: string;
      destinataire: string;
      commande?: string;
      langue?: string;
    }) =>
      req<{ ok: true; parti: boolean; resume: string }>(
        "POST",
        "/admin/courriers/essai",
        corps,
        cookie,
      ),

    /** La fiche complète d'un produit, en un seul appel. */
    ficheProduit: (id: number) =>
      req<FicheProduit>("GET", `/admin/products/${id}/fiche`, undefined, cookie),
    /**
     * Enregistre la fiche. Les clés absentes ne sont pas touchées.
     * `redirection` : la 301 posée quand l'adresse de l'affiche a changé.
     */
    enregistrerFicheProduit: (id: number, corps: Record<string, unknown>) =>
      req<{ ok: true; redirection?: { de: string; vers: string } | null }>(
        "POST",
        `/admin/products/${id}/fiche`,
        corps,
        cookie,
      ),
    /** Ce que cette affiche a rapporté sur les derniers jours. */
    ventesProduit: (id: number, jours = 90) =>
      req<VentesProduit>(
        "GET",
        `/admin/products/${id}/ventes?jours=${jours}`,
        undefined,
        cookie,
      ),
    /** Une même action appliquée à plusieurs produits d'un coup. */
    produitsEnMasse: (
      ids: number[],
      action: string,
      params?: Record<string, unknown>,
    ) =>
      req<{
        ok: true;
        count: number;
        refuses?: { id: number; name: string; raison: string }[];
      }>("POST", "/admin/products/bulk", { ids, action, ...params }, cookie),
    /**
     * Supprime définitivement une affiche ARCHIVÉE. L'API refuse (409, avec la
     * raison en clair) une affiche qui n'est pas archivée ou dont une commande
     * a besoin ; l'erreur levée porte cette phrase.
     */
    supprimerProduit: (id: number) =>
      req<{ ok: true; supprime: true }>("DELETE", `/admin/products/${id}`, undefined, cookie),
    /** L'éditeur en grille : chaque ligne porte ses propres changements. */
    enregistrerProduitsEnMasse: (
      modifications: Record<string, unknown>[],
      /** Vrai : rien n'est écrit, la réponse montre ce qui changerait. */
      apercu = false,
    ) =>
      req<{
        ok: true;
        count: number;
        /** Adresses changées, donc redirections 301 posées (ou prévues). */
        redirections?: number;
        apercu?: ApercuMasse[];
        erreurs?: { id: number; message: string }[];
      }>(
        "POST",
        "/admin/products/masse",
        apercu ? { modifications, apercu: true } : { modifications },
        cookie,
      ),
    productCategories: () =>
      req<CategorieProduit[]>(
        "GET",
        "/admin/product-categories",
        undefined,
        cookie,
      ),
    upsertProductCategory: (data: {
      id?: number;
      name: string;
      description?: string | null;
      defaultWeightGrams?: number;
      active?: boolean;
      position?: number;
    }) =>
      req<CategorieProduit>("POST", "/admin/product-categories", data, cookie),
    /**
     * Archive une catégorie de produits, ou la restaure. Il n'y a plus de
     * suppression : l'effacer remettait à zéro le rangement de ses produits,
     * et donc le poids par défaut qui décide de leur affranchissement.
     * `dedans` dit combien elle en range, pour le redire à l'écran.
     */
    archiverCategorieProduit: (id: number, archived = true) =>
      req<{ ok: boolean; archived: boolean; dedans: number }>(
        "POST",
        `/admin/product-categories/${id}/archive`,
        { archived },
        cookie,
      ),
    /**
     * Supprime définitivement une catégorie ARCHIVÉE et vide. Refusée (409,
     * raison en clair) si des produits y sont rangés ou si une page la montre.
     */
    supprimerCategorieProduit: (id: number) =>
      req<{ ok: true; supprime: true }>("DELETE", `/admin/product-categories/${id}`, undefined, cookie),
    /** Range un lot de produits dans une catégorie (null = les en sort). */
    setProductsCategory: (ids: number[], categoryId: number | null) =>
      req<{ ok: boolean; count: number }>(
        "POST",
        "/admin/products/category",
        { ids, categoryId },
        cookie,
      ),
    productLogistique: (id: number | string) =>
      req<LogistiqueProduit>(
        "GET",
        `/admin/products/${id}/logistique`,
        undefined,
        cookie,
      ),
    /** Un poids laissé à null retombe sur l'échelon du dessus. */
    setProductLogistique: (
      id: number | string,
      data: {
        categoryId: number | null;
        weightGrams: number | null;
        variantes: { id: number; weightGrams: number | null }[];
      },
    ) =>
      req<{ ok: boolean }>(
        "POST",
        `/admin/products/${id}/logistique`,
        data,
        cookie,
      ),
    /** Produits dont le poids reste inconnu — le garde-fou de l'affranchissement. */
    productsSansPoids: () =>
      req<{ id: number; name: string; slug: string }[]>(
        "GET",
        "/admin/products/sans-poids",
        undefined,
        cookie,
      ),
    productConfig: (id: number | string) =>
      req<ProductConfig>("GET", `/admin/products/${id}/config`, undefined, cookie),
    /** Traductions saisies (sans repli) + le français de référence. */
    productTranslations: (id: number | string) =>
      req<{
        id: number;
        fr: {
          name: string;
          description: string | null;
          /** Le référencement français, rempli ou non. */
          seoTitle?: string | null;
          seoDescription?: string | null;
        };
        translations: Record<
          string,
          { name?: string; description?: string; seoTitle?: string; seoDescription?: string }
        >;
      }>("GET", `/admin/products/${id}/translations`, undefined, cookie),
    /**
     * Enregistre UNE langue. Un champ envoyé vide retire sa traduction ; un
     * champ non envoyé garde la sienne.
     */
    setProductTranslation: (
      id: number | string,
      data: {
        lang: string;
        name?: string;
        description?: string;
        /** Le titre et la description Google dans cette langue. */
        seoTitle?: string;
        seoDescription?: string;
      },
    ) =>
      req<{ ok: boolean; translations: Record<string, unknown> }>(
        "POST",
        `/admin/products/${id}/translations`,
        data,
        cookie,
      ),
    setProductConfig: (
      id: number | string,
      data: {
        /** Lignes 1, 2 et 3 du texte pré-rempli. */
        defaultTitle?: string | null;
        defaultSubtitle?: string | null;
        defaultLine3?: string | null;
        /** Slug du type d'affiche (« front », « back », ou créé au BO). */
        defaultView?: string | null;
        foregroundUrl?: string | null;
      },
    ) =>
      req<ProductConfig>(
        "POST",
        `/admin/products/${id}/config`,
        data,
        cookie,
      ),
    /** Crée une affiche complète (fiche + formats + visuels + fonds). */
    createProduct: (data: {
      name: string;
      description?: string | null;
      kind?: "personnalisable" | "prete_a_imprimer";
      defaultView?: string | null;
      /** Lignes 1, 2 et 3 du texte pré-rempli. */
      defaultTitle?: string | null;
      defaultSubtitle?: string | null;
      defaultLine3?: string | null;
      variants: { format: string; priceCents: number }[];
      images?: string[];
      backgrounds?: string[];
    }) =>
      req<{ id: number; slug: string; name: string }>(
        "POST",
        "/admin/products",
        data,
        cookie,
      ),
    addProductBackground: (
      id: number | string,
      data: { url: string; name?: string },
    ) =>
      req<ProductBackground>(
        "POST",
        `/admin/products/${id}/backgrounds`,
        data,
        cookie,
      ),
    /**
     * Archive un visuel (fond), ou le restaure. Archivé, il quitte les choix
     * du configurateur et reste imprimable pour les commandes passées dessus.
     */
    archiverBackground: (bgId: number | string, archived = true) =>
      req<{ ok: boolean; archived: boolean }>(
        "POST",
        `/admin/backgrounds/${bgId}/archive`,
        { archived },
        cookie,
      ),
    /**
     * Supprime définitivement un visuel (fond) ARCHIVÉ. L'API refuse (409,
     * raison en clair) tant qu'une commande est composée dessus : l'erreur
     * levée porte sa phrase.
     */
    supprimerBackground: (bgId: number | string) =>
      req<{ ok: true; supprime: true }>("DELETE", `/admin/backgrounds/${bgId}`, undefined, cookie),
    /** Générations récentes, filtrables par statut et paginées. */
    iaGenerations: (filtres?: FiltresIA) => {
      const p = new URLSearchParams();
      for (const [k, v] of Object.entries(filtres ?? {}))
        if (v !== undefined && v !== null && v !== "") p.set(k, String(v));
      const qs = p.toString();
      return req<ListeGenerationsIA>(
        "GET",
        `/admin/ia/generations${qs ? `?${qs}` : ""}`,
        undefined,
        cookie,
      );
    },
    /** Dépense du mois, plafond, essais et échecs. */
    iaStats: () => req<StatsIA>("GET", "/admin/ia/stats", undefined, cookie),
    /** Ouvre (ou ferme) la génération par IA sur une affiche. */
    setProductIa: (
      id: number | string,
      data: { aiEnabled: boolean; aiStylePrompt: string | null },
    ) => req<ProduitIA>("POST", `/admin/products/${id}/ia`, data, cookie),
    /**
     * Lance la purge des photos de visiteurs sans attendre son passage
     * horaire. `simulation` compte ce qui partirait, sans rien effacer.
     */
    purgerIa: (simulation = false) =>
      req<BilanPurgeIa>("POST", "/admin/ia/purger", { simulation }, cookie),

    /* --- Cartes cadeaux -------------------------------------------------- */

    /** Toutes les cartes, et la somme des soldes encore échangeables. */
    cartesCadeaux: () =>
      req<ListeCartesCadeaux>("GET", "/admin/gift-cards", undefined, cookie),
    /** Une carte, tous ses mouvements, et son destinataire. */
    carteCadeau: (id: number) =>
      req<DetailCarteCadeau>("GET", `/admin/gift-cards/${id}`, undefined, cookie),
    /**
     * Vend une carte. Le code est tiré par le serveur : on ne l'envoie jamais.
     *
     * Le montant part en CENTIMES, comme partout ailleurs dans cette API. La
     * saisie en euros se convertit dans la page, jamais ici.
     */
    creerCarteCadeau: (data: {
      montantCents: number;
      expiresAt?: string | null;
      customerId?: number | null;
      note?: string | null;
    }) => req<{ carte: CarteCadeau }>("POST", "/admin/gift-cards", data, cookie),
    /** Désactive, réactive, ou change la note et la date de fin. */
    majCarteCadeau: (
      id: number,
      data: { status?: string; note?: string | null; expiresAt?: string | null },
    ) => req<{ ok: boolean }>("POST", `/admin/gift-cards/${id}`, data, cookie),
    /**
     * Recharge la carte, ou corrige une erreur.
     *
     * Passe par le journal, jamais par une écriture directe du solde : c'est ce
     * qui garantit que le compteur et les écritures ne peuvent pas diverger.
     */
    ajusterCarteCadeau: (
      id: number,
      data: { amountCents: number; label: string },
    ) =>
      req<{ ok: boolean; solde: number }>(
        "POST",
        `/admin/gift-cards/${id}/ajuster`,
        data,
        cookie,
      ),
  };
}

/**
 * Les lignes de texte d'une affiche commandée, dans l'ordre, sans les vides.
 *
 * L'API les sert dans `lignesAffiche`. Une commande passée avant les trois
 * lignes ne porte qu'un titre et un sous-titre : sans ce repli, elle
 * s'afficherait — et s'imprimerait — sans son texte.
 */
export function lignesDeLAffiche(item: {
  lignesAffiche?: (string | null)[] | null;
  titreAffiche?: string | null;
  sousTitreAffiche?: string | null;
}): string[] {
  const remplies = (source: (string | null | undefined)[]) =>
    source.map((l) => String(l ?? "").trim()).filter(Boolean);
  const lignes = remplies(item.lignesAffiche ?? []);
  return lignes.length
    ? lignes
    : remplies([item.titreAffiche, item.sousTitreAffiche]);
}

export function formatPrice(cents: number): string {
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100);
}

/** Un bordereau transporteur acheté chez SendCloud (apps/api/src/sendcloud-colis.ts). */
export interface Bordereau {
  id: number;
  orderId: number;
  statut: "en_cours" | "achete" | "echec" | "annule";
  essai: boolean;
  methodeCode: string;
  methodeNom: string;
  transporteur: string | null;
  poidsGrammes: number;
  prixAnnonceCents: number | null;
  shipmentId: string | null;
  parcelId: number | null;
  trackingNumber: string | null;
  trackingUrl: string | null;
  erreur: string | null;
  auteur: string | null;
  createdAt: string;
  acheteAt: string | null;
  annuleAt: string | null;
}

export interface EtatBordereau {
  configure: boolean;
  essai: boolean;
  /**
   * Pourquoi on ne peut pas acheter, quoi qu'on saisisse : commande annulée,
   * non payée, panier, clés absentes. La phrase dit aussi quoi faire.
   */
  empechement: string | null;
  /**
   * Ce qu'il faut encore à l'étiquette et qui se corrige depuis la fiche :
   * « destinataire » dans le bloc du bordereau, « email » sur la fiche cliente.
   */
  manques: { champ: "destinataire" | "email"; message: string }[];
  /** Ce que la commande dit de l'envoi (apps/api/src/sendcloud-colis.ts). */
  situation: {
    destination: "point_relais" | "adresse";
    envoiPaye: "transporteur" | "hors_sendcloud" | "retrait" | "stand" | "inconnu";
    transporteurPaye: string | null;
    transporteurSendcloud: string | null;
  };
  bordereau: Bordereau | null;
  poidsGrammes: number;
  pointRelais: string | null;
  /** La liste montre-t-elle tous les transporteurs ? */
  tous: boolean;
  /** Celles qui tiennent la promesse du mode payé d'abord (`conforme`). */
  methodes: {
    code: string;
    nom: string;
    transporteur: string;
    prixCents: number | null;
    conforme: boolean;
    /** Ce qui l'éloigne du mode payé, en clair. */
    ecart: string | null;
    duTransporteurPaye: boolean;
  }[];
  /** Combien de services d'autres transporteurs la liste courte laisse de côté. */
  autresServices: number;
  erreurMethodes: string | null;
}
