/**
 * Les personnages du ciel étoilé : des ombres chinoises vues de dos, assises
 * dans l'herbe, la tête levée vers les étoiles.
 *
 * Leurs tracés sont vectorisés depuis les planches d'Alexandra
 * (ciel-ombres.ts, ciel-ombres-2.ts, générés), en CENTIMÈTRES réels, la base
 * sur y = 0, le haut vers les y négatifs. Le catalogue est dans
 * ciel-silhouettes-assises.ts ; ce fichier les pose sur la colline.
 *
 * Les silhouettes debout dessinées à la main (27/11 au matin) et les petits
 * détails autour du groupe (plaid, lanterne, lunette…) ont été retirés le
 * 27/11 au soir : plus rien ne les appelait (ils sont dans l'historique git).
 */

export interface Silhouette {
  id: string;
  /** Nom court, pour le BO et les essais (les libellés du site sont dans ui.ts). */
  nom: string;
  /** Le tracé, en centimètres, pieds sur y = 0. */
  d: string;
  /** Emprise : bords gauche et droit, haut (négatif), en centimètres. */
  gauche: number;
  droite: number;
  haut: number;
}

/* ------------------------------------------------------------------ */
/* Pose sur les collines                                                */
/* ------------------------------------------------------------------ */

/**
 * La hauteur (y) de la colline du premier plan à l'abscisse x — mêmes
 * courbes que svgDuCiel (ciel.ts) : si elles changent là-bas, les changer ici.
 */
export function hauteurColline(x: number, W: number, H: number): number {
  const seg = [
    [[0, 0.925], [0.22, 0.9], [0.45, 0.917], [0.62, 0.912]],
    [[0.62, 0.912], [0.79, 0.907], [0.88, 0.895], [1, 0.908]],
  ] as const;
  let prec: [number, number] | null = null;
  for (const [a, b, c, d] of seg) {
    for (let i = 0; i <= 40; i++) {
      const t = i / 40;
      const u = 1 - t;
      const px = (u * u * u * a[0] + 3 * u * u * t * b[0] + 3 * u * t * t * c[0] + t * t * t * d[0]) * W;
      const py = (u * u * u * a[1] + 3 * u * u * t * b[1] + 3 * u * t * t * c[1] + t * t * t * d[1]) * H;
      if (prec && px >= x) {
        const f = px === prec[0] ? 0 : (x - prec[0]) / (px - prec[0]);
        return prec[1] + (py - prec[1]) * f;
      }
      prec = [px, py];
    }
  }
  return 0.908 * H;
}

export interface PoseSilhouettes {
  /** Couleur pleine des silhouettes (par défaut, celle de la colline du premier plan). */
  couleur: string;
  /** Taille de l'image (celle du fond du ciel). */
  largeur: number;
  hauteur: number;
  /** Hauteur, en pixels, d'une personne de 175 cm. Par défaut 0,145 de l'image. */
  taillePx?: number;
  /** Milieu du groupe, en fraction de la largeur. Par défaut 0,5. */
  centre?: number;
  /** Écart entre deux silhouettes, en centimètres. */
  ecart?: number;
  /**
   * Une ligne que les têtes ne passent pas (y en pixels) : une silhouette qui
   * se tient entre `x0` et `x1` (toute la largeur s'ils manquent) garde son
   * sommet sous `y`, et tout le groupe rapetisse d'autant, à la même échelle
   * (27/11, relecture : « les têtes du couple passent sur 2 NOVEMBRE 1990 »,
   * « les silhouettes coupent Passion • Détermination • Magnétisme »).
   */
  plafond?: { y: number; x0?: number; x1?: number };
  /** Le catalogue où chercher les ids (SILHOUETTES_ASSISES_PAR_ID). Un id absent est ignoré. */
  catalogue: ReadonlyMap<string, Silhouette>;
}

/**
 * Pose les silhouettes choisies (ids du catalogue, dans l'ordre, de gauche
 * à droite) sur la colline du premier plan : toutes à la même échelle,
 * espacées, chacune les pieds sur la pente à l'endroit où elle se tient.
 * Rend un <g> à glisser à la fin du SVG du ciel ; "" si rien n'est choisi.
 */
export function poserSilhouettes(choix: readonly string[], o: PoseSilhouettes): string {
  // « id:m » = le personnage retourné en miroir (27/11, Alexandra : « pouvoir
  // inverser le sens des personnages ») : ses bords s'échangent, et il se
  // dessine avec scale(-s, s).
  const liste = choix
    .map((choisi) => {
      const [id, sens] = choisi.split(":");
      const x = o.catalogue.get(id ?? "");
      if (!x) return null;
      return sens === "m" ? { ...x, gauche: -x.droite, droite: -x.gauche, miroir: true } : { ...x, miroir: false };
    })
    .filter((x): x is Silhouette & { miroir: boolean } => !!x);
  if (!liste.length) return "";
  // 0,145 de la hauteur (au lieu de 0,125) : un peu plus grandes, les
  // silhouettes se lisent mieux sur le tirage (27/11).
  const ecart = o.ecart ?? 14;
  const total = liste.reduce((t, x) => t + (x.droite - x.gauche), 0) + ecart * (liste.length - 1);
  // Chaque silhouette : où elle se tient, à l'échelle s.
  const places = (s: number) => {
    let curseur = (o.centre ?? 0.5) * o.largeur - (total * s) / 2;
    return liste.map((x) => {
      const tx = curseur - x.gauche * s;
      // Les pieds s'enfoncent de 3 cm dans l'herbe : posés pile sur la courbe,
      // ils sembleraient flotter là où la pente descend.
      const sol = hauteurColline(tx, o.largeur, o.hauteur);
      curseur += (x.droite - x.gauche + ecart) * s;
      return { x, tx, sol };
    });
  };
  let s = (o.taillePx ?? o.hauteur * 0.145) / 175;
  // Plusieurs scènes côte à côte (27/11 au soir, jusqu'à 4, chevaux compris) :
  // le groupe tient toujours dans 92 % de la largeur.
  if (total * s > 0.92 * o.largeur) s = (0.92 * o.largeur) / total;
  // Sous un plafond (27/11) : on rapetisse jusqu'à ce que plus aucune tête
  // concernée ne le passe. Un groupe plus petit est plus étroit, et peut
  // sortir de la bande : quelques tours suffisent, l'échelle ne fait que
  // descendre.
  const p = o.plafond;
  if (p) {
    for (let tour = 0; tour < 12; tour++) {
      let permise = s;
      for (const { x, tx, sol } of places(s)) {
        const g = tx + x.gauche * s;
        const d = tx + x.droite * s;
        if (d < (p.x0 ?? -Infinity) || g > (p.x1 ?? Infinity)) continue;
        // Sommet : sol + 3 s + haut s (haut < 0), à garder sous p.y.
        permise = Math.min(permise, Math.max(0.05, (sol - p.y) / -(x.haut + 3)));
      }
      if (permise >= s - 1e-6) break;
      s = permise;
    }
  }
  const posees = places(s);
  const chemins = posees.map(({ x, tx, sol }) => {
    const ty = sol + 3 * s;
    return `<path transform="translate(${tx.toFixed(1)} ${ty.toFixed(1)}) scale(${x.miroir ? `-${s.toFixed(4)} ${s.toFixed(4)}` : s.toFixed(4)})" d="${x.d}"/>`;
  });
  return `<g fill="${o.couleur}" data-silhouettes="1">${chemins.join("")}</g>`;
}
