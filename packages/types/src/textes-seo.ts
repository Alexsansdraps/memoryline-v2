/**
 * Les textes que Google lit et affiche : le titre de l'onglet, la description
 * sous le lien, et ce qu'on en retire avant de les écrire.
 *
 * Chaque page les composait à sa façon : « VIEUX MOULIN | Memory Line » sur la
 * fiche, « Villes — Memory Line » sur le rayon, une description coupée à cent
 * soixante caractères en plein mot (« …ce lieu paisibl »), avec ses sauts de
 * ligne. Écrites une fois ici, les règles sont les mêmes partout : un seul
 * séparateur avant la marque, des descriptions qui s'arrêtent à la fin d'une
 * phrase ou d'un mot, du texte brut sans balise ni retour à la ligne.
 *
 * Rien ici ne lit l'API : ce sont des fonctions sur des chaînes, que la fiche,
 * le rayon, l'accueil et les pages libres appellent avec ce qu'elles ont déjà.
 */

export const MARQUE = "Memory Line";

/**
 * Au-delà, Google coupe le titre (il en montre une soixantaine de caractères,
 * un peu moins en capitales). La marque est alors ce qu'on sacrifie : le nom
 * du lieu et la nature de l'affiche sont ce que la cliente a cherché, et
 * Google affiche de toute façon le nom du site au-dessus du résultat.
 */
export const TITRE_MAX = 60;

/**
 * La longueur d'une description que Google montre en entier sur ordinateur.
 * Au-delà, il la coupe lui-même, n'importe où.
 */
export const DESCRIPTION_MAX = 155;

/**
 * Le titre d'une page : ses morceaux reliés par un tiret demi-cadratin, puis
 * la marque après une barre — « Villes – Affiches personnalisées | Memory
 * Line ». C'est le séparateur du site ENTIER : la fiche avait une barre, les
 * rayons et les autres pages un tiret long, et le résultat Google changeait
 * d'allure d'une page à l'autre.
 *
 * Trop long, le titre perd la marque plutôt que la fin de son nom.
 */
export function titreDePage(...morceaux: (string | null | undefined | false)[]): string {
  const corps = morceaux
    .filter((m): m is string => typeof m === "string")
    .map((m) => m.trim())
    .filter(Boolean)
    .join(" – ");
  if (!corps) return MARQUE;
  const complet = `${corps} | ${MARQUE}`;
  return complet.length <= TITRE_MAX ? complet : corps;
}

/**
 * Un titre écrit à la main (champ « Titre SEO » du back-office), avec le
 * séparateur du site devant la marque.
 *
 * Le texte de la boutique passe toujours en premier ; seule la fin
 * « — Memory Line » (ou « - », « – ») devient « | Memory Line », pour que
 * ses pages ne se distinguent pas des autres dans les résultats. Les pages
 * légales ont été saisies ainsi, avant que le séparateur soit fixé.
 *
 * Les titres repris de Shopify (« LE HAVRE - Affiche personnalisée – Memory
 * Line ») suivent aussi les deux autres règles du site : le tiret court entre
 * le nom et la nature devient le tiret demi-cadratin de titreDePage, et un
 * titre trop long perd la marque, comme les titres composés par le site.
 * Sans cela, l'import du fichier SEO de Shopify aurait fait passer 43 titres
 * au-delà de 60 caractères (AUDIT-SEO.md, CNT-2).
 */
export function separateurDuSite(titre: string): string {
  const marque = ` | ${MARQUE}`;
  const titreDuSite = titre
    .trim()
    .replace(/\s+[-–—]\s+Memory Line\s*$/i, marque)
    // Un tiret entouré d'espaces sépare deux morceaux ; celui d'un nom de
    // lieu (« MERS-LES-BAINS ») n'en a pas, et reste.
    .replace(/\s+-\s+/g, " – ");
  return titreDuSite.length > TITRE_MAX && titreDuSite.endsWith(marque)
    ? titreDuSite.slice(0, -marque.length)
    : titreDuSite;
}

/**
 * Le nom dit-il déjà que c'est une affiche ?
 *
 * « Affiche à partir de votre photo » n'a pas à devenir « Affiche à partir de
 * votre photo – Affiche personnalisée ». Le mot est cherché dans les cinq
 * langues du site, puisque le nom arrive traduit.
 */
export function nommeDejaUneAffiche(nom: string): boolean {
  return /\b(affiches?|posters?|l[aá]minas?)\b/i.test(nom);
}

/** Les entités HTML qu'un texte de fiche peut porter, et leur caractère. */
const ENTITES: Record<string, string> = {
  nbsp: " ",
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  rsquo: "’",
  lsquo: "‘",
  laquo: "«",
  raquo: "»",
  hellip: "…",
  ndash: "–",
  mdash: "—",
};

