/**
 * Les textes d'un écran du back-office, lus dans son SOURCE (.astro).
 *
 * La recherche du haut doit trouver un écran par ce qui y est écrit — le
 * titre d'une section, le libellé d'un champ, une phrase d'aide — et pas
 * seulement par son nom dans le menu. Ces textes, on ne les recopie nulle
 * part : on les lit dans le fichier de la page, au moment de construire
 * l'index (lib/index-ecrans.ts). Un écran ajouté demain, une section
 * renommée, une aide réécrite sont donc trouvables sans rien écrire d'autre.
 *
 * Pourquoi un petit lecteur maison plutôt que le compilateur d'Astro : ce
 * dernier n'est pas résoluble depuis le BO, et l'ajouter ferait une
 * dépendance de plus pour un besoin modeste. Ce lecteur ne comprend pas tout
 * le langage, il n'en a pas besoin : il sépare le BALISAGE, où le texte est du
 * texte, du CODE des expressions {…}, où seules comptent les chaînes de prose
 * et le balisage imbriqué ({x && (<p>…</p>)}). Une pile de contextes suffit.
 * Il ne lève jamais d'erreur : un morceau mal lu est un morceau de moins dans
 * l'index, pas un back-office en panne.
 *
 * Module PUR : aucun import, ni DOM ni Node. Les tests le chargent tel quel
 * (tests/recherche.test.mjs).
 */

/** Un texte lu dans un écran, rattaché à sa section et à l'ancre la plus proche. */
export interface Morceau {
  texte: string;
  /**
   * « section » : un titre (h1-h4, legend, summary) ; il devient la section
   * courante. « libelle » : ce qui nomme un champ ou un bouton. « aide » : le
   * reste de la prose.
   */
  genre: "section" | "libelle" | "aide";
  /** Le titre de la section où il se trouve ; pour un titre, lui-même. */
  section: string | null;
  /** L'id STATIQUE (id="…") de l'élément englobant le plus proche. */
  ancre: string | null;
  /**
   * « attribut » : un texte qui ne s'AFFICHE pas (title, aria-label, alt).
   * Il aide à trouver l'écran, mais le script d'arrivée, qui ne lit que le
   * texte affiché et la valeur des champs, ne saurait pas l'y retrouver : le
   * résultat mène à l'ancre, sans passage à chercher.
   */
  origine?: "attribut";
}

/* -------------------------------------------------------------------------- */
/*  Les familles de balises                                                   */
/* -------------------------------------------------------------------------- */

/** Les balises sans contenu : elles ne s'empilent pas. */
const VIDES = new Set([
  "input", "br", "img", "hr", "meta", "link", "source", "col", "wbr",
  "area", "base", "embed", "track", "param",
]);

/**
 * Les balises « en ligne » : elles ne coupent pas une phrase. « c'est l'écran
 * <a>Bandeau et offre</a>. » reste un seul morceau. La liste est la même que
 * celle du script d'arrivée (lib/arrivee-recherche.ts), qui relit la page
 * bloc par bloc : un passage pris ici doit s'y retrouver d'un seul tenant.
 */
const EN_LIGNE = new Set([
  "a", "strong", "em", "b", "i", "u", "code", "kbd", "br", "span", "small",
  "abbr", "mark", "sup", "sub",
]);

const SECTIONS = new Set(["h1", "h2", "h3", "h4", "legend", "summary"]);
const LIBELLES = new Set(["label", "th", "button", "option", "a", "dt"]);
const AIDES = new Set(["p", "li", "td", "dd", "figcaption", "blockquote"]);

/** Ce qu'on ne lit pas du tout : du code, ou une valeur de champ. */
const SAUTEES = new Set(["script", "style", "textarea", "pre"]);

/**
 * Les props de composants qui portent du texte AFFICHÉ (« titre » d'un bloc
 * de traductions, « etiquette » d'un éditeur, « aide » sous un champ).
 *
 * Ni « placeholder » ni « invite » (le filigrane d'un éditeur) : ce sont des
 * EXEMPLES — « Dupont », « Salon du livre de Nantes 2026 », « offerte au salon
 * de Vannes » —, pas le contenu de l'écran. Indexés, ils faisaient répondre
 * l'écran des commandes au nom d'une vraie cliente, et menaient à un texte
 * que le script d'arrivée ne trouve pas, puisqu'il ne s'affiche pas.
 */
