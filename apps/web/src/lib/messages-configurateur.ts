import type { ConfiguratorProps } from "@memoryline/configurator";
import type { CleUi } from "../i18n/utils.ts";

/**
 * Les libellés du module de personnalisation, dans la langue de la page.
 *
 * Le dictionnaire était écrit dans ConfiguratorIsland.tsx. L'affiche tirée
 * d'une photo ouvre maintenant le même module pour y poser des personnages
 * (PersonnagesIA.tsx, 20/11) : il est déplacé ici TEL QUEL, pour que les deux
 * écrans disent les mêmes mots, et qu'une clé ajoutée un jour le soit pour
 * les deux.
 *
 * `tr` : le traducteur de la page (t(langue)) ; `locale` : la manière d'écrire
 * les montants et les dimensions (LOCALE_COMPLETE[langue]).
 */
export function messagesDuConfigurateur(
  tr: (cle: CleUi) => string,
  locale: string,
): NonNullable<ConfiguratorProps["messages"]> {
  return {
    titre: tr("cfg.titre"),
    etapeFond: tr("cfg.etape.fond"),
    etapePersonnages: tr("cfg.etape.personnages"),
    etapeFormat: tr("cfg.etape.format"),
    champsLignes: [
      tr("cfg.ligne1_champ"),
      tr("cfg.ligne2_champ"),
      tr("cfg.ligne3_champ"),
    ],
    exemplesLignes: [
      tr("cfg.ligne1_exemple"),
      tr("cfg.ligne2_exemple"),
      tr("cfg.ligne3_exemple"),
    ],
    // Le compteur d'exemplaires se tient sur la fiche produit, pas
    // ici : ces trois libellés ne s'affichent donc nulle part
    // aujourd'hui. On les passe quand même, parce que `messages`
    // est un dictionnaire PARTIEL — une clé qu'on oublie retombe
    // sur le français du paquet, dans les cinq langues. Le jour où
    // le module reprend son compteur, rien n'est à traduire.
    quantite: tr("cfg.quantite"),
    quantiteMoins: tr("cfg.quantite_moins"),
    quantitePlus: tr("cfg.quantite_plus"),
    couleurTexte: tr("cfg.couleur_texte"),
    choisirFond: tr("cfg.fond"),
    personnages: tr("cfg.personnages"),
    nouveauPersonnage: tr("cfg.nouveau_perso"),
    modifier: tr("cfg.modifier"),
    retirer: tr("cfg.retirer"),
    monter: tr("cfg.monter"),
    descendre: tr("cfg.descendre"),
    retour: tr("cfg.retour"),
    continuer: tr("cfg.continuer"),
    chargementApercu: tr("cfg.chargement_apercu"),
    validerAffiche: tr("cfg.valider_affiche"),
    validerPersonnage: tr("cfg.valider_perso"),
    personnalisation: tr("cfg.personnalisation"),
    choixPersonnage: tr("cfg.choix_perso"),
    choixCouleur: tr("cfg.choix_couleur"),
    vetements: tr("cfg.vetements"),
    pantalon: tr("cfg.pantalon"),
    coupes: tr("cfg.coupes"),
    accessoires: tr("cfg.accessoires"),
    aucun: tr("cfg.aucun"),
    cadre: tr("cfg.cadre"),
    sansCadre: tr("cfg.sans_cadre"),
    reordonnerAide: tr("cfg.reordonner_aide"),
    dupliquer: tr("cfg.dupliquer"),
    ligneN: tr("cfg.ligne_n"),
    precedent: tr("cfg.precedent"),
    suivant: tr("cfg.suivant"),
    defilerHaut: tr("defiler.haut"),
    defilerBas: tr("defiler.bas"),
    couleurPerso: tr("cfg.couleur_perso"),
    remettreCouleurs: tr("cfg.remettre_couleurs"),
    remettreCouleursDe: tr("cfg.remettre_couleurs_de"),
    couleurActuelle: tr("cfg.couleur_actuelle"),
    autres: tr("cfg.autres"),
    personnageN: tr("cfg.personnage_n"),
    personnage: tr("cfg.personnage"),
    deplacerAide: tr("cfg.deplacer_aide"),
    exempleAffiche: tr("cfg.exemple_affiche"),
    apercuCadre: tr("cfg.apercu_cadre"),
    apercuCadreSansNom: tr("cfg.apercu_cadre_sans_nom"),
    // Seules les polices et couleurs proposées aujourd'hui : une
    // police absente d'ici garde son nom français.
    libellesPolices: {
      serif: tr("cfg.police.serif"),
      abril: tr("cfg.police.abril"),
      shabby: tr("cfg.police.shabby"),
    },
    libellesCouleursTexte: {
      blanc: tr("cfg.couleur.blanc"),
      anthracite: tr("cfg.couleur.anthracite"),
    },
    // Montants et dimensions à la manière de la langue de la page.
    locale,
    personnaliserPerso: tr("cfg.personnaliser_perso"),
    plusBas: tr("cfg.plus_bas"),
    partieCouleurs: tr("cfg.partie.couleurs"),
    partieVetements: tr("cfg.partie.vetements"),
    partieCheveux: tr("cfg.partie.cheveux"),
    partieAccessoires: tr("cfg.partie.accessoires"),
  };
}
