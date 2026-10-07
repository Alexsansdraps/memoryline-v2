/**
 * L'arrivée sur un écran depuis un résultat de la recherche.
 *
 * Le lien d'un résultat porte, dans son FRAGMENT, le passage trouvé et
 * l'endroit où le chercher : « /produits/5#trouver=Kirche&ancre=langue-de&
 * champ=description » (voir lienRecherche, @memoryline/types/recherche).
 * Ouvrir le bon écran ne suffit pas : la description allemande est dans un
 * volet fermé, au milieu d'une fiche de trois mille lignes. Ce script, posé
 * sur TOUTES les pages par la mise en page, retrouve le passage — dans le
 * texte affiché ET dans la valeur des champs —, ouvre ce qui le cache (un
 * <details>, l'onglet d'une langue), le fait défiler au milieu de l'écran, le
 * surligne, et propose « suivant / précédent » s'il y en a plusieurs.
 *
 * Les fragments de texte natifs du navigateur (#:~:text=) ne suffiraient pas :
 * ils ne voient pas la valeur des champs, et ils feraient défiler la page vers
 * la première occurrence visible, en concurrence avec ce script.
 *
 * Quelques règles qu'il ne faut pas perdre en le modifiant :
 *   - Aucune balise n'est ajoutée dans la page pour surligner (pas de <mark>) :
 *     dans un éditeur de texte, elle partirait dans le HTML enregistré. Le
 *     surlignage passe par l'API « CSS Custom Highlight », qui peint sans
 *     toucher au DOM.
 *   - Le seul bouton de la page qu'on clique est celui d'une langue
 *     (data-ml-langue-bouton) : il ne fait que montrer des champs. Un volet
 *     qui dépend d'un autre réglage (le type d'offre du bandeau) n'est pas
 *     forcé : ce serait mentir sur l'état du formulaire.
 *   - Le texte vient de l'adresse : n'importe qui peut y écrire n'importe
 *     quoi. Il n'est affiché que par textContent, jamais interprété.
 *   - L'adresse est remise au propre dès l'arrivée : « trouver= » ne reste ni
 *     dans la barre d'adresse ni dans l'historique.
 */
import {
  aplatir,
  aplatirAvecCarte,
  intervalleOrigine,
  lireCible,
  type CibleRecherche,
} from "@memoryline/types/recherche";

/** Les balises qui ne coupent pas une phrase (les mêmes que lib/extraire-textes.ts). */
const EN_LIGNE = new Set(["A", "STRONG", "EM", "B", "I", "U", "CODE", "KBD", "SPAN", "MARK", "SMALL", "ABBR", "SUP", "SUB", "BR"]);

/** Ce qui n'est jamais du contenu de l'écran : code, modèles, filigranes, aperçus. */
const EXCLUS = [
  "script", "style", "template", "noscript", "datalist", "svg", "select", "textarea",
  "[aria-hidden='true']", "[data-invite]", "[data-reserve]", "#bv-apercu",
  "#ml-recherche", "#ml-trouver-barre", "#cibles-menu",
].join(",");

/** Les champs qu'on ne lit pas : modèles de lignes, la recherche elle-même, aperçus. */
const CHAMPS_EXCLUS = "template,[data-reserve],[aria-hidden='true'],#bv-apercu,#ml-recherche,#ml-trouver-barre";

/** Les champs dont la valeur se lit (et se sélectionne, sauf email et number). */
const TYPES_LUS = new Set(["", "text", "search", "url", "tel", "email", "number"]);
const TYPES_SELECTIONNABLES = new Set(["", "text", "search", "url", "tel"]);

/** Pas plus d'occurrences : au-delà, on ne les parcourt plus une à une. */
const OCCURRENCES_MAX = 50;

type Champ = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

type Occurrence =
  | { genre: "texte"; range: Range; el: Element; noeud: Node; debut: number }
  | { genre: "champ"; el: Champ; noeud: Node; debut: number; fin: number };

interface Etat {
  texte: string;
  liste: Occurrence[];
  i: number;
  ecartees: number;
}