const ATTRIBUTS_LIBELLES = new Set(["titre", "label", "etiquette"]);
const ATTRIBUTS_AIDES = new Set(["aide", "legende"]);
/**
 * Les attributs HTML lisibles mais NON affichés : l'infobulle, le texte des
 * lecteurs d'écran, celui d'une image. Gardés pour trouver l'écran (« retirer
 * de la liste » est l'infobulle d'un bouton), marqués pour que le lien ne
 * cherche pas à les surligner.
 */
const ATTRIBUTS_CACHES = new Set(["title", "aria-label", "alt"]);

/** Les ids qui ne désignent pas un endroit où l'on peut emmener quelqu'un. */
const SANS_ANCRE = new Set(["template", "datalist", "svg", "dialog", "admin"]);

/**
 * Les éléments qui délimitent une section : quand celui qui contient un
 * titre se ferme, les textes suivants ne sont plus « sous » ce titre. Ni
 * <header> ni <div> : un titre y est souvent emballé seul, et la section
 * continue après eux.
 */
const CONTENEURS = new Set(["section", "article", "details", "fieldset", "form", "aside", "li", "dialog", "main", "nav"]);

/**
 * Les clés de l'entête dont la valeur est un texte de l'écran. Les trois
 * dernières (note, nom, detail) servent aussi à des noms techniques
 * (« nom: "description" ») : leur valeur n'est gardée que si c'est de la
 * prose (estDeLaProse).
 */
