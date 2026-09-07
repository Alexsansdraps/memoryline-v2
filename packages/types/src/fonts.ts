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

/**
 * Repli commun. Surtout PAS `cursive` : sous Windows, le navigateur y répond
 * par Comic Sans MS. Si une police calligraphique ne se charge pas, on préfère
 * un serif élégant — et les fichiers étant servis par le site lui-même, le
 * repli ne devrait jamais servir.
 */
const REPLI_SUR = "'DM Serif Display', Georgia, 'Times New Roman', serif";

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
    repli: REPLI_SUR,
  },
  {
    id: "dancing",
    libelle: "Anglaise",
    famille: "Dancing Script",
    repli: REPLI_SUR,
  },
  {
    id: "greatvibes",
    libelle: "Calligraphie",
    famille: "Great Vibes",
    repli: REPLI_SUR,
  },
  {
    id: "parisienne",
    libelle: "Parisienne",
    famille: "Parisienne",
    repli: REPLI_SUR,
  },
  {
    id: "sacramento",
    libelle: "Fine",
    famille: "Sacramento",
    repli: REPLI_SUR,
  },
  {
    id: "pinyon",
    libelle: "Gravée",
    famille: "Pinyon Script",
    repli: REPLI_SUR,
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