let etat: Etat | null = null;
/** Elle n'a pas fait défiler depuis l'arrivée : on peut recentrer au « load ». */
let personneNaBouge = true;

/* -------------------------------------------------------------------------- */
/*  Petits outils                                                             */
/* -------------------------------------------------------------------------- */

function estChamp(el: Element): el is Champ {
  return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement;
}

/** Un champ dont la valeur se lit : pas un champ caché, pas un mot de passe. */
function champLisible(el: Element): el is Champ {
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return true;
  if (el instanceof HTMLInputElement) return TYPES_LUS.has((el.getAttribute("type") ?? "").toLowerCase());
  return false;
}

function valeurDe(el: Champ): string {
  if (el instanceof HTMLSelectElement) return el.selectedOptions[0]?.text ?? "";
  return el.value ?? "";
}

/** Toutes les occurrences du texte aplati `cherche` dans `texte` : [début, fin[ d'origine. */
function occurrencesDans(texte: string, cherche: string, place: number): [number, number][] {
  const sortie: [number, number][] = [];
  if (!cherche || !texte || place <= 0) return sortie;
  const { plat, carte } = aplatirAvecCarte(texte);
  let p = plat.indexOf(cherche);
  while (p !== -1 && sortie.length < place) {
    const o = intervalleOrigine(texte, carte, p, p + cherche.length);
    if (o.fin > o.debut) sortie.push([o.debut, o.fin]);
    p = plat.indexOf(cherche, p + cherche.length);
  }
  return sortie;
}

/** Le bloc qui porte un nœud : deux blocs ne se lisent pas d'un trait. */
function blocDe(el: Element): Element {
  let n: Element = el;
  while (EN_LIGNE.has(n.tagName) && n.parentElement) n = n.parentElement;
  return n;
}

function visible(el: Element): boolean {
  const e = el as Element & { checkVisibility?: (o?: Record<string, boolean>) => boolean };
  if (typeof e.checkVisibility === "function")
    return e.checkVisibility({ checkVisibilityCSS: true, visibilityProperty: true });
  const h = el as HTMLElement;
  return !!(h.offsetWidth || h.offsetHeight || h.getClientRects().length);
}

/* -------------------------------------------------------------------------- */
/*  Ce qui cache une occurrence, et les gestes qui la montrent                */
/* -------------------------------------------------------------------------- */

interface Obstacles {
  /** Faux si quelque chose la cache qu'on ne sait (ou ne doit) pas ouvrir. */
  ouvrable: boolean;
  gestes: (() => void)[];
}

/**
 * Remonte de l'élément jusqu'au corps de la page. Trois gestes sont permis,
 * et seulement trois :
 *   (a) ouvrir un <details> fermé (sauf si l'occurrence est dans son propre
 *       <summary>, qui se voit déjà) ;
 *   (b) cliquer le bouton de la langue d'un bloc [hidden][data-langue] — ces
 *       boutons ne font que montrer des champs ;
 *   (c) retirer hidden="until-found", si un écran l'adopte un jour.
 * Tout autre masque (un [hidden] sans langue, une classe « hidden », un
 * display:none) rend l'occurrence impossible à montrer honnêtement.
 *
 * Calculé au moment d'Y ALLER, et pas une fois pour toutes : aller à
 * l'occurrence anglaise cache la française, qu'il faudra re-montrer au retour.
 */
function obstacles(el: Element): Obstacles {
  const gestes: (() => void)[] = [];
  let ouvrable = true;
  for (let n: Element | null = el; n && n !== document.body && n !== document.documentElement; n = n.parentElement) {
    if (n instanceof HTMLDetailsElement && !n.open) {
      const resume = n.querySelector(":scope > summary");
      if (!(resume && resume.contains(el))) {
        const d = n;
        gestes.push(() => {
          d.open = true;
        });
      }
    }
    if (n.hasAttribute("hidden")) {
      const langue = n.getAttribute("data-langue");
      const bouton = langue
        ? document.querySelector<HTMLElement>(`[data-ml-langue-bouton="${CSS.escape(langue)}"]`)
        : null;
      if (bouton) gestes.push(() => bouton.click());
      else if (n.getAttribute("hidden") === "until-found") {
        const x = n;
        gestes.push(() => x.removeAttribute("hidden"));
      } else ouvrable = false;
      continue;
    }
    if (getComputedStyle(n).display === "none") ouvrable = false;
  }
  return { ouvrable, gestes };
}

