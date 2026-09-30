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
};

/** Complète un dictionnaire partiel par les valeurs françaises. */
export function messagesAvecDefauts(
  partiel?: Partial<MessagesConfigurateur>,
): MessagesConfigurateur {
  return { ...MESSAGES_DEFAUT, ...(partiel ?? {}) };
}
