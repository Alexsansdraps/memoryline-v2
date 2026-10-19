import { COULEURS_TEXTE_AFFICHE, POLICES_AFFICHE } from "@memoryline/types";

/**
 * Libellés du configurateur, fournis par l'application hôte.
 *
 * Le paquet ne connaît pas les langues du site : il reçoit un dictionnaire
 * déjà traduit. Les valeurs par défaut sont en français, si bien qu'un hôte
 * qui ne passe rien obtient le comportement d'avant.
 */
export interface MessagesConfigurateur {
  titre: string;
  etapeFond: string;
  etapePersonnages: string;
  etapeFormat: string;
  /** Libellé de chaque ligne de texte, dans l'ordre (« Ligne 1 »…). */
  champsLignes: string[];
  /** Exemple montré en filigrane dans chaque champ, dans l'ordre. */
  exemplesLignes: string[];
  /**
   * Le compteur d'exemplaires. Il a quitté le module pour la fiche produit
   * (on décide combien avant de composer, comme pour une affiche prête à
   * imprimer) : ces trois libellés ne sont donc lus par personne
   * aujourd'hui. Ils restent traduits par l'hôte, parce que ce dictionnaire
   * est PARTIEL : une clé laissée de côté retombe sur le français ci-dessous
   * dans les cinq langues, et le jour où le compteur revient — au stand, par
   * exemple — le français reviendrait avec lui, sans que rien ne le signale.
   */
  quantite: string;
  quantiteMoins: string;
  quantitePlus: string;
  couleurTexte: string;
  choisirFond: string;
  personnages: string;
  nouveauPersonnage: string;
  modifier: string;
  retirer: string;
  monter: string;
  descendre: string;
  retour: string;
  continuer: string;
  validerAffiche: string;
  validerPersonnage: string;
  personnalisation: string;
  choixPersonnage: string;
  choixCouleur: string;
  vetements: string;
  pantalon: string;
  coupes: string;
  accessoires: string;
  aucun: string;
  cadre: string;
  sansCadre: string;
  /** Sur la poignée de chaque ligne : dit ce que le geste fait. */
  reordonnerAide: string;
  /** Sur l'icône de copie d'un personnage. */
  dupliquer: string;
  /** Libellé d'une ligne de texte au-delà de `champsLignes` ; `{n}` = son rang. */
  ligneN: string;
  /**
   * Flèches des listes qui défilent de côté (galeries, catégories, cadres,
   * polices) : infobulle et lecteur d'écran.
   */
  precedent: string;
  suivant: string;
  /** Flèches ˄ ˅ des listes qui défilent de haut en bas (grille des personnages). */
  defilerHaut: string;
  defilerBas: string;
  /** La pastille arc-en-ciel qui ouvre le sélecteur de couleur libre. */
  couleurPerso: string;
  /** Catégorie des personnages qui n'en ont pas au back-office. */
  autres: string;
  /** Personnage absent du catalogue (archivé…) ; `{id}` = son identifiant. */
  personnageN: string;
  /** Nom de repli d'un personnage sur l'aperçu de l'affiche. */
  personnage: string;
  /** Personnage déplaçable sur l'aperçu ; `{nom}` = son nom. */
  deplacerAide: string;
  /** Deuxième ligne d'exemple sur l'affiche, tant qu'aucun texte n'est saisi. */
  exempleAffiche: string;
  /** Aperçu encadré, pour le lecteur d'écran ; `{cadre}` = le nom du cadre. */
  apercuCadre: string;
  /** Le même, pour un cadre sans nom. */
  apercuCadreSansNom: string;
  /**
   * Nom montré de chaque police, par identifiant. L'identifiant reste celui
   * qui est enregistré ; une police absente garde son nom français.
   */
  libellesPolices: Record<string, string>;
  /** Nom montré de chaque couleur de texte, par identifiant (même règle). */
  libellesCouleursTexte: Record<string, string>;
  /**
   * Locale de mise en forme des montants et des dimensions (« fr-FR »,
   * « en-GB »…). Seul l'affichage en dépend, jamais ce qui est enregistré.
   */
  locale: string;
  /**
   * Le titre des réglages d'un personnage (couleurs, vêtements,
   * accessoires), sous la grille des personnages.
   */
  personnaliserPerso: string;
  /**
   * L'invitation à descendre de l'éditeur de personnage, au-dessus de la
   * barre du bas ; `{parties}` = ce qui reste caché dessous, déjà mis en
   * liste à la manière de la langue (« couleurs, vêtements et cheveux »).
   */
  plusBas: string;
  /**
   * Les mots de cette liste, un par partie des réglages, tels qu'ils se
   * lisent au milieu d'une phrase (en minuscules, sauf en allemand).
   */
  partieCouleurs: string;
  partieVetements: string;
  partieCheveux: string;
  partieAccessoires: string;
}