/**
 * Le texte qu'on lit dans un morceau de HTML : balises retirées, entités
 * décodées, blancs et retours à la ligne ramenés à une espace.
 *
 * Ce n'est pas un nettoyeur de sécurité — le texte finit dans un attribut ou
 * dans du JSON, qu'Astro et `jsonPourScript` échappent eux-mêmes. C'est ce
 * qui empêche une description de commencer par un retour à la ligne (dix-huit
 * fiches le faisaient) ou de garder un « <br> » au milieu d'une phrase.
 */
export function texteBrut(html: string | null | undefined): string {
  if (!html) return "";
  return String(html)
    .replace(/<(br|\/p|\/li|\/h[1-6]|\/div)\b[^>]*>/gi, " ")
    .replace(/<[^>]*>/g, "")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (tout, code: string) => {
      if (code[0] === "#") {
        const n = code[1] === "x" || code[1] === "X" ? parseInt(code.slice(2), 16) : Number(code.slice(1));
        return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : tout;
      }
      return ENTITES[code.toLowerCase()] ?? tout;
    })
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Une description de résultat Google, à partir d'un texte quelconque.
 *
 * Elle tient en `max` caractères et s'arrête proprement : à la fin de la
 * dernière phrase qui y tient, si elle en couvre l'essentiel ; sinon à la fin
 * du dernier mot entier, suivie de « … ». Jamais au milieu d'un mot.
 */
export function descriptionMeta(texte: string | null | undefined, max = DESCRIPTION_MAX): string {
  const t = texteBrut(texte);
  if (t.length <= max) return t;
  // La dernière fin de phrase qui tient dans la limite. Plus courte que les
  // deux tiers, elle laisserait un résultat maigre : on préfère alors couper
  // au mot, avec des points de suspension.
  let finPhrase = -1;
  for (const m of t.slice(0, max + 1).matchAll(/[.!?…](?=\s|$)/g))
    if (m.index! < max) finPhrase = m.index!;
  if (finPhrase >= max * 0.66) return t.slice(0, finPhrase + 1);
  const coupe = t.slice(0, max); // un caractère de réserve pour « … »
  const espace = coupe.lastIndexOf(" ");
  const debut = espace > max * 0.5 ? coupe.slice(0, espace) : coupe.slice(0, max - 1);
  return debut.replace(/[\s,;:–—-]+$/, "") + "…";
}

/**
 * La ligne « Phrase SEO : … » laissée au bout de quarante-quatre descriptions
 * importées de Shopify.
 *
 * C'était la note de travail de la boutique — une suite de mots-clés, « AULT
 * Falaises - affiche personnalisée, poster personnalisé, souvenir de vacances,
 * idée cadeau… » —, restée dans le texte de la fiche et affichée telle quelle
 * aux clientes, ici comme sur memoryline.fr. Elle est toujours en fin de
 * texte, après un saut de ligne (`<br>`), et ne contient aucune balise.
 *
 * Son intitulé est aussi reconnu traduit (« SEO phrase », « SEO-Satz »,
 * « Frase SEO ») : le bouton de traduction du back-office traduit la
 * description entière, ligne de travail comprise, et la remettrait sinon
 * sous les yeux des clientes de /en ou /de.
 */
const PHRASE_SEO =
  /(?:<br\s*\/?>\s*)?(?:Phrase SEO|SEO[\s-]?(?:phrase|sentence|Satz)|Frase SEO)\s*:\s*([^<]*)/gi;

/**
 * La description sans sa ligne « Phrase SEO : … ».
 *
 * Le texte de la base n'est pas touché : c'est l'affichage qui l'omet. La
 * boutique peut la retirer elle-même (modification en masse des produits),
 * de préférence après l'avoir recopiée dans le champ « Description SEO ».
 */
export function sansPhraseSeo(html: string | null | undefined): string {
  return (html ?? "").replace(PHRASE_SEO, "");
}

/**
 * Le contenu de la ligne « Phrase SEO : … », s'il y en a une.
 *
 * Elle ne s'affiche plus, mais elle est précieuse : c'est, à quelques mots
 * près, la description que memoryline.fr donne aujourd'hui à Google pour ces
 * fiches (« AULT Falaises : affiche personnalisée, poster décoratif et
 * souvenir de vacances… »). La reprendre garde au résultat Google le texte
 * qu'il a déjà, au moment où l'adresse change.
 */
export function phraseSeo(html: string | null | undefined): string | null {
  const m = new RegExp(PHRASE_SEO.source, "i").exec(html ?? "");
  const texte = m ? texteBrut(m[1]) : "";
  return texte || null;
}

/** Le nom court d'une fiche : sans la fin « - Affiche personnalisée » que portent les noms importés. */
export function nomCourtDeFiche(nom: string): string {
  return nom.replace(/\s*[-–]\s*Affiche.*$/i, "");
}

