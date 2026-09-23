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
    // La seconde police de la charte : sans empattement, geometrique, faite
    // pour les capitales de la premiere ligne.
    id: "spartan",
    libelle: "Bâton",
    famille: "League Spartan",
    repli: "Helvetica, Arial, sans-serif",
  },
  {
    /*
     * L'écriture manuscrite de la charte.
     *
     * Le nom de famille est écrit EXACTEMENT comme la police se nomme
     * elle-même — « another shabby », en minuscules : c'est ce nom que
     * fontconfig indexe sur le serveur d'impression, et une capitale de plus
     * ferait sortir le PDF dans une police de repli, sans erreur.
     *
     * Licence : Zetafonts, distribution d'essai sous Creative Commons non
     * commerciale, dont le contrat demande une licence complète pour la
     * vente et pour l'incorporation dans un PDF. La boutiquière a été
     * informée et a choisi d'assumer ce point.
     */
    id: "shabby",
    libelle: "Manuscrite",
    famille: "another shabby",
    repli: REPLI_SUR,
  },
  {
    /*
     * Caveat n'est plus proposée nulle part, et reste déclarée exprès :
     * c'était la manuscrite jusqu'ici, des commandes l'ont enregistrée, et
     * leur fichier d'impression doit continuer de sortir en Caveat.
     */
    id: "caveat",
    libelle: "Manuscrite (ancienne)",
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

/*
 * Ce que chaque ligne a le droit de porter.
 *
 * Les identifiants absents d'une ligne restent parfaitement rendables : ils
 * ne sont simplement plus proposés. Voir l'en-tête de ce fichier.
 */
const POLICES_PAR_LIGNE: readonly (readonly string[])[] = [
  ["serif", "spartan"],
  ["shabby"],
  ["serif", "shabby"],
];

/**
 * Ce qu'une police ne sait pas écrire, et qui s'écrit alors dans une autre.
 *
 * « another shabby » est distribuée en version d'essai : ses lettres sont
 * complètes, mais ses CHIFFRES et cinq symboles (€ $ & @ #) sont remplacés par
 * le logo de l'éditeur — un petit rond noir. Une cliente qui écrivait
 * « 24/12/2025 » en sous-titre obtenait huit ronds, à l'écran comme sur le
 * papier, sans que rien ne la prévienne.
 *
 * Ces caractères-là sont donc écrits en Caveat, l'autre manuscrite de la
 * maison, déjà installée des deux côtés. Le jour où la licence complète sera
 * achetée, il suffira de vider cette liste.
 */
const CARACTERES_ABSENTS: Readonly<Record<string, RegExp>> = {
  shabby: /[0-9€$&@#]/,
};

/** La police qui prend le relais sur ces caractères-là. */
const ID_POLICE_DE_SECOURS = "caveat";

/** Un bout de ligne à écrire d'une seule police. */
export interface MorceauDeTexte {
  texte: string;
  police: PoliceAffiche;
}

/**
 * Découpe une ligne en morceaux, chacun avec la police qui sait l'écrire.
 *
 * Un seul morceau dans l'immense majorité des cas : le découpage n'a lieu que
 * pour les caractères listés dans {@link CARACTERES_ABSENTS}. L'écran et
 * l'impression appellent la MÊME fonction — sans quoi l'affiche livrée
 * n'aurait pas les mêmes chiffres que celle validée par la cliente.
 */
export function morceauxDeTexte(
  texte: string,
  police: PoliceAffiche,
): MorceauDeTexte[] {
  const absents = CARACTERES_ABSENTS[police.id];
  const secours = POLICES_AFFICHE.find((p) => p.id === ID_POLICE_DE_SECOURS);
  if (!texte || !absents || !secours || !absents.test(texte))
    return [{ texte, police }];

  const morceaux: MorceauDeTexte[] = [];
  for (const caractere of texte) {
    const voulue = absents.test(caractere) ? secours : police;
    const dernier = morceaux[morceaux.length - 1];
    if (dernier && dernier.police === voulue) dernier.texte += caractere;
    else morceaux.push({ texte: caractere, police: voulue });
  }
  return morceaux;
}

/**
 * Les polices proposées sur une ligne, dans l'ordre d'affichage.
 *
 * Une ligne au-delà de la troisième — il n'y en a pas aujourd'hui — retombe
 * sur les règles de la troisième plutôt que sur rien : un rang inattendu ne
 * doit pas priver la cliente de tout choix.
 */
export function policesDeLaLigne(index: number): readonly PoliceAffiche[] {
  const permis =
    POLICES_PAR_LIGNE[index] ?? POLICES_PAR_LIGNE[POLICES_PAR_LIGNE.length - 1]!;
  return POLICES_AFFICHE.filter((p) => permis.includes(p.id));
}

/**
 * La première ligne s'écrit toujours en capitales.
 *
 * C'est la ligne du lieu — AMIENS, MERS-LES-BAINS — et la charte la veut ainsi
 * sur toutes les affiches du catalogue. On applique la règle à la saisie
 * plutôt qu'à l'affichage : la cliente voit immédiatement ce qui sera imprimé,
 * et le texte enregistré est exactement celui du fichier d'impression.
 */
export function ligneEnMajuscules(index: number): boolean {
  return index === 0;
}

/** Police par défaut du TITRE (charte Memory Line). */
export const POLICE_TITRE_DEFAUT = "serif";
/**
 * Police par défaut des lignes 2 et 3.
 *
 * C'était « parisienne », qui n'est plus proposée sur aucune ligne : une
 * nouvelle affiche serait née avec une police que sa cliente ne pourrait plus
 * rechoisir après en avoir essayé une autre.
 */
export const POLICE_SOUSTITRE_DEFAUT = "shabby";

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

/**
 * URL affichable d'un asset, à partir du chemin stocké dans la configuration.
 *
 * Les configurations enregistrées AVANT ce correctif contiennent déjà le
 * préfixe de l'API (« /api/assets/… ») : le repréfixer donnerait
 * « /api/api/assets/… », et la vignette du panier cassait pour cette raison.
 * On ne préfixe donc que si ce n'est pas déjà fait.
 */
export function urlAsset(base: string, url: string): string {
  if (!url) return url;
  if (/^https?:\/\//i.test(url)) return url;
  const b = (base || "").replace(/\/$/, "");
  if (!b) return url;
  return url.startsWith(b + "/") ? url : b + url;
}
