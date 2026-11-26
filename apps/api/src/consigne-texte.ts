/**
 * Ce qui part au modèle d'images : du TEXTE, et non le HTML de l'éditeur
 * (26/11, relecture de « qualité affiches IA pas top »).
 *
 * Les consignes des styles s'écrivent au BO dans l'éditeur mis en forme
 * (EditeurTexte.astro), qui les range en HTML : <p>, <strong>, <ul><li><p>…
 * Elles partaient TELLES QUELLES : le modèle lisait des balises au milieu des
 * phrases, et payait pour (un style de 8 000 caractères en compte près d'un
 * tiers en balises). Elles partent désormais en texte propre : un paragraphe
 * ou un <br> font un retour à la ligne, un élément de liste une ligne « - »
 * (« 1. », « 2. »… dans une liste numérotée), les balises disparaissent, les
 * entités (&amp;, &nbsp;…) redeviennent des caractères, les lignes vides se
 * réduisent à une.
 *
 * Rien ne change en base ni dans l'éditeur : seul ce qui part au modèle — et
 * la copie qu'en garde `ai_generation.prompt` — est converti.
 *
 * Aucun mot perdu ni COLLÉ : « inventé.</p><p>RÉSULTAT » donne deux lignes,
 * jamais « inventé.RÉSULTAT ». Les balises en ligne (<strong>, <em>, <a>…)
 * s'effacent sans rien ajouter : « <strong>Memory Line</strong>. » reste
 * « Memory Line. ». Les blancs suivent la règle du HTML — un retour à la ligne
 * DANS le texte vaut une espace —, c'est ce que l'éditeur montre à Margaux.
 *
 * Un texte sans balise (la consigne générale, saisie dans une zone de texte)
 * n'est pas lu comme du HTML : ses retours à la ligne restent, seuls les
 * « \r\n » deviennent « \n » et les lignes vides en série se réduisent à une.
 */

/** Une balise que l'éditeur, ou un collage, peut produire : de quoi dire « c'est du HTML ». */
const BALISE_HTML =
  /<\/?(?:p|br|div|span|strong|b|em|i|u|s|ul|ol|li|a|h[1-6]|blockquote|pre|hr|table|tr|td|th)\b[^>]*>/i;

/** Les balises qui ouvrent ou ferment un bloc : elles font changer de ligne. */
const BLOCS = new Set([
  "p",
  "div",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "blockquote",
  "pre",
  "hr",
  "table",
  "tr",
  "section",
  "article",
  "header",
  "footer",
  "figure",
  "figcaption",
  "dl",
  "dt",
  "dd",
]);

/** Les entités nommées qu'un collage depuis Word ou une page web peut laisser. */
const ENTITES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  laquo: "«",
  raquo: "»",
  lsquo: "‘",
  rsquo: "’",
  sbquo: "‚",
  ldquo: "“",
  rdquo: "”",
  bdquo: "„",
  hellip: "…",
  ndash: "–",
  mdash: "—",
  middot: "·",
  bull: "•",
  euro: "€",
  pound: "£",
  copy: "©",
  reg: "®",
  trade: "™",
  deg: "°",
  times: "×",
  divide: "÷",
  shy: "",
  zwj: "‍",
  zwnj: "‌",
  agrave: "à",
  aacute: "á",
  acirc: "â",
  auml: "ä",
  ccedil: "ç",
  egrave: "è",
  eacute: "é",
  ecirc: "ê",
  euml: "ë",
  igrave: "ì",
  iacute: "í",
  icirc: "î",
  iuml: "ï",
  ograve: "ò",
  oacute: "ó",
  ocirc: "ô",
  ouml: "ö",
  ugrave: "ù",
  uacute: "ú",
  ucirc: "û",
  uuml: "ü",
  yuml: "ÿ",
  oelig: "œ",
  aelig: "æ",
  Agrave: "À",
  Acirc: "Â",
  Ccedil: "Ç",
  Egrave: "È",
  Eacute: "É",
  Ecirc: "Ê",
  Euml: "Ë",
  Icirc: "Î",
  Iuml: "Ï",
  Ocirc: "Ô",
  Ugrave: "Ù",
  Ucirc: "Û",
  Uuml: "Ü",
  OElig: "Œ",
  AElig: "Æ",
};

