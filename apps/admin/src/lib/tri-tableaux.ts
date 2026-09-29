/**
 * Tous les tableaux du back-office se trient, colonne par colonne.
 *
 * Un seul script, posé par la mise en page, plutôt qu'un tri écrit écran par
 * écran : un tableau ajouté demain se trie tout seul, et aucun n'est oublié.
 * Un clic sur un en-tête trie dans un sens, un second clic dans l'autre ; le
 * clavier fait pareil (Tab, puis Entrée).
 *
 * Le tri a lieu dans la page, sur les lignes affichées. Aucun tableau du
 * back-office n'enregistre l'ordre de ses lignes à l'écran — les ordres
 * d'affichage se règlent ailleurs (flèches du menu, « Ordre d'affichage » des
 * produits) —, trier pour regarder ne change donc jamais rien d'enregistré.
 *
 * Ce qu'une cellule vaut pour le tri :
 *   - son attribut `data-tri`, s'il y en a un (un écran peut toujours dire
 *     mieux que le texte affiché) ;
 *   - sinon son texte, reconnu comme NOMBRE (« 1 234 », « 23,00 € »,
 *     « 12 % », « 250 g »), comme DATE (« 29 septembre 2026 à 13:06 »,
 *     « 29 sept. 2026 », « 29/09/2026 », « 2026-09-29 »), ou comme texte —
 *     comparé à la française, chiffres compris : « WEB-0009 » avant « WEB-0012 ».
 * Une cellule vide (« — » compris) va toujours en bas, dans les deux sens.
 *
 * Pour qu'un tableau ne se trie PAS : `data-sans-tri` sur la balise <table>.
 * Pour une seule colonne : `data-sans-tri` sur son <th>.
 */

const MOIS: Record<string, number> = {
  janv: 0, janvier: 0, jan: 0,
  fevr: 1, fevrier: 1, fev: 1,
  mars: 2, mar: 2,
  avr: 3, avril: 3,
  mai: 4,
  juin: 5,
  juil: 6, juillet: 6,
  aout: 7,
  sept: 8, septembre: 8, sep: 8,
  oct: 9, octobre: 9,
  nov: 10, novembre: 10,
  dec: 11, decembre: 11,
};

const sansAccent = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");

type Valeur =
  | { genre: "vide" }
  | { genre: "nombre"; v: number }
  | { genre: "date"; v: number }
  | { genre: "texte"; v: string };

function lireDate(t: string): number | null {
  const s = sansAccent(t.toLowerCase()).replace(/\s+/g, " ").trim();
  // « 29 septembre 2026 à 13:06 », « 29 sept. 2026 », « 1er mars 2026 »
  let m = /^(\d{1,2})(?:er)? ([a-z]+)\.? (\d{4})(?:,? (?:a )?(\d{1,2})[:h](\d{2}))?$/.exec(s);
  if (m && MOIS[m[2]!] !== undefined)
    return new Date(+m[3]!, MOIS[m[2]!]!, +m[1]!, +(m[4] ?? 0), +(m[5] ?? 0)).getTime();
  // « 29/09/2026 » ou « 29/09/2026 14:01 »
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:,? (?:a )?(\d{1,2})[:h](\d{2}))?$/.exec(s);
  if (m) return new Date(+m[3]!, +m[2]! - 1, +m[1]!, +(m[4] ?? 0), +(m[5] ?? 0)).getTime();
  // « 2026-09-29 » ou « 2026-09-29T13:06… »
  m = /^(\d{4})-(\d{2})-(\d{2})(?:[t ](\d{2}):(\d{2}))?/.exec(s);
  if (m) return new Date(+m[1]!, +m[2]! - 1, +m[3]!, +(m[4] ?? 0), +(m[5] ?? 0)).getTime();
  return null;
}

function lireNombre(t: string): number | null {
  // Espaces (fines, insécables) des milliers ; unité ou symbole en queue.
  const s = t.replace(/[\s  ]/g, "");
  const m = /^([-+−]?)(\d+(?:[.,]\d+)?)(€|eur|%|g|kg|x|×|pts?|ko|mo)?$/i.exec(s);
  if (!m) return null;
  const n = Number(m[2]!.replace(",", "."));
  return m[1] === "-" || m[1] === "−" ? -n : n;
}

function valeurDe(cellule: HTMLTableCellElement | undefined): Valeur {
  if (!cellule) return { genre: "vide" };
  const brut = (cellule.dataset.tri ?? cellule.textContent ?? "").replace(/\s+/g, " ").trim();
  if (!brut || /^[—–-]$/.test(brut)) return { genre: "vide" };
  const nombre = lireNombre(brut);
  if (nombre !== null) return { genre: "nombre", v: nombre };
  const date = lireDate(brut);
  if (date !== null) return { genre: "date", v: date };
  return { genre: "texte", v: brut };
}

const compareTexte = new Intl.Collator("fr", { numeric: true, sensitivity: "base" }).compare;

