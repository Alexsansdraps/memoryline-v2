/**
 * Polices proposées au client pour le titre et le sous-titre de l'affiche.
 *
 * Liste PARTAGÉE, et c'est le point important : le configurateur (navigateur)
 * et le générateur de PDF (serveur) doivent nommer la même police, sinon
 * l'affiche imprimée ne ressemble pas à celle que le client a validée.
 *
 * Chaque `famille` doit donc exister aux deux endroits :
 *   - navigateur : @font-face dans apps/web/src/styles/global.css ;
 *   - serveur    : fichier .ttf dans apps/api/fonts/, installé par les
 *                  Dockerfiles et retrouvé par fontconfig sous ce même nom.
 *
 * Toutes sont sous licence OFL, donc redistribuables avec le projet.
 */

export interface PoliceAffiche {
  /** Identifiant stocké dans la config d'affiche (jamais traduit). */
  id: string;
  /** Nom montré au client. */
  libelle: string;
  /** Famille CSS — identique côté navigateur et côté fontconfig. */
  famille: string;
  /** Repli si la police n'est pas disponible. */
  repli: string;
}

export const POLICES_AFFICHE: readonly PoliceAffiche[] = [
  {
    id: "serif",
    libelle: "Classique",
    famille: "DM Serif Display",
    repli: "Georgia, serif",
  },
  {
    id: "caveat",
    libelle: "Manuscrite",
    famille: "Caveat",
    repli: "cursive",
  },
  {
    id: "dancing",
    libelle: "Anglaise",
    famille: "Dancing Script",
    repli: "cursive",
  },
  {
    id: "greatvibes",
    libelle: "Calligraphie",
    famille: "Great Vibes",
    repli: "cursive",
  },
  {
    id: "parisienne",
    libelle: "Parisienne",
    famille: "Parisienne",
    repli: "cursive",
  },
  {
    id: "sacramento",
    libelle: "Fine",
    famille: "Sacramento",
    repli: "cursive",
  },
  {
    id: "pinyon",
    libelle: "Gravée",
    famille: "Pinyon Script",
    repli: "cursive",
  },
] as const;

/** Police par défaut du TITRE (charte Memory Line). */
export const POLICE_TITRE_DEFAUT = "serif";
/** Police par défaut du SOUS-TITRE (choix cliente). */
export const POLICE_SOUSTITRE_DEFAUT = "parisienne";

/** Retrouve une police par son id ; repli sur `defaut` si l'id est inconnu. */
export function policeParId(
  id: string | null | undefined,
  defaut: string,
): PoliceAffiche {
  return (
    POLICES_AFFICHE.find((p) => p.id === id) ??
    POLICES_AFFICHE.find((p) => p.id === defaut) ??
    POLICES_AFFICHE[0]!
  );
}

/** Valeur `font-family` complète, prête pour du CSS ou un attribut SVG. */
export function familleCss(police: PoliceAffiche): string {
  return `'${police.famille}', ${police.repli}`;
}
