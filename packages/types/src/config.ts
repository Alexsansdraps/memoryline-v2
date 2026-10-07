import { z } from "zod";

/**
 * Snapshot sérialisable de la personnalisation d'une affiche.
 * = `order_item.config`.
 *
 * Ce schéma est la cible "propre". L'historique Shopify (Line: Properties)
 * utilise une forme proche mais différente (clés `character_1`, `typeId`,
 * `assets.{clothes,pants,hair,head}`, couleurs en `colors.{skin,hair,...}`) ;
 * le script d'import transforme l'ancien format vers celui-ci.
 */

export const POSTER_FORMATS = ["A4", "A3"] as const;
export type PosterFormat = (typeof POSTER_FORMATS)[number];

/** Sens de la feuille : « portrait » (en hauteur) ou « paysage » (en largeur). */
export const POSTER_ORIENTATIONS = ["portrait", "paysage"] as const;
export type PosterOrientation = (typeof POSTER_ORIENTATIONS)[number];

/**
 * Type d'affiche : « de face », « de dos », et ceux que la cliente crée au
 * back-office (table `poster_view`).
 *
 * Ces deux-là restent nommés ici parce qu'ils servent de valeur par défaut et
 * de repli, mais la liste n'est plus fermée : une configuration porte le
 * `slug` du type, quel qu'il soit.
 */
export const POSTER_VIEWS = ["front", "back"] as const;
export type PosterView = (typeof POSTER_VIEWS)[number];
/** Type d'affiche par défaut quand rien n'est précisé. */
export const POSTER_VIEW_DEFAUT = "front";

/**
 * L'ordre d'empilement des pièces sur un personnage, du bas vers le haut.
 *
 * Une seule liste, et elle est ici. Il y en avait deux : celle de l'aperçu et
 * celle de l'impression, portant le même commentaire et des valeurs inversées
 * sur le pantalon et le vêtement. À la taille, là où les deux se recouvrent,
 * l'affiche livrée ne ressemblait donc pas à celle que la cliente avait
 * validée — un défaut qu'aucun écran ne montre, et qui ne se découvre qu'en
 * ouvrant l'enveloppe.
 *
 * C'est l'APERÇU qui fait foi : c'est lui que la cliente regarde avant de
 * payer. Le vêtement passe donc par-dessus le pantalon, ici comme à l'écran.
 *
 * « shoes » et « head » ne sont pas proposés par le configurateur d'
 * aujourd'hui ; ils restent dans la liste parce que des personnages importés
 * en portent, et qu'ils doivent s'empiler quelque part.
 */
export const ORDRE_CALQUES = [
  "pants",
  "clothes",
  "shoes",
  "hair",
  "head",
  "accessory",
] as const;

/** Slots d'assets empilables sur un personnage (ouvert, pas figé). */
export const ASSET_SLOTS = [
  "head",
  "hair",
  "clothes",
  "pants",
  "shoes",
  "accessory",
] as const;
export type AssetSlot = (typeof ASSET_SLOTS)[number];

/**
 * Cadrage des VIGNETTES de pièces, exprimé dans le repère du personnage
 * (viewBox 500×1000). Une coupe de cheveux ou un accessoire n'occupe qu'une
 * petite zone de ce cadre : affichée en entier, la pièce apparaît minuscule
 * dans un coin. On recadre donc sur sa zone utile.
 *
 * Défini ici, dans les types partagés, pour que le configurateur ET le
 * back-office cadrent les vignettes de la même façon.
 */
export const SLOT_THUMB_VIEWBOX: Record<AssetSlot, string> = {
  head: "50 0 400 400",
  hair: "50 50 400 400",
  clothes: "-50 275 600 1000",
  pants: "50 575 400 350",
  shoes: "50 800 400 200",
  accessory: "50 0 400 400",
};

export const textBlockSchema = z.object({
  value: z.string(),
  font: z.string().optional(),
  color: z.string().optional(),
  /** Facteur de taille relatif (1 = défaut). Partagé titre/sous-titre. */
  size: z.number().optional(),
  /**
   * Position du CENTRE de la ligne, en fractions de la largeur et de la
   * hauteur de l'affiche (0..1). Absente, la ligne suit la mise en page
   * automatique : empilée en haut, centrée. Elle n'apparaît que lorsque le
   * client a déplacé la ligne à la main — et alors l'aperçu et le PDF la
   * posent au même endroit, puisque c'est le même chiffre.
   */
  x: z.number().min(0).max(1).optional(),
  y: z.number().min(0).max(1).optional(),
});
export type TextBlock = z.infer<typeof textBlockSchema>;