function comparer(a: Valeur, b: Valeur): number {
  if (a.genre === "texte" || b.genre === "texte" || a.genre !== b.genre) {
    const ta = a.genre === "vide" ? "" : String(a.v);
    const tb = b.genre === "vide" ? "" : String(b.v);
    return compareTexte(ta, tb);
  }
  if (a.genre === "vide" || b.genre === "vide") return 0;
  return a.v - b.v;
}

/** La cellule d'une ligne sous la colonne `index`, en tenant compte des colspan. */
function celluleEn(ligne: HTMLTableRowElement, index: number): HTMLTableCellElement | undefined {
  let position = 0;
  for (const c of Array.from(ligne.cells)) {
    if (position === index) return c;
    position += c.colSpan || 1;
    if (position > index) return undefined;
  }
  return undefined;
}

/** Nombre de colonnes réelles d'une ligne (colspan compris). */
const largeur = (ligne: HTMLTableRowElement) =>
  Array.from(ligne.cells).reduce((n, c) => n + (c.colSpan || 1), 0);

function rendreTriable(table: HTMLTableElement): void {
  if (table.dataset.sansTri !== undefined || table.dataset.triPret) return;
  // La ligne d'en-têtes : la dernière du <thead>, sinon une première ligne
  // faite uniquement de <th>.
  const entete =
    table.tHead?.rows[table.tHead.rows.length - 1] ??
    (() => {
      const premiere = table.rows[0];
      return premiere && Array.from(premiere.cells).every((c) => c.tagName === "TH")
        ? premiere
        : undefined;
    })();
  if (!entete) return;
  const corps = Array.from(table.tBodies);
  if (!corps.length) return;
  table.dataset.triPret = "1";
  const colonnes = largeur(entete);

  let position = 0;
  for (const th of Array.from(entete.cells)) {
    const index = position;
    position += th.colSpan || 1;
    // Une colonne sans titre (cases à cocher, boutons) ou sur plusieurs
    // colonnes n'a rien de sûr à trier.
    if (th.colSpan > 1 || th.dataset.sansTri !== undefined || !th.textContent?.trim()) continue;
    th.dataset.triable = "1";
    th.tabIndex = 0;
    th.setAttribute("aria-sort", "none");
    th.title = th.title || "Cliquer pour trier";
    const indicateur = document.createElement("span");
    indicateur.className = "ml-tri-indicateur";
    indicateur.setAttribute("aria-hidden", "true");
    th.append(indicateur);

    const trier = () => {
      const croissant = th.getAttribute("aria-sort") !== "ascending";
      for (const autre of Array.from(entete.cells)) {
        if (autre !== th && autre.dataset.triable) autre.setAttribute("aria-sort", "none");
      }
      th.setAttribute("aria-sort", croissant ? "ascending" : "descending");

      for (const tbody of corps) {
        if (tbody === table.tHead) continue;
        // Les lignes « de détail » (moins de colonnes, souvent un colspan)
        // voyagent avec la ligne principale qui les précède.
        const groupes: { tete: HTMLTableRowElement; suite: HTMLTableRowElement[] }[] = [];
        for (const ligne of Array.from(tbody.rows)) {
          if (ligne === entete) continue;
          const principale = largeur(ligne) >= colonnes || ligne.cells.length > 1;
          if (principale || !groupes.length) groupes.push({ tete: ligne, suite: [] });
          else groupes[groupes.length - 1]!.suite.push(ligne);
        }
        const avecValeur = groupes.map((g, rang) => ({
          g,
          rang,
          v: valeurDe(celluleEn(g.tete, index)),
        }));
        avecValeur.sort((a, b) => {
          // Le vide en bas, quel que soit le sens.
          if (a.v.genre === "vide" && b.v.genre !== "vide") return 1;
          if (b.v.genre === "vide" && a.v.genre !== "vide") return -1;
          const d = comparer(a.v, b.v);
          // À égalité, l'ordre d'origine : un tri stable, prévisible.
          return (croissant ? d : -d) || a.rang - b.rang;
        });
        const fragment = document.createDocumentFragment();
        for (const { g } of avecValeur) fragment.append(g.tete, ...g.suite);
        tbody.append(fragment);
      }
    };
    th.addEventListener("click", (e) => {
      // Un lien ou un bouton dans l'en-tête garde son rôle.
      if ((e.target as HTMLElement).closest("a, button, input, select, label")) return;
      trier();
    });
    th.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        trier();
      }
    });
  }
}

export function trierLesTableaux(racine: ParentNode = document): void {
  racine.querySelectorAll("table").forEach((t) => rendreTriable(t as HTMLTableElement));
}

trierLesTableaux();
// Un tableau ajouté après coup (une section qui se déplie en JS) se trie aussi.
new MutationObserver(() => trierLesTableaux()).observe(document.body, {
  childList: true,
  subtree: true,
});
