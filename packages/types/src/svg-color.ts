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