/* -------------------------------------------------------------------------- */
/*  Trouver                                                                   */
/* -------------------------------------------------------------------------- */

interface Bloc {
  bloc: Element;
  texte: string;
  segments: { noeud: Text; debut: number }[];
}

/** Le texte affiché sous `racine`, bloc par bloc (les liens en ligne ne coupent pas une phrase). */
function blocsDe(racine: Element): Bloc[] {
  const marcheur = document.createTreeWalker(racine, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode(n) {
      if (n.nodeType === Node.ELEMENT_NODE) {
        const el = n as Element;
        if (el !== racine && el.matches(EXCLUS)) return NodeFilter.FILTER_REJECT;
        return el.tagName === "BR" ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  const blocs: Bloc[] = [];
  let courant: Bloc | null = null;
  for (let n = marcheur.nextNode(); n; n = marcheur.nextNode()) {
    const parent = n.nodeType === Node.TEXT_NODE ? n.parentElement : (n as Element);
    if (!parent) continue;
    const bloc = blocDe(parent);
    if (!courant || courant.bloc !== bloc) {
      courant = { bloc, texte: "", segments: [] };
      blocs.push(courant);
    }
    // Un <br> sépare deux mots que le DOM collerait (« ligne 1ligne 2 ») :
    // une espace virtuelle, qui ne correspond à aucun nœud.
    if (n.nodeType !== Node.TEXT_NODE) {
      courant.texte += " ";
      continue;
    }
    courant.segments.push({ noeud: n as Text, debut: courant.texte.length });
    courant.texte += (n as Text).data;
  }
  return blocs;
}

/** [début, fin[ dans le texte d'un bloc → une Range sur ses nœuds. */
function rangeDe(bloc: Bloc, debut: number, fin: number): Range | null {
  let depart: { noeud: Text; offset: number } | null = null;
  let arrivee: { noeud: Text; offset: number } | null = null;
  for (const s of bloc.segments) {
    const finSegment = s.debut + s.noeud.data.length;
    if (!depart && debut < finSegment && debut >= s.debut) depart = { noeud: s.noeud, offset: debut - s.debut };
    if (!depart && debut < s.debut) depart = { noeud: s.noeud, offset: 0 };
    if (depart && fin <= finSegment && fin > s.debut) {
      arrivee = { noeud: s.noeud, offset: fin - s.debut };
      break;
    }
  }
  if (!depart || !arrivee) return null;
  const r = document.createRange();
  r.setStart(depart.noeud, depart.offset);
  r.setEnd(arrivee.noeud, arrivee.offset);
  return r;
}

function occurrencesTexte(racine: Element, cherche: string, place: number): Occurrence[] {
  const sortie: Occurrence[] = [];
  for (const bloc of blocsDe(racine)) {
    if (sortie.length >= place) break;
    for (const [d, f] of occurrencesDans(bloc.texte, cherche, place - sortie.length)) {
      const range = rangeDe(bloc, d, f);
      if (!range) continue;
      const el = range.startContainer.parentElement ?? bloc.bloc;
      sortie.push({ genre: "texte", range, el, noeud: range.startContainer, debut: range.startOffset });
    }
  }
  return sortie;
}

function occurrencesChamp(el: Champ, cherche: string, place: number): Occurrence[] {
  return occurrencesDans(valeurDe(el), cherche, place).map(([debut, fin]) => ({
    genre: "champ" as const,
    el,
    noeud: el,
    debut,
    fin,
  }));
}

/** Le cas du paramètre « champ » : les éléments qui portent ce nom, et ce qu'ils contiennent. */
function dansLeChamp(racine: Element, nom: string, cherche: string): { occurrences: Occurrence[]; champ: Element | null } {
  const occurrences: Occurrence[] = [];
  let champ: Element | null = null;
  for (const el of racine.querySelectorAll(`[name="${CSS.escape(nom)}"]`)) {
    if (el.closest(CHAMPS_EXCLUS)) continue;
    // L'éditeur de texte : le serveur ne voit que son champ caché, mais le
    // texte se lit dans sa zone d'écriture, juste à côté.
    if (el instanceof HTMLInputElement && el.type === "hidden" && el.hasAttribute("data-champ")) {
      const zone = el.parentElement?.querySelector("[data-zone]");
      if (!zone) continue;
      champ ??= zone;
      occurrences.push(...occurrencesTexte(zone, cherche, OCCURRENCES_MAX - occurrences.length));
      continue;
    }
    if (!champLisible(el)) continue;
    champ ??= el;
    occurrences.push(...occurrencesChamp(el, cherche, OCCURRENCES_MAX - occurrences.length));
  }
  return { occurrences, champ };
}

/** Partout sous la racine : le texte affiché, puis la valeur des champs. */
function partout(racine: Element, cherche: string): Occurrence[] {
  const occurrences = occurrencesTexte(racine, cherche, OCCURRENCES_MAX);
  for (const el of racine.querySelectorAll("input,textarea,select")) {
    if (occurrences.length >= OCCURRENCES_MAX) break;
    if (el.id === "ml-recherche-champ" || el.closest(CHAMPS_EXCLUS) || !champLisible(el)) continue;
    occurrences.push(...occurrencesChamp(el, cherche, OCCURRENCES_MAX - occurrences.length));
  }
  return occurrences;
}

/** Garde ce qu'on saura montrer, dans l'ordre de lecture. */
function trier(occurrences: Occurrence[]): { liste: Occurrence[]; ecartees: number } {
  const liste: Occurrence[] = [];
  let ecartees = 0;
  for (const o of occurrences) {
    const ob = obstacles(o.el);
    // Sans geste à faire, elle doit déjà se voir : un texte masqué par une
    // classe n'est pas un endroit où l'on peut emmener quelqu'un.
    if (!ob.ouvrable || (!ob.gestes.length && !visible(o.el))) {
      ecartees++;
      continue;
    }
    liste.push(o);
  }
  liste.sort((a, b) => {
    if (a.noeud === b.noeud) return a.debut - b.debut;
    return a.noeud.compareDocumentPosition(b.noeud) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
  });
  return { liste, ecartees };
}

/* -------------------------------------------------------------------------- */
/*  Montrer                                                                   */
/* -------------------------------------------------------------------------- */

interface RegistreSurlignage {
  set(nom: string, valeur: unknown): void;
  delete(nom: string): void;
}

function registre(): { surligner: RegistreSurlignage; Highlight: new (...r: Range[]) => unknown } | null {
  const css = (globalThis as unknown as { CSS?: { highlights?: RegistreSurlignage } }).CSS;
  const H = (globalThis as unknown as { Highlight?: new (...r: Range[]) => unknown }).Highlight;
  return css?.highlights && H ? { surligner: css.highlights, Highlight: H } : null;
}

function effacerSurlignage(): void {
  const r = registre();
  r?.surligner.delete("ml-trouve");
  r?.surligner.delete("ml-trouve-actuel");
  for (const el of document.querySelectorAll(".ml-champ-trouve")) el.classList.remove("ml-champ-trouve");
}

function peindre(): void {
  if (!etat) return;
  for (const el of document.querySelectorAll(".ml-champ-trouve")) el.classList.remove("ml-champ-trouve");
  const r = registre();
  const tous: Range[] = [];
  const actuel: Range[] = [];
  for (let k = 0; k < etat.liste.length; k++) {
    const o = etat.liste[k]!;
    if (o.genre !== "texte") continue;
    tous.push(o.range);
    if (k === etat.i) actuel.push(o.range);
  }
  if (r) {
    r.surligner.set("ml-trouve", new r.Highlight(...tous));
    r.surligner.set("ml-trouve-actuel", new r.Highlight(...actuel));
  }
  const courante = etat.liste[etat.i];
  if (!courante) return;
  // Sans l'API de surlignage, ou pour un champ : un contour sur l'élément.
  if (courante.genre === "champ") courante.el.classList.add("ml-champ-trouve");
  else if (!r) blocDe(courante.el).classList.add("ml-champ-trouve");
}

/**
 * Le passage sélectionné dans un champ serait REMPLACÉ par la touche
 * suivante : un réflexe de frappe effacerait ce qu'on venait chercher. À la
 * première touche qui modifie, si la sélection est encore exactement le
 * passage, elle se réduit à sa fin — la touche s'écrit après lui.
 */
function garderLePassage(el: HTMLInputElement | HTMLTextAreaElement, debut: number, fin: number): void {
  const garde = el as typeof el & { __mlGarde?: boolean };
  if (garde.__mlGarde) return;
  garde.__mlGarde = true;
  // Vu comme un HTMLElement : sur l'union des deux types de champ,
  // TypeScript ne sait plus que « keydown » donne un KeyboardEvent.
  const cible: HTMLElement = el;
  const retirer = () => {
    cible.removeEventListener("keydown", surTouche, true);
    cible.removeEventListener("blur", retirer);
    garde.__mlGarde = false;
  };
  function surTouche(e: KeyboardEvent): void {
    const modifie =
      (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) ||
      e.key === "Backspace" ||
      e.key === "Delete" ||
      (e.key === "Enter" && el instanceof HTMLTextAreaElement);
    if (!modifie) return;
    if (el.selectionStart === debut && el.selectionEnd === fin) el.setSelectionRange(fin, fin);
    retirer();
  }
  cible.addEventListener("keydown", surTouche, true);
  cible.addEventListener("blur", retirer);
}

/** Le défilement INTERNE d'un textarea jusqu'à la ligne trouvée. */
function defilerDansLeChamp(el: HTMLTextAreaElement, debut: number): void {
  const style = getComputedStyle(el);
  const ligne = Number.parseFloat(style.lineHeight) || (Number.parseFloat(style.fontSize) || 14) * 1.25;
  const avant = el.value.slice(0, debut).split("\n").length - 1;
  el.scrollTop = Math.max(0, avant * ligne - el.clientHeight / 2);
}

function centrer(el: Element): void {
  // Au milieu, et sans « smooth » : centrer évite les barres collantes (en
  // haut de /personnages, en bas de « modifier plusieurs produits ») et fait
  // aussi défiler les conteneurs internes (l'éditeur de texte).
  el.scrollIntoView({ block: "center", inline: "nearest" });
}

function montrerCourante(): void {
  const o = etat?.liste[etat.i];
  if (!o) return;
  if (o.genre === "texte") {
    const cible = o.range.startContainer.parentElement ?? o.el;
    centrer(cible);
    return;
  }
  centrer(o.el);
  if (o.el instanceof HTMLTextAreaElement) defilerDansLeChamp(o.el, o.debut);
}

/** Va à l'occurrence k : ses gestes d'abord, puis le défilement et le surlignage. */
function aller(k: number): void {
  if (!etat) return;
  for (let essais = 0; etat.liste.length && essais <= etat.liste.length; essais++) {
    etat.i = ((k % etat.liste.length) + etat.liste.length) % etat.liste.length;
    const o = etat.liste[etat.i]!;
    const ob = obstacles(o.el);
    if (ob.ouvrable) for (const g of ob.gestes) g();
    // Un geste n'a pas suffi (un volet qui dépend d'un autre réglage) :
    // l'occurrence est retirée, on passe à la suivante.
    if (ob.ouvrable && visible(o.el)) break;
    etat.liste.splice(etat.i, 1);
    etat.ecartees++;
  }
  if (!etat.liste.length) {
    barre();
    return;
  }
  const o = etat.liste[etat.i]!;
  montrerCourante();
  peindre();
  if (o.genre === "champ") {
    // Un contenteditable n'est jamais pris par le focus (on y écrirait) ;
    // un champ de saisie l'est, avec le passage sélectionné.
    const type = o.el instanceof HTMLInputElement ? (o.el.getAttribute("type") ?? "").toLowerCase() : "";
    if (o.el instanceof HTMLTextAreaElement || (o.el instanceof HTMLInputElement && TYPES_SELECTIONNABLES.has(type))) {
      const champ = o.el;
      champ.focus({ preventScroll: true });
      try {
        champ.setSelectionRange(o.debut, o.fin);
        garderLePassage(champ, o.debut, o.fin);
      } catch {
        /* e-mail, nombre : pas de sélection possible, le contour suffit */
      }
      if (champ instanceof HTMLTextAreaElement) defilerDansLeChamp(champ, o.debut);
    }
  }
  barre();
}

/* -------------------------------------------------------------------------- */
/*  La barre « 2 / 5 »                                                        */
/* -------------------------------------------------------------------------- */

function bouton(texte: string, etiquette: string, action: () => void): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = texte;
  b.setAttribute("aria-label", etiquette);
  b.title = etiquette;
  b.addEventListener("click", action);
  return b;
}

/**
 * La barre en bas à droite. Construite par createElement et textContent
 * uniquement : le texte cherché vient de l'adresse, il n'est jamais
 * interprété (« <img onerror=…> » reste du texte).
 */
function barre(phrase?: string): void {
  if (!etat) return;
  let b = document.getElementById("ml-trouver-barre");
  if (!b) {
    b = document.createElement("div");
    b.id = "ml-trouver-barre";
    b.setAttribute("role", "status");
    b.setAttribute("aria-live", "polite");
    document.body.appendChild(b);
  }
  const texte = document.createElement("span");
  texte.className = "ml-trouver-texte";
  const n = etat.liste.length;
  if (phrase) texte.textContent = phrase;
  else if (n) texte.textContent = `« ${etat.texte} » ${etat.i + 1} / ${n}`;
  else if (etat.ecartees)
    texte.textContent = `« ${etat.texte} » est dans une partie masquée de cet écran (elle dépend d'un autre réglage).`;
  else texte.textContent = `« ${etat.texte} » n'est pas affiché sur cet écran en ce moment.`;
  const enfants: Node[] = [texte];
  if (n > 1 && !phrase)
    enfants.push(
      bouton("‹", "Précédent", () => aller((etat?.i ?? 0) - 1)),
      bouton("›", "Suivant", () => aller((etat?.i ?? 0) + 1)),
    );
  enfants.push(bouton("×", "Fermer", fermer));
  b.replaceChildren(...enfants);
}

function fermer(): void {
  effacerSurlignage();
  document.getElementById("ml-trouver-barre")?.remove();
  etat = null;
  arreterGuet();
}

/* -------------------------------------------------------------------------- */
/*  L'arrivée                                                                 */
/* -------------------------------------------------------------------------- */

/** Le contenu qui arrive tard (une liste remplie par un script) : on le guette deux secondes. */
let guet: MutationObserver | null = null;
let finDuGuet: ReturnType<typeof setTimeout> | null = null;

function arreterGuet(): void {
  guet?.disconnect();
  guet = null;
  if (finDuGuet) clearTimeout(finDuGuet);
  finDuGuet = null;
}

/** Révèle un élément (ses <details>, l'onglet de sa langue), le centre et l'entoure deux secondes. */
function signaler(el: Element): void {
  if (el instanceof HTMLDetailsElement) el.open = true;
  const ob = obstacles(el);
  if (ob.ouvrable) for (const g of ob.gestes) g();
  centrer(el);
  el.classList.add("ml-champ-trouve");
  setTimeout(() => el.classList.remove("ml-champ-trouve"), 2000);
}

function racineDe(cible: CibleRecherche): { racine: Element; ancre: Element | null } {
  const ancre = cible.ancre ? document.getElementById(cible.ancre) : null;
  return { racine: ancre ?? document.querySelector("main") ?? document.body, ancre };
}

/** Une passe de recherche : rend vrai si quelque chose a été montré. */
function chercher(cible: CibleRecherche & { trouver: string }): boolean {
  const { racine, ancre } = racineDe(cible);
  if (racine instanceof HTMLDetailsElement && !racine.open) racine.open = true;
  const cherche = aplatir(cible.trouver);
  if (!cherche) return false;

  if (cible.champ) {
    const { occurrences, champ } = dansLeChamp(racine, cible.champ, cherche);
    if (occurrences.length) {
      const { liste, ecartees } = trier(occurrences);
      etat = { texte: cible.trouver, liste, i: -1, ecartees };
      if (liste.length) {
        aller(0);
        return true;
      }
    } else if (champ) {
      // Le champ est là, mais le texte a changé depuis la recherche (ou il
      // diffère d'un caractère) : on montre le champ, et on le dit.
      etat = { texte: cible.trouver, liste: [], i: -1, ecartees: 0 };
      signaler(champ);
      if (estChamp(champ)) champ.focus({ preventScroll: true });
      barre("Le passage n'a pas été retrouvé tel quel dans ce champ.");
      return true;
    }
  }

  const { liste, ecartees } = trier(partout(racine, cherche));
  etat = { texte: cible.trouver, liste, i: -1, ecartees };
  if (liste.length) {
    aller(0);
    return true;
  }
  barre();
  if (ancre) centrer(ancre);
  return false;
}

function arriver(): void {
  const cible = lireCible(location.hash);
  if (!cible) return;
  fermer();

  // L'adresse redevient propre : un rechargement, un formulaire envoyé ou un
  // retour arrière ne relancent pas la recherche, et le texte cherché ne
  // reste pas dans l'historique.
  history.replaceState(history.state, "", location.pathname + location.search + (cible.ancre ? `#${cible.ancre}` : ""));

  if (!cible.trouver) {
    const { racine } = racineDe(cible);
    const champ = cible.champ ? racine.querySelector(`[name="${CSS.escape(cible.champ)}"]`) : null;
    signaler(champ ?? racine);
    return;
  }

  const demande = { ...cible, trouver: cible.trouver };
  if (chercher(demande)) return;

  // Rien au premier passage : le contenu arrive peut-être encore (une liste
  // remplie par un script). On relance après chaque rafale de changements,
  // pendant deux secondes au plus.
  const { racine } = racineDe(cible);
  let attente: ReturnType<typeof setTimeout> | null = null;
  guet = new MutationObserver((changements) => {
    // Nos propres changements (la barre) ne comptent pas.
    const dansLaBarre = (n: Node) => !!(n instanceof Element ? n : n.parentElement)?.closest("#ml-trouver-barre");
    if (changements.every((c) => dansLaBarre(c.target))) return;
    if (attente) clearTimeout(attente);
    attente = setTimeout(() => {
      if (!guet) return;
      if (chercher(demande)) arreterGuet();
    }, 150);
  });
  guet.observe(racine, { childList: true, subtree: true, characterData: true });
  finDuGuet = setTimeout(arreterGuet, 2000);
}

/* -------------------------------------------------------------------------- */
/*  Démarrage                                                                 */
/* -------------------------------------------------------------------------- */

// Un geste de sa part, et on ne recentre plus rien derrière son dos.
for (const evenement of ["wheel", "keydown", "touchmove", "pointerdown"])
  window.addEventListener(evenement, () => (personneNaBouge = false), { capture: true, once: true, passive: true });

// Les images qui se chargent après coup déplacent la page : au « load », on
// recentre l'occurrence courante, si personne n'a bougé entre-temps (comme
// personnages/[id].astro le fait pour ses couleurs).
if (document.readyState !== "complete")
  window.addEventListener("load", () => {
    if (personneNaBouge && etat?.liste.length) montrerCourante();
  });

// Échap ferme la barre et efface le surlignage — sauf dans le champ de la
// recherche, où Échap ferme d'abord le panneau.
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape" || !document.getElementById("ml-trouver-barre")) return;
  if ((e.target as Element | null)?.closest?.("#ml-recherche")) return;
  fermer();
});

// Un résultat qui mène à l'écran déjà ouvert ne change que le fragment.
window.addEventListener("hashchange", arriver);
arriver();