const CLES_ENTETE =
  /\b(titre|label|libelle|aide|texte|message|explication|description|question|legende|note|nom|detail)\s*:\s*(?=["'`])/g;
const CLES_A_PROSE = new Set(["note", "nom", "detail"]);

/* -------------------------------------------------------------------------- */
/*  Petits outils                                                             */
/* -------------------------------------------------------------------------- */

const ENTITES: Record<string, string> = {
  nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", laquo: "«",
  raquo: "»", rsquo: "’", lsquo: "‘", ldquo: "“", rdquo: "”", hellip: "…",
  ndash: "–", mdash: "—", eacute: "é", egrave: "è", ecirc: "ê", agrave: "à",
  acirc: "â", ccedil: "ç", ocirc: "ô", ucirc: "û", ugrave: "ù", icirc: "î",
  iuml: "ï", euml: "ë", oelig: "œ", euro: "€", deg: "°", times: "×",
  middot: "·", rarr: "→", larr: "←", darr: "↓", uarr: "↑", thinsp: " ",
  nnbsp: " ",
};

/** Les entités HTML du source, rendues comme le navigateur les affiche. */
function decoderEntites(s: string): string {
  return s.replace(/&(#\d{1,6}|#x[0-9a-f]{1,6}|[a-z]{2,8});/gi, (tout, nom: string) => {
    if (nom[0] === "#") {
      const code = nom[1] === "x" || nom[1] === "X" ? parseInt(nom.slice(2), 16) : parseInt(nom.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : " ";
    }
    return ENTITES[nom.toLowerCase()] ?? tout;
  });
}

/** Le nombre de lettres d'un texte (accentuées comprises). */
function nombreDeLettres(s: string): number {
  const m = s.match(/\p{L}/gu);
  return m ? m.length : 0;
}

/**
 * Remet un morceau au propre : entités, blancs regroupés, et sans les « … »
 * qui tiennent la place d'une expression en tête ou en fin (« {n} commandes »
 * donne « commandes », pas « … commandes »).
 */
function propre(s: string): string {
  let t = decoderEntites(s).replace(/\s+/g, " ").replace(/…(?:\s*…)+/g, "…");
  t = t.replace(/^[\s…·,;]+/, "");
  // trimEnd plutôt qu'une expression /\s+$/ : sur une longue tranche sans
  // espace final, cette dernière devient quadratique.
  while (t.length && /[\s…·,;]/.test(t[t.length - 1]!)) t = t.slice(0, -1).trimEnd();
  return t.trim();
}

/** Une liste de classes CSS (« mt-3 rounded border-bo-border sm:grid-cols-2 »). */
function ressembleAClasses(s: string): boolean {
  const mots = s.trim().split(/\s+/);
  if (!mots.length) return false;
  if (!mots.every((m) => /^!?-?[a-z0-9][a-z0-9:_\-\/.\[\]%#()&>=*,'"@+~]*$/.test(m))) return false;
  return mots.some(
    (m) =>
      /[:\[\]]/.test(m) ||
      /^-?[a-z]+-[a-z0-9.\/%]+/.test(m) ||
      /^(flex|grid|block|inline|hidden|contents|table|rounded|border|underline|truncate|italic|uppercase|lowercase|relative|absolute|fixed|sticky|shadow|grow|shrink|transition|ring|outline|container|visible|invisible|isolate|antialiased)$/.test(m),
  );
}

/** Une adresse ou un chemin, seul : rien à chercher dedans. */
function estUnChemin(s: string): boolean {
  const t = s.trim();
  if (/\s/.test(t)) return false;
  return /^(https?:|mailto:|www\.)/i.test(t) || /^\.{0,2}\/[\w\-./[\]{}…]*$/.test(t);
}

/** Ce qui ne mérite pas d'entrer dans l'index. */
function aJeter(s: string): boolean {
  if (nombreDeLettres(s) < 3) return true;
  if (/=>|===|!==|&&|\.map\(|\$\{|import\.meta/.test(s)) return true;
  if (estUnChemin(s)) return true;
  if (ressembleAClasses(s)) return true;
  return false;
}

/**
 * Une chaîne d'une expression {…} est-elle de la prose (« Enregistré. ») ou
 * du code (une classe, une clé, un nom d'action) ? Il faut de quoi lire :
 * plusieurs mots, ou un seul mot écrit comme un mot français (« Archivée »).
 */
function estDeLaProse(v: string): boolean {
  const t = v.trim();
  if (nombreDeLettres(t) < 3) return false;
  if (/^\s*(return|const|let|var|function)\b|\bconfirm\(|\bdocument\./.test(t)) return false;
  if (/\s/.test(t)) return /[A-ZÀ-Ý]|[àâäçéèêëîïôöûùüÿœ.!?«»’'…:]/.test(t) || nombreDeLettres(t) >= 8;
  return /^[A-ZÀ-Ý][a-zà-ÿœ’']{3,}[.!?…]?$/.test(t);
}

/**
 * Lit une chaîne JS à partir de i (le guillemet). Rend [contenu, fin]. Un
 * gabarit `…${x}…` rend « … » à la place de chaque expression.
 */
function lireChaine(src: string, i: number): [string, number] {
  const q = src[i];
  let j = i + 1;
  let v = "";
  while (j < src.length && src[j] !== q) {
    const c = src[j]!;
    if (c === "\\") {
      const suivant = src[j + 1] ?? "";
      v += suivant === "n" || suivant === "t" ? " " : suivant;
      j += 2;
      continue;
    }
    if (q === "`" && c === "$" && src[j + 1] === "{") {
      let profondeur = 1;
      j += 2;
      while (j < src.length && profondeur > 0) {
        const d = src[j];
        if (d === '"' || d === "'" || d === "`") {
          j = lireChaine(src, j)[1];
          continue;
        }
        if (d === "{") profondeur++;
        else if (d === "}") profondeur--;
        j++;
      }
      v += "…";
      continue;
    }
    // Une chaîne simple ne passe pas la ligne : un guillemet orphelin (une
    // apostrophe dans du texte pris pour du code) ne doit pas avaler le reste
    // du fichier.
    if ((q === '"' || q === "'") && c === "\n") return [v, j];
    v += c;
    j++;
  }
  return [v, j + 1];
}

interface Balise {
  fin: number;
  nom: string;
  fermante: boolean;
  auto: boolean;
  brut: string;
}

/** Lit une balise ouvrante ou fermante à partir de i (le « < »). */
function lireBalise(src: string, i: number): Balise {
  let j = i + 1;
  let profondeur = 0;
  while (j < src.length) {
    const d = src[j];
    if (profondeur > 0) {
      if (d === '"' || d === "'" || d === "`") {
        j = lireChaine(src, j)[1];
        continue;
      }
      if (d === "{") profondeur++;
      else if (d === "}") profondeur--;
    } else if (d === "{") profondeur++;
    else if (d === '"' || d === "'") {
      const f = src.indexOf(d, j + 1);
      j = f === -1 ? src.length : f + 1;
      continue;
    } else if (d === ">") break;
    j++;
  }
  const brut = src.slice(i, j + 1);
  const m = /^<(\/)?\s*([A-Za-z][\w.:-]*)?/.exec(brut);
  return {
    fin: j + 1,
    // « » : le fragment <>…</> ; il s'empile sous ce nom pour se refermer.
    nom: m?.[2] ?? "#fragment",
    fermante: !!m?.[1],
    auto: /\/\s*>$/.test(brut),
    brut,
  };
}

interface Attribut {
  nom: string;
  valeur?: string;
  expression?: string;
}

function lireAttributs(brut: string): Attribut[] {
  const res: Attribut[] = [];
  const re = /([A-Za-z_:@][-\w:.]*)\s*=\s*("([^"]*)"|'([^']*)'|\{)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(brut))) {
    if (m[2] === "{") {
      let j = m.index + m[0].length;
      const debut = j;
      let profondeur = 1;
      while (j < brut.length && profondeur > 0) {
        const c = brut[j];
        if (c === '"' || c === "'" || c === "`") {
          j = lireChaine(brut, j)[1];
          continue;
        }
        if (c === "{") profondeur++;
        else if (c === "}") profondeur--;
        j++;
      }
      res.push({ nom: m[1]!, expression: brut.slice(debut, j - 1) });
      re.lastIndex = j;
    } else res.push({ nom: m[1]!, valeur: m[3] ?? m[4] ?? "" });
  }
  return res;
}

/** Les chaînes de prose d'une expression ({ok ? "Enregistré." : "Erreur"}). */
function chainesDeProse(expression: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < expression.length; i++) {
    const c = expression[i];
    if (c === '"' || c === "'" || c === "`") {
      const [v, f] = lireChaine(expression, i);
      if (estDeLaProse(v)) out.push(v);
      i = f - 1;
    }
  }
  return out;
}

/** Sépare l'entête (---…---) du gabarit. */
function couper(source: string): { entete: string; gabarit: string } {
  const m = /^﻿?\s*---[ \t]*\r?\n/.exec(source);
  if (!m) return { entete: "", gabarit: source };
  const fin = /\r?\n---[ \t]*(\r?\n|$)/g;
  fin.lastIndex = m[0].length - 1;
  const f = fin.exec(source);
  if (!f) return { entete: "", gabarit: source };
  return {
    entete: source.slice(m[0].length, f.index),
    gabarit: source.slice(f.index + f[0].length),
  };
}

/* -------------------------------------------------------------------------- */
/*  Le parcours du gabarit                                                    */
/* -------------------------------------------------------------------------- */

/** Un morceau tel que le lecteur le produit, avec ce qu'en veulent les rubriques. */
interface MorceauLu extends Morceau {
  /** L'id statique du <details> englobant (les rubriques de l'aide). */
  details: string | null;
  /** La balise qui porte le texte. */
  porteur: string | null;
}

interface Element {
  nom: string;
  id: string | null;
  /** Combien de titres avaient été lus quand ce titre s'est ouvert. */
  titresAvant: number;
}

interface Contexte {
  mode: "balisage" | "code";
  /** Code : profondeur des accolades. */
  prof: number;
  /** Code : où commence l'expression, pour savoir ce qu'elle contenait. */
  debut: number;
  /** Balisage imbriqué dans du code : la balise racine et la hauteur de pile d'avant. */
  racine: string | null;
  hauteur: number;
  /** Balisage : la phrase en cours de lecture. */
  tampon: string;
  /** Le tampon contient-il autre chose que des blancs ? (Tenu à part : le
   *  recalculer à chaque caractère rendait la lecture quadratique.) */
  rempli: boolean;
  porteur: Element | null;
  genre: Morceau["genre"];
  ancre: string | null;
  details: string | null;
  /** Code : les chaînes de prose lues dans un titre, en attente (voir lireGabarit). */
  titres?: string[];
}

function nouveauBalisage(racine: string | null, hauteur: number): Contexte {
  return {
    mode: "balisage", prof: 0, debut: 0, racine, hauteur, tampon: "", rempli: false,
    porteur: null, genre: "aide", ancre: null, details: null,
  };
}

/** Ce qui interrompt du texte : une balise, une expression. */
const PROCHAIN = /[<{}]/g;

function lireGabarit(gabarit: string): MorceauLu[] {
  const morceaux: MorceauLu[] = [];
  const pile: Contexte[] = [nouveauBalisage(null, 0)];
  const elements: Element[] = [];
  let section: string | null = null;
  /**
   * La hauteur, dans la pile des éléments, du CONTENEUR du titre courant :
   * quand il se ferme, la section aussi. Sans cela, le formulaire sans titre
   * qui suit « Styles archivés » se disait « Styles archivés ».
   */
  let sectionNiveau: number | null = null;
  let titresLus = 0;

  const conteneurCourant = (): number | null => {
    for (let k = elements.length - 1; k >= 0; k--)
      if (CONTENEURS.has(elements[k]!.nom.toLowerCase())) return k;
    return null;
  };

  const ancreCourante = (): string | null => {
    for (let k = elements.length - 1; k >= 0; k--) {
      const e = elements[k]!;
      if (e.id && !SANS_ANCRE.has(e.nom.toLowerCase())) return e.id;
    }
    return null;
  };
  /** Le <details id="…"> englobant : une rubrique de l'aide (un <details> sans id, imbriqué, n'en est pas une). */
  const detailsCourant = (): string | null => {
    for (let k = elements.length - 1; k >= 0; k--) {
      const e = elements[k]!;
      if (e.id && e.nom.toLowerCase() === "details") return e.id;
    }
    return null;
  };
  /** La balise qui donne son genre au texte : la plus proche qui en dit un. */
  const porteurCourant = (): { genre: Morceau["genre"]; element: Element | null } => {
    for (let k = elements.length - 1; k >= 0; k--) {
      const e = elements[k]!;
      const n = e.nom.toLowerCase();
      if (SECTIONS.has(n)) return { genre: "section", element: e };
      if (LIBELLES.has(n)) return { genre: "libelle", element: e };
      if (AIDES.has(n)) return { genre: "aide", element: e };
    }
    return { genre: "aide", element: null };
  };

  const ajouter = (
    texteBrut: string,
    genre: Morceau["genre"],
    porteur: string | null,
    ancre: string | null,
    details: string | null,
    origine?: Morceau["origine"],
  ) => {
    const texte = propre(texteBrut);
    if (!texte || aJeter(texte)) return false;
    if (genre === "section") {
      section = texte;
      sectionNiveau = conteneurCourant();
      titresLus++;
    }
    morceaux.push({ texte, genre, section, ancre, details, porteur, ...(origine ? { origine } : {}) });
    return true;
  };

  /** Le texte venu d'une chaîne de code ou d'un attribut : il a son propre genre. */
  const ajouterChaine = (v: string, genre?: Morceau["genre"], origine?: Morceau["origine"]) => {
    const p = porteurCourant();
    ajouter(v, genre ?? p.genre, p.element?.nom ?? null, ancreCourante(), detailsCourant(), origine);
  };

  /** La phrase en cours est finie : elle devient un morceau. */
  const vider = (ctx: Contexte) => {
    if (ctx.mode !== "balisage") return;
    const brut = ctx.tampon;
    const rempli = ctx.rempli;
    ctx.tampon = "";
    ctx.rempli = false;
    if (!rempli) return;
    const ok = ajouter(brut, ctx.genre, ctx.porteur?.nom ?? null, ctx.ancre, ctx.details);
    // Un titre entièrement calculé (<h3>{s.label}</h3>) ouvre quand même une
    // nouvelle section, dont on ne connaît pas le nom : les textes qui suivent
    // ne doivent pas rester rattachés au titre d'avant.
    if (!ok && ctx.genre === "section" && ctx.porteur && ctx.porteur.titresAvant === titresLus) {
      section = null;
      sectionNiveau = null;
    }
  };

  /** Du texte entre dans la phrase en cours. */
  const ecrire = (ctx: Contexte, texte: string) => {
    if (!ctx.rempli && /\S/.test(texte)) {
      ctx.rempli = true;
      const p = porteurCourant();
      ctx.genre = p.genre;
      ctx.porteur = p.element;
      ctx.ancre = ancreCourante();
      ctx.details = detailsCourant();
    }
    ctx.tampon += texte;
  };

  /** Les attributs d'une balise qui portent du texte lisible. */
  const lireTextesDesAttributs = (b: Balise) => {
    if (b.nom === "Admin") return; // son titre est lu à part (titreAdmin)
    for (const a of lireAttributs(b.brut)) {
      const cache = ATTRIBUTS_CACHES.has(a.nom);
      const genre = ATTRIBUTS_LIBELLES.has(a.nom) || cache ? "libelle" : ATTRIBUTS_AIDES.has(a.nom) ? "aide" : null;
      if (!genre) continue;
      const valeurs = a.valeur !== undefined ? [a.valeur] : chainesDeProse(a.expression ?? "");
      for (const v of valeurs) ajouterChaine(v, genre, cache ? "attribut" : undefined);
    }
  };

  /** Une balise ouvrante entre dans la pile ; ses attributs sont lus. */
  const ouvrir = (b: Balise): boolean => {
    lireTextesDesAttributs(b);
    const nom = b.nom.toLowerCase();
    if (b.auto || VIDES.has(nom)) return false;
    let id: string | null = null;
    for (const a of lireAttributs(b.brut)) if (a.nom === "id" && a.valeur) id = a.valeur;
    elements.push({ nom: b.nom, id, titresAvant: titresLus });
    return true;
  };

  const fermer = (b: Balise) => {
    const nom = b.nom.toLowerCase();
    for (let k = elements.length - 1; k >= 0; k--) {
      if (elements[k]!.nom.toLowerCase() === nom) {
        elements.length = k;
        // Le conteneur du titre courant vient de se fermer : la section aussi.
        if (sectionNiveau !== null && k <= sectionNiveau) {
          section = null;
          sectionNiveau = null;
        }
        return;
      }
    }
  };

  let i = 0;
  const n = gabarit.length;
  while (i < n) {
    const ctx = pile[pile.length - 1]!;
    const c = gabarit[i]!;

    if (ctx.mode === "balisage") {
      if (c === "<" && gabarit.startsWith("<!--", i)) {
        const f = gabarit.indexOf("-->", i + 4);
        i = f === -1 ? n : f + 3;
        continue;
      }
      if (c === "<" && /[A-Za-z\/>]/.test(gabarit[i + 1] ?? "")) {
        const b = lireBalise(gabarit, i);
        const nom = b.nom.toLowerCase();
        if (EN_LIGNE.has(nom)) {
          // Une balise en ligne ne coupe pas la phrase, mais elle sépare
          // deux mots que le source collait (« <br> »).
          if (nom === "br") ctx.tampon += " ";
          i = b.fin;
          if (!b.fermante) ouvrir(b);
          else {
            fermer(b);
            // Une balise en ligne peut être la racine d'un balisage ouvert
            // depuis du code ({x && <strong>…</strong>}) : sa fermeture rend
            // la main au code.
            if (ctx.racine !== null && ctx.racine.toLowerCase() === nom && elements.length <= ctx.hauteur) {
              vider(ctx);
              pile.pop();
            }
          }
          continue;
        }
        vider(ctx);
        i = b.fin;
        if (b.fermante) {
          fermer(b);
          // Le balisage ouvert depuis du code se referme : retour au code.
          if (ctx.racine !== null && ctx.racine.toLowerCase() === nom && elements.length <= ctx.hauteur) pile.pop();
          continue;
        }
        if (SAUTEES.has(nom) && !b.auto) {
          // Un script, un style, la valeur d'un champ, un bloc de code :
          // rien à lire, on saute jusqu'à la balise fermante. Les attributs
          // d'un <textarea> (aria-label, title) sont lus quand même.
          if (nom === "textarea") lireTextesDesAttributs(b);
          const fin = new RegExp(`</${nom}\\s*>`, "gi");
          fin.lastIndex = i;
          const f = fin.exec(gabarit);
          i = f ? f.index + f[0].length : n;
          continue;
        }
        ouvrir(b);
        continue;
      }
      if (c === "{") {
        pile.push({ ...nouveauBalisage(null, 0), mode: "code", prof: 1, debut: i + 1 });
        i++;
        continue;
      }
      if (c === "}") {
        // Une accolade orpheline dans du balisage : ignorée.
        i++;
        continue;
      }
      // Le texte jusqu'à la prochaine balise ou expression, d'un seul coup.
      PROCHAIN.lastIndex = i;
      const p = PROCHAIN.exec(gabarit);
      const fin = p ? p.index : n;
      ecrire(ctx, gabarit.slice(i, Math.max(fin, i + 1)));
      i = Math.max(fin, i + 1);
      continue;
    }

    // ---- Mode code ----
    if (c === '"' || c === "'" || c === "`") {
      const [v, f] = lireChaine(gabarit, i);
      if (estDeLaProse(v)) {
        // Dans un titre, on attend la fin de l'expression : une seule chaîne
        // le nomme, plusieurs sont des variantes (voir plus bas).
        if (porteurCourant().genre === "section") (ctx.titres ??= []).push(v);
        else ajouterChaine(v);
      }
      i = f;
      continue;
    }
    if (c === "/" && gabarit[i + 1] === "/") {
      const f = gabarit.indexOf("\n", i);
      i = f === -1 ? n : f;
      continue;
    }
    if (c === "/" && gabarit[i + 1] === "*") {
      const f = gabarit.indexOf("*/", i + 2);
      i = f === -1 ? n : f + 2;
      continue;
    }
    if (c === "{") {
      ctx.prof++;
      i++;
      continue;
    }
    if (c === "}") {
      ctx.prof--;
      i++;
      if (ctx.prof === 0) {
        const expression = gabarit.slice(ctx.debut, i - 1).trim();
        pile.pop();
        // Un titre CALCULÉ entre plusieurs chaînes (« Nouvelle lettre »,
        // « Modifier la lettre » ou « Lettre envoyée », selon l'état) : aucune
        // ne nomme à coup sûr ce qui suit — la dernière le faisait, à tort.
        // Elles restent cherchables, comme libellés, et la section n'a pas de
        // nom. Une chaîne seule, elle, est bien le titre.
        const titres = ctx.titres ?? [];
        if (titres.length === 1) ajouterChaine(titres[0]!);
        else if (titres.length > 1) {
          section = null;
          sectionNiveau = null;
          for (const t of titres) ajouterChaine(t, "libelle");
        }
        const parent = pile[pile.length - 1]!;
        // Ce que l'expression laisse dans la phrase : une chaîne seule
        // ({" "}, {"{prenom}"}) s'écrit telle quelle ; un calcul devient
        // « … » ; un commentaire {/* … */}, rien.
        const litteral = /^(["'`])([^"'`$\\]*)\1$/.exec(expression);
        if (litteral) ecrire(parent, litteral[2]!);
        else if (expression && !/^\/\*[\s\S]*\*\/$/.test(expression)) ecrire(parent, " … ");
      }
      continue;
    }
    if (c === "<" && /[A-Za-z>]/.test(gabarit[i + 1] ?? "")) {
      // Du balisage dans du code, s'il suit un opérateur qui l'annonce
      // (« ( », « ? », « : », « && », « => », « return »…). La fenêtre de
      // regard arrière est large : un fichier en CRLF met deux caractères
      // par fin de ligne, et l'indentation en ajoute.
      const avant = gabarit.slice(Math.max(0, i - 200), i).trimEnd();
      if (/(\(|\?|:|&&|\|\||=>|,|\[|\{|return)$/.test(avant)) {
        const b = lireBalise(gabarit, i);
        i = b.fin;
        const hauteur = elements.length;
        if (ouvrir(b)) pile.push(nouveauBalisage(b.nom, hauteur));
        continue;
      }
    }
    i++;
  }
  for (let k = pile.length - 1; k >= 0; k--) vider(pile[k]!);
  return morceaux;
}

/** Les textes de l'entête : SECTIONS, aides et libellés écrits en données. */
function lireEntete(entete: string): MorceauLu[] {
  const out: MorceauLu[] = [];
  let section: string | null = null;
  CLES_ENTETE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = CLES_ENTETE.exec(entete))) {
    let j = CLES_ENTETE.lastIndex;
    let v = "";
    // « a » + « b » + `c` : une phrase coupée pour tenir dans la largeur.
    for (;;) {
      if (!/["'`]/.test(entete[j] ?? "")) break;
      const [s, f] = lireChaine(entete, j);
      v += s;
      j = f;
      const suite = /^\s*\+\s*/.exec(entete.slice(j, j + 40));
      if (!suite) break;
      j += suite[0].length;
    }
    CLES_ENTETE.lastIndex = Math.max(j, CLES_ENTETE.lastIndex);
    const texte = propre(v);
    if (!texte || aJeter(texte)) continue;
    const cle = m[1]!;
    if (CLES_A_PROSE.has(cle) && !estDeLaProse(v)) continue;
    const genre: Morceau["genre"] =
      cle === "titre" ? "section" : cle === "label" || cle === "libelle" || cle === "nom" ? "libelle" : "aide";
    if (genre === "section") section = texte;
    out.push({ texte, genre, section, ancre: null, details: null, porteur: null });
  }
  return out;
}

/** Sans doublon : un même libellé répété dans une boucle ne compte qu'une fois. */
function sansDoublons<T extends Morceau>(morceaux: T[]): T[] {
  const vus = new Set<string>();
  return morceaux.filter((m) => {
    const cle = `${m.genre}\u0000${m.section ?? ""}\u0000${m.ancre ?? ""}\u0000${m.texte}`;
    if (vus.has(cle)) return false;
    vus.add(cle);
    return true;
  });
}

function versMorceau(m: MorceauLu): Morceau {
  const morceau: Morceau = { texte: m.texte, genre: m.genre, section: m.section, ancre: m.ancre };
  if (m.origine) morceau.origine = m.origine;
  return morceau;
}

/* -------------------------------------------------------------------------- */
/*  Ce que l'index demande                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Tous les textes d'un fichier .astro, dans l'ordre : le gabarit d'abord,
 * puis les textes écrits en données dans l'entête (« titre: », « aide: »…,
 * comme les SECTIONS de contenu.astro).
 */
export function extraireTextes(source: string): Morceau[] {
  const { entete, gabarit } = couper(source);
  return sansDoublons([...lireGabarit(gabarit), ...lireEntete(entete)]).map(versMorceau);
}

/**
 * Le titre que la page donne à la mise en page (<Admin title=…>) : la
 * DERNIÈRE chaîne littérale, parce que la première est souvent celle de la
 * création (« Nouveau bandeau visuel ») et la dernière celle de la fiche
 * (« Bandeau visuel : … » → « Bandeau visuel »).
 */
export function titreAdmin(source: string): string | null {
  const { gabarit } = couper(source);
  const debut = gabarit.search(/<Admin[\s>]/);
  if (debut === -1) return null;
  const b = lireBalise(gabarit, debut);
  const titre = lireAttributs(b.brut).find((a) => a.nom === "title");
  if (!titre) return null;
  let brut: string | null = titre.valeur ?? null;
  if (brut === null) {
    const expression = titre.expression ?? "";
    for (let i = 0; i < expression.length; i++) {
      const c = expression[i];
      if (c === '"' || c === "'" || c === "`") {
        const [v, f] = lireChaine(expression, i);
        brut = v;
        i = f - 1;
      }
    }
  }
  if (brut === null) return null;
  const t = propre(decoderEntites(brut).replace(/…/g, " ")).replace(/[\s:#\-–—·]+$/, "").trim();
  return nombreDeLettres(t) >= 2 ? t : null;
}

/** Les composants de components/ qu'importe une page : « OrderTable »… */
export function composantsImportes(source: string): string[] {
  const { entete } = couper(source);
  const noms = new Set<string>();
  for (const m of entete.matchAll(/import\s+\w+\s+from\s+["'][^"']*\/components\/([\w-]+)\.astro["']/g))
    noms.add(m[1]!);
  return [...noms];
}

/**
 * Les rubriques d'une page d'aide : chaque <details id="…"> statique, avec le
 * texte de son <summary> pour titre et le reste pour corps. Les ids sont LUS
 * dans le source, pas recopiés : une rubrique ajoutée à l'aide est trouvable
 * le jour même.
 */
export function rubriquesAide(source: string): { id: string; titre: string; morceaux: Morceau[] }[] {
  const { gabarit } = couper(source);
  const rubriques = new Map<string, { id: string; titre: string; morceaux: Morceau[] }>();
  for (const m of sansDoublons(lireGabarit(gabarit))) {
    if (!m.details) continue;
    let r = rubriques.get(m.details);
    if (!r) {
      r = { id: m.details, titre: "", morceaux: [] };
      rubriques.set(m.details, r);
    }
    if (!r.titre && m.porteur?.toLowerCase() === "summary") r.titre = m.texte;
    else r.morceaux.push(versMorceau(m));
  }
  return [...rubriques.values()].filter((r) => r.titre);
}