export const characterSchema = z.object({
  /** Type de personnage (couple/enfant/animal…) — référence ouverte. */
  typeId: z.union([z.string(), z.number()]),
  /**
   * Ordre de DESSIN : 0 est dessiné en premier, donc derrière les autres. Ce
   * n'est pas toujours le rang dans la liste (l'ordre du tableau) : sur une
   * affiche de face, les petits passent devant les grands quel que soit leur
   * rang (voir composition-personnages.ts). Le fichier d'impression et le
   * panier empilent dans cet ordre.
   */
  position: z.number().int().nonnegative().default(0),
  /** Positions normalisées 0..1 (indépendantes du format), optionnelles. */
  x: z.number().optional(),
  y: z.number().optional(),
  scale: z.number().optional(),
  /**
   * Le client a posé ce personnage lui-même, `x`/`y` sont SON choix.
   *
   * Absent, `x`/`y` ne sont que la trace du rangement automatique du jour où
   * la configuration a été enregistrée : les rouvrir comme un choix figerait
   * la rangée des paniers et des commandes d'avant le glisser-déposer, qui
   * doivent continuer à se ranger toutes seules.
   */
  placementManuel: z.boolean().optional(),
  /** Asset choisi par slot : slot -> assetId. */
  assets: z.record(z.string(), z.union([z.string(), z.number()])),
  /** Couleurs personnalisées : zone -> couleur hex. */
  colors: z.record(z.string(), z.string()).optional(),
});
export type Character = z.infer<typeof characterSchema>;

export const posterConfigSchema = z.object({
  schemaVersion: z.literal(1),
  productId: z.union([z.string(), z.number()]).optional(),
  backgroundId: z.union([z.string(), z.number()]).optional(),
  /** URL du fond (legacy: référence directe au SVG Shopify). */
  backgroundUrl: z.string().optional(),
  /** URL du décor d'avant-plan (muret/banc…), rendu au 1er plan. */
  foregroundUrl: z.string().optional(),
  format: z.enum(POSTER_FORMATS).optional(),
  /**
   * Sens de la feuille. Absent = portrait : c'est le sens de toutes les
   * affiches d'avant ce champ, et leur réimpression ne doit pas bouger.
   * Seule l'affiche IA le propose, au choix du client.
   */
  orientation: z.enum(POSTER_ORIENTATIONS).optional(),
  /**
   * Cadre choisi en option — identifiant de la table `frame`, ou absent si le
   * client n'en veut pas. Le PRIX n'est pas stocké ici : il est relu côté
   * serveur au moment de facturer, comme celui de l'affiche.
   */
  frameId: z.union([z.string(), z.number()]).nullish(),
  // Chaîne libre, et non plus une paire figée : refuser un type créé au
  // back-office ferait échouer l'ajout au panier pour un produit tout neuf.
  view: z.string().min(1).default(POSTER_VIEW_DEFAUT),
  /**
   * Génération IA retenue par le client — `publicId` de la table
   * `ai_generation`. Présent, il fait de la ligne une affiche IA : le visuel
   * n'est plus la pile de calques mais l'image produite, et c'est par cet
   * identifiant que le serveur retrouve le fichier sans filigrane à imprimer
   * une fois la commande payée.
   */
  aiPublicId: z.string().optional(),
  /** Aperçu FILIGRANÉ de cette génération, pour la vignette du panier. */
  aiApercuUrl: z.string().optional(),
  /**
   * Textes de l'affiche : TROIS LIGNES, sans hiérarchie imposée.
   *
   * `title` et `subtitle` restent acceptés en LECTURE : les commandes déjà
   * passées les portent, et une commande ne se réécrit pas. Le rendu passe
   * toujours par `lignesDuTexte()` (textes-affiche.ts), qui sait lire les deux
   * formes — c'est ce qui garantit qu'une affiche de l'an dernier sort encore
   * de l'imprimante telle qu'elle a été validée.
   */
  texts: z.object({
    lines: z.array(textBlockSchema).max(3).optional(),
    title: textBlockSchema.optional(),
    subtitle: textBlockSchema.optional(),
  }),
  characters: z.array(characterSchema).default([]),
});
export type PosterConfig = z.infer<typeof posterConfigSchema>;

export const CURRENT_CONFIG_VERSION = 1 as const;

/**
 * La ligne porte-t-elle sa propre composition ?
 *
 * C'est la question qui décide du chemin d'impression : une ligne composée
 * (un fond, des personnages, ou une image générée) passe par le moteur, qui
 * la SIGNE en dernière couche ; une affiche vendue telle quelle s'imprime
 * depuis le visuel de sa fiche, sans rien poser dessus.
 *
 * C'est elle que lit le fichier d'impression (apps/api/src/
 * fichiers-impression.ts, planDImpression). Elle a vécu en deux exemplaires,
 * l'un ici pour les aperçus de la boutique — qui posaient la signature là où
 * l'impression la posait —, l'autre recopié dans l'API. Les aperçus ne
 * signent plus (la signature est réservée au papier), mais la règle reste
 * ici, en un seul exemplaire.
 */
export function afficheComposee(config: PosterConfig | null | undefined): boolean {
  if (!config) return false;
  return (
    Boolean(config.aiPublicId || config.backgroundUrl) ||
    (config.backgroundId != null && config.backgroundId !== "") ||
    (config.characters?.length ?? 0) > 0
  );
}
