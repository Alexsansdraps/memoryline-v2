/**
 * Recoloration des SVG d'assets par zones (§18.1 D).
 *
 * Les SVG Memory Line définissent leurs couleurs via des classes CSS
 * `.st0{fill:#BA6821;}` dans un bloc <style>. Recolorier = remplacer la
 * valeur `fill` de chaque classe ciblée. Pure string-transform → fonctionne
 * côté navigateur (configurateur) ET côté serveur (worker PDF), sans DOM.
 */

/** Extrait les zones { st0: "#BA6821", … } d'un SVG (mêmes règles que le seed). */
export function extractColorZones(svg: string): Record<string, string> {
  const zones: Record<string, string> = {};
  const re = /\.(st\d+)\s*\{\s*fill\s*:\s*(#[0-9a-fA-F]{3,8})/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(svg)) !== null) zones[m[1]!] = m[2]!.toUpperCase();
  return zones;
}

/**
 * Applique des couleurs personnalisées à un SVG.
 * `overrides` : { st0: "#ff0000", … } — seules les zones présentes sont changées.
 * Réécrit la déclaration `fill` dans le bloc <style> pour chaque classe ciblée.
 */
export function recolorSvg(
  svg: string,
  overrides: Record<string, string>,
): string {
  let out = svg;
  for (const [zone, color] of Object.entries(overrides)) {
    if (!/^#[0-9a-fA-F]{3,8}$/.test(color)) continue; // garde-fou: hex only
    // .st0{fill:#XXXXXX} -> .st0{fill:<color>}  (tolère espaces/casse)
    const re = new RegExp(
      `(\\.${zone}\\s*\\{[^}]*?fill\\s*:\\s*)#[0-9a-fA-F]{3,8}`,
      "g",
    );
    out = out.replace(re, `$1${color}`);
  }
  return out;
}

/** Normalise un id de zone (sécurité : seules les clés stN sont acceptées). */
export function isValidZone(zone: string): boolean {
  return /^st\d+$/.test(zone);
}

/* -------------------------------------------------------------------------- */
/*  Couleurs namespacées par couche (base / slot)                              */
/* -------------------------------------------------------------------------- */

/**
 * Les zones `.stN` n'ont PAS la même sémantique d'une couche à l'autre : la
 * base et les variantes de slots (vêtements, pantalon, cheveux…) réutilisent
 * les mêmes numéros. Une map plate { st0: "#hex" } recolore donc TOUTES les
 * couches à la fois (crosstalk : choisir un rouge vêtements teinte aussi le
 * pantalon et les cheveux). Les couleurs d'un personnage sont donc stockées
 * sous des clés namespacées `<scope>:<zone>` (ex. "clothes:st0", "base:st1"),
 * où le scope est {@link BASE_COLOR_SCOPE} pour le SVG de base ou le nom du
 * slot pour une variante.
 */
export const BASE_COLOR_SCOPE = "base";

/** Clé de couleur namespacée pour une zone d'une couche donnée. */
export function colorKey(scope: string, zone: string): string {
  return `${scope}:${zone}`;
}

/**
 * Extrait, pour UNE couche (scope), la map plate { stN: "#hex" } à passer à
 * {@link recolorSvg}. Les clés plates sans `:` (anciens configs / paniers
 * sauvegardés avant le namespacing) s'appliquent à toutes les couches
 * (comportement historique) ; les clés namespacées du scope les surchargent.
 */
export function colorsForScope(
  colors: Record<string, string> | undefined | null,
  scope: string,
): Record<string, string> {
  const out: Record<string, string> = {};
  if (!colors) return out;
  for (const [key, hex] of Object.entries(colors)) {
    if (!key.includes(":")) out[key] = hex; // legacy plat -> toutes les couches
  }
  const prefix = `${scope}:`;
  for (const [key, hex] of Object.entries(colors)) {
    if (key.startsWith(prefix)) out[key.slice(prefix.length)] = hex;
  }
  return out;
}

/**
 * Mots-clés des groupes du SVG de BASE d'un personnage, par slot.
 * Nomenclature archive : `<g id="Male_Clothes_1">`, `<g id="Female_Bottoms1">`,
 * `<g id="Teenage_Girl_Hair_1">`… Les groupes "Base" et "Collar" (animaux) ne
 * matchent aucun mot-clé et ne sont jamais masqués.
 */
const SLOT_GROUP_KEYWORD: Record<string, RegExp> = {
  clothes: /Clothes/i,
  pants: /Bottoms/i,
  hair: /Hair/i,
  accessory: /Accessor/i,
  // alias legacy (ancien site : head = accessoires)
  head: /Accessor/i,
};

/**
 * Masque (display="none") dans le SVG de BASE pré-composé les groupes des
 * slots REMPLACÉS par une variante choisie. Sans ça, la tenue/coiffure
 * d'origine du personnage reste visible sous/derrière la variante empilée
 * (doublons, bords qui dépassent). Pure string-transform : utilisable côté
 * navigateur (configurateur) ET côté serveur (worker PDF).
 */
export function hideSlotGroups(
  svg: string,
  slots: readonly string[],
): string {
  const patterns = slots
    .map((s) => SLOT_GROUP_KEYWORD[s])
    .filter((re): re is RegExp => re !== undefined);
  if (patterns.length === 0) return svg;
  return svg.replace(/<g\b([^>]*)>/g, (m, attrs: string) => {
    const id = /\sid\s*=\s*"([^"]*)"/.exec(attrs)?.[1];
    if (id && patterns.some((re) => re.test(id)))
      return `<g${attrs} display="none">`;
    return m;
  });
}

/**
 * Scope les règles CSS d'un SVG destiné à être INLINÉ dans le DOM.
 *
 * Problème : chaque SVG exporté définit ses couleurs via un bloc
 * `<style>.st0{fill:…}</style>`. Une fois plusieurs SVG inlinés dans la même
 * page (base + vêtements + cheveux…), ces règles sont GLOBALES au document :
 * le dernier bloc `<style>` gagne pour toutes les couches → les recolorations
 * ne s'affichent pas (ou s'appliquent aux mauvaises couches).
 *
 * Solution : on pose `data-svg-scope="<uid>"` sur la balise <svg> racine et on
 * préfixe chaque sélecteur du bloc <style> par `[data-svg-scope="<uid>"] ` —
 * les règles ne matchent plus que les éléments de CE svg, et leur spécificité
 * bat les règles non préfixées d'un éventuel SVG tiers.
 *
 * Inutile côté serveur (le worker PDF rasterise chaque couche isolément) ;
 * indispensable côté navigateur avant toute injection innerHTML.
 */
export function scopeSvgStyles(svg: string, uid: string): string {
  const safe = uid.replace(/[^a-zA-Z0-9_-]/g, "-");
  let out = svg.replace(
    /<svg\b([^>]*)>/,
    (_m, attrs: string) => `<svg${attrs} data-svg-scope="${safe}">`,
  );
  out = out.replace(
    /(<style[^>]*>)([\s\S]*?)(<\/style>)/g,
    (_m, open: string, css: string, close: string) => {
      const scoped = css.replace(
        /(^|\})\s*([^{}@][^{}]*)\{/g,
        (_m2, brace: string, selectors: string) => {
          const prefixed = selectors
            .split(",")
            .map((s) => `[data-svg-scope="${safe}"] ${s.trim()}`)
            .join(",");
          return `${brace}${prefixed}{`;
        },
      );
      return open + scoped + close;
    },
  );
  return out;
}