export const MESSAGES_DEFAUT: MessagesConfigurateur = {
  titre: "Composez votre affiche",
  etapeFond: "Fond & texte",
  etapePersonnages: "Personnages",
  etapeFormat: "Format",
  champsLignes: ["Ligne 1", "Ligne 2", "Ligne 3"],
  exemplesLignes: ["MERS-LES-BAINS", "la maison bleue", "été 2019"],
  quantite: "Nombre d'exemplaires",
  quantiteMoins: "Un exemplaire de moins",
  quantitePlus: "Un exemplaire de plus",
  couleurTexte: "Couleur du texte",
  choisirFond: "Choisir un fond",
  personnages: "Personnages",
  nouveauPersonnage: "+ Ajouter un personnage",
  modifier: "Modifier",
  retirer: "Retirer",
  monter: "Monter",
  descendre: "Descendre",
  retour: "Retour",
  continuer: "Continuer",
  validerAffiche: "Valider l'affiche",
  validerPersonnage: "Valider mon personnage",
  personnalisation: "PERSONNALISATION",
  choixPersonnage: "Choix du personnage",
  choixCouleur: "CHOIX DE LA COULEUR",
  vetements: "Vêtements",
  pantalon: "Pantalon",
  coupes: "Coupes de cheveux",
  accessoires: "Accessoires",
  aucun: "Aucun",
  cadre: "Cadre (option)",
  sansCadre: "Sans cadre",
  reordonnerAide: "Glissez pour changer l'ordre des personnages",
  dupliquer: "Dupliquer ce personnage",
  ligneN: "Ligne {n}",
  precedent: "Précédent",
  suivant: "Suivant",
  defilerHaut: "Faire défiler vers le haut",
  defilerBas: "Faire défiler vers le bas",
  couleurPerso: "Couleur personnalisée",
  autres: "Autres",
  personnageN: "Personnage {id}",
  personnage: "Personnage",
  deplacerAide:
    "{nom} : glissez-le pour le déplacer sur l'affiche, ou utilisez les flèches",
  exempleAffiche: "Votre ville, votre histoire",
  apercuCadre: "Aperçu de l'affiche dans un {cadre}",
  apercuCadreSansNom: "Aperçu de l'affiche dans un cadre",
  // Les noms français vivent avec les polices et les couleurs elles-mêmes.
  libellesPolices: Object.fromEntries(
    POLICES_AFFICHE.map((p) => [p.id, p.libelle]),
  ),
  libellesCouleursTexte: Object.fromEntries(
    COULEURS_TEXTE_AFFICHE.map((c) => [c.id, c.libelle]),
  ),
  locale: "fr-FR",
  personnaliserPerso: "Personnaliser ce personnage",
  plusBas: "Plus bas : {parties}",
  partieCouleurs: "couleurs",
  partieVetements: "vêtements",
  partieCheveux: "cheveux",
  partieAccessoires: "accessoires",
};

/** Complète un dictionnaire partiel par les valeurs françaises. */
export function messagesAvecDefauts(
  partiel?: Partial<MessagesConfigurateur>,
): MessagesConfigurateur {
  return { ...MESSAGES_DEFAUT, ...(partiel ?? {}) };
}