/** Ce qu'une fiche porte de quoi composer son titre et sa description pour Google. */
export interface FichePourReferencement {
  name: string;
  kind: string;
  description?: string | null;
  seoTitle?: string | null;
  seoDescription?: string | null;
  aiEnabled?: boolean | null;
}

/** Les phrases du site que le référencement d'une fiche reprend, dans la langue de la page. */
export interface TextesReferencement {
  /** « Affiche personnalisée » (seo.nature.personnalisable). */
  naturePersonnalisable: string;
  /** « Affiche prête à imprimer » (seo.nature.prete_a_imprimer). */
  naturePrete: string;
  /** La phrase de repli d'une affiche personnalisable, avec « {nom} » (produit.meta_repli.personnalisable). */
  reprisPersonnalisable: string;
  /** La même pour une prête à imprimer (produit.meta_repli.prete_a_imprimer). */
  reprisPrete: string;
  /** La phrase de l'affiche tirée d'une photo (ia.intro). */
  introIa: string;
}

/**
 * Ces phrases en français, telles que le dictionnaire du site les écrit
 * (apps/web/src/i18n/ui.ts, mêmes clés). Le back-office s'en sert pour son
 * aperçu Google ; un essai (apps/api/tests/textes-seo.test.ts) vérifie
 * qu'elles restent identiques à celles du site.
 */
export const TEXTES_REFERENCEMENT_FR: TextesReferencement = {
  naturePersonnalisable: "Affiche personnalisée",
  naturePrete: "Affiche prête à imprimer",
  reprisPersonnalisable:
    "{nom} : affiche personnalisée à composer en ligne. Ajoutez vos personnages et votre texte en quelques minutes. Impression en A4 ou A3.",
  reprisPrete:
    "{nom} : affiche décorative prête à imprimer, à accrocher chez soi ou à offrir. Impression en A4 ou A3.",
  introIa:
    "Envoyez une photo : nous en tirons une affiche. Regardez le résultat, relancez autant de fois que vous voulez, et gardez celle qui vous plaît.",
};

/**
 * Le titre et la description qu'une fiche donne à Google.
 *
 * UNE seule recette, pour la fiche du site et pour l'aperçu Google de sa page
 * au back-office : l'aperçu affichait « nom | Memory Line » et les 160
 * premiers caractères du texte brut, quand le site publiait autre chose — un
 * aperçu qui ment (AUDIT-SEO.md, CNT-3).
 *
 * Le titre : celui que la boutique a écrit, au séparateur du site
 * (separateurDuSite) ; sinon « NOM – Affiche personnalisée | Memory Line »,
 * la marque tombant au-delà de 60 caractères (titreDePage).
 *
 * La description, dans l'ordre :
 * 1. celle que la boutique a écrite, ramenée à 155 caractères au plus ;
 * 2. en français, la « Phrase SEO » retirée de l'affichage (phraseSeo) ;
 * 3. le début du texte de la fiche, s'il est dans la langue de la page ;
 * 4. une phrase de repli, dans la langue de la page.
 *
 * `contexte.francais` : la page est en français ; `contexte.traduite` : le
 * texte de la fiche est écrit dans la langue de la page. `texteAffiche` : le
 * texte que la page montre vraiment, quand elle l'a déjà nettoyé ; sinon il
 * est tiré de la description, « Phrase SEO » retirée.
 */
export function referencementDeFiche(
  fiche: FichePourReferencement,
  textes: TextesReferencement = TEXTES_REFERENCEMENT_FR,
  contexte: { francais: boolean; traduite: boolean } = { francais: true, traduite: true },
  texteAffiche?: string,
): { nomCourt: string; nature: string | null; nomComplet: string; titre: string; description: string } {
  const nomCourt = nomCourtDeFiche(fiche.name);
  const nature = nommeDejaUneAffiche(nomCourt)
    ? null
    : fiche.kind === "personnalisable"
      ? textes.naturePersonnalisable
      : textes.naturePrete;
  const nomComplet = nature ? `${nomCourt} – ${nature}` : nomCourt;
  const texte = texteAffiche ?? texteBrut(sansPhraseSeo(fiche.description));
  const repli = fiche.aiEnabled
    ? textes.introIa
    : (fiche.kind === "personnalisable" ? textes.reprisPersonnalisable : textes.reprisPrete).replace(
        "{nom}",
        nomCourt,
      );
  const description =
    descriptionMeta(fiche.seoDescription) ||
    (contexte.francais ? descriptionMeta(phraseSeo(fiche.description)) : "") ||
    (contexte.traduite ? descriptionMeta(texte) : "") ||
    descriptionMeta(repli);
  const titre = fiche.seoTitle?.trim()
    ? separateurDuSite(fiche.seoTitle.trim())
    : titreDePage(nomComplet);
  return { nomCourt, nature, nomComplet, titre, description };
}
