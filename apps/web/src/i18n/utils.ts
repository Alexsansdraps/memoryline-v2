import {
  ui,
  LANGUES,
  LANGUE_DEFAUT,
  LOCALE_COMPLETE,
  NOM_LANGUE,
  type Langue,
  type CleUi,
} from "./ui";

export { LANGUES, LANGUE_DEFAUT, LOCALE_COMPLETE, NOM_LANGUE };
export type { Langue, CleUi };

/** Vrai si la valeur est une des langues gérées. */
export function estLangue(v: unknown): v is Langue {
  return typeof v === "string" && (LANGUES as readonly string[]).includes(v);
}

/**
 * Langue déduite du segment d'URL.
 *
 * Le FRANÇAIS n'a pas de préfixe : il reste à la racine (`/affiches`), pour ne
 * pas casser les URLs existantes ni les redirections mises en place depuis
 * l'ancien site Shopify. Les autres langues sont préfixées (`/en/affiches`).
 */
export function langueDepuisParam(param?: string | undefined): Langue {
  const brut = (param ?? "").replace(/^\/+|\/+$/g, "");
  return estLangue(brut) ? brut : LANGUE_DEFAUT;
}

/**
 * Traducteur d'une langue donnée.
 *
 * Une clé absente de la langue demandée retombe sur le français : un oubli de
 * traduction se voit à l'écran en français, jamais sous forme de clé technique.
 */
export function t(langue: Langue): (cle: CleUi) => string {
  const dico = ui[langue] as Record<string, string>;
  const repli = ui[LANGUE_DEFAUT] as Record<string, string>;
  return (cle: CleUi) => dico[cle] ?? repli[cle] ?? String(cle);
}

/** Chemin interne préfixé par la langue (le français reste à la racine). */
export function lien(langue: Langue, chemin: string): string {
  const c = chemin.startsWith("/") ? chemin : `/${chemin}`;
  if (langue === LANGUE_DEFAUT) return c;
  return c === "/" ? `/${langue}` : `/${langue}${c}`;
}

/** Même page dans les autres langues — pour le sélecteur et les hreflang. */
export function autresVersions(
  langue: Langue,
  cheminSansLangue: string,
): { langue: Langue; nom: string; href: string; actuelle: boolean }[] {
  return LANGUES.map((l) => ({
    langue: l,
    nom: NOM_LANGUE[l],
    href: lien(l, cheminSansLangue),
    actuelle: l === langue,
  }));
}

/**
 * Retire le préfixe de langue d'un chemin : `/en/affiches` -> `/affiches`.
 * Sert à reconstruire la même page dans une autre langue.
 */
export function cheminSansLangue(pathname: string): string {
  const m = pathname.match(/^\/([a-z]{2})(\/|$)/);
  if (m && estLangue(m[1])) {
    const reste = pathname.slice(m[1]!.length + 1);
    return reste || "/";
  }
  return pathname || "/";
}

/**
 * Les libellés d'un îlot, traduits d'avance par la page qui le monte.
 *
 * Un îlot qui importe t() fait télécharger au navigateur le dictionnaire des
 * cinq langues (i18n/ui.ts, près de 200 Ko) avant de pouvoir afficher son
 * bouton. Pour quelques mots, la page les traduit sur le serveur et les lui
 * passe en props : c'est ainsi que font la pastille du panier, la lettre
 * d'information et les boutons de la fiche (AUDIT-SEO.md, VIT-2).
 */
export function libelles<K extends CleUi>(langue: Langue, cles: readonly K[]): Record<K, string> {
  const tr = t(langue);
  return Object.fromEntries(cles.map((c) => [c, tr(c)])) as Record<K, string>;
}