/** Les entités d'un morceau de texte, redevenues caractères ; une entité inconnue reste telle quelle. */
function decoderEntites(texte: string): string {
  return texte.replace(/&(#[0-9]+|#x[0-9a-f]+|[a-z][a-z0-9]*);/gi, (tout, nom: string) => {
    if (nom[0] === "#") {
      const code = nom[1] === "x" || nom[1] === "X" ? parseInt(nom.slice(2), 16) : parseInt(nom.slice(1), 10);
      return Number.isInteger(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : tout;
    }
    return ENTITES[nom] ?? tout;
  });
}

/** Les lignes vides en série réduites à une, les blancs de bout de ligne retirés. */
function resserrer(texte: string): string {
  return texte
    .split("\n")
    .map((ligne) => ligne.replace(/[ \t ]+$/, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * La consigne telle qu'elle part au modèle : le HTML de l'éditeur en texte,
 * un texte sans balise à peine retouché (voir l'en-tête). Ne lève jamais.
 */
export function consigneEnTexte(brut: string | null | undefined): string {
  const source = String(brut ?? "").replace(/\r\n?/g, "\n");
  if (!BALISE_HTML.test(source)) return resserrer(source);

  // Ni les commentaires, ni le contenu d'un <script> ou d'un <style> collés
  // depuis une page web ne sont du texte.
  const html = source
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style|template)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "");

  const lignes: string[] = [];
  /** La ligne en cours d'écriture. */
  let courante = "";
  /** Un bloc s'est ouvert ou fermé : le prochain texte commence une ligne. */
  let coupure = false;
  /** Le début d'un élément de liste, posé au premier texte qui le suit. */
  let puce: string | null = null;
  /** Les listes ouvertes, de la plus extérieure à la plus intérieure. */
  const listes: { numerotee: boolean; rang: number }[] = [];

  const finirLaLigne = () => {
    lignes.push(courante);
    courante = "";
  };

  const ecrire = (morceau: string) => {
    let texte = decoderEntites(morceau).replace(/[\s ]+/g, " ");
    if (!texte) return;
    if (coupure || puce !== null) {
      if (courante.trim()) finirLaLigne();
      else courante = "";
      coupure = false;
    }
    if (puce !== null) {
      // Une puce attend du vrai texte : un blanc entre deux balises n'en est pas.
      if (!texte.trim()) return;
      courante = puce;
      puce = null;
    }
    if (!courante.trim()) texte = texte.replace(/^ /, "");
    courante += texte;
  };

  const balise = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)\b[^>]*>/g;
  let fin = 0;
  for (let m = balise.exec(html); m; m = balise.exec(html)) {
    ecrire(html.slice(fin, m.index));
    fin = balise.lastIndex;
    const fermante = m[1] === "/";
    const nom = m[2]!.toLowerCase();
    if (nom === "br") {
      // Un saut de ligne voulu : il marque même une ligne vide.
      if (coupure && courante.trim()) finirLaLigne();
      coupure = false;
      finirLaLigne();
    } else if (nom === "ul" || nom === "ol") {
      if (fermante) listes.pop();
      else {
        const depart = /\bstart\s*=\s*["']?(-?\d+)/i.exec(m[0])?.[1];
        listes.push({ numerotee: nom === "ol", rang: depart ? Number(depart) - 1 : 0 });
      }
      coupure = true;
    } else if (nom === "li") {
      coupure = true;
      if (!fermante) {
        const liste = listes[listes.length - 1];
        const retrait = "  ".repeat(Math.max(0, listes.length - 1));
        puce = retrait + (liste?.numerotee ? `${++liste.rang}. ` : "- ");
      } else puce = null;
    } else if (BLOCS.has(nom)) {
      coupure = true;
    }
    // Les autres balises (strong, em, u, a, span…) s'effacent sans rien
    // ajouter : un blanc à leur place collerait la ponctuation au vide.
  }
  ecrire(html.slice(fin));
  if (courante.trim()) finirLaLigne();

  return resserrer(lignes.map((l) => l.replace(/^ +$/, "")).join("\n"));
}
