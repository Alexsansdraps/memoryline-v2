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
  champTitre: string;
  champSousTitre: string;
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
}

export const MESSAGES_DEFAUT: MessagesConfigurateur = {
  titre: "Composez votre affiche",
  etapeFond: "Fond & texte",
  etapePersonnages: "Personnages",
  etapeFormat: "Format",
  champTitre: "Titre (symboles et chiffres autorisés)",
  champSousTitre: "Sous-titre (symboles et chiffres autorisés)",
  couleurTexte: "Couleur du texte (titre & sous-titre)",
  choisirFond: "Choisir un fond",
  personnages: "Personnages",
  nouveauPersonnage: "+ Nouveau personnage",
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
};

/** Complète un dictionnaire partiel par les valeurs françaises. */
export function messagesAvecDefauts(
  partiel?: Partial<MessagesConfigurateur>,
): MessagesConfigurateur {
  return { ...MESSAGES_DEFAUT, ...(partiel ?? {}) };
}
