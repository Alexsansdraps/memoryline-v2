/// <reference lib="dom" />

/**
 * Filigrane posé PAR-DESSUS l'affiche : un cercle fin au centre, et le logo de
 * la boutique à l'intérieur, en blanc presque transparent.
 *
 * Il est DANS l'aperçu, pas autour : une capture d'écran de l'affiche emporte
 * le filigrane avec elle. C'est toute la raison d'être de cette couche — un
 * bandeau posé à côté de l'image ne protégerait rien.
 *
 * UN SEUL MOTIF, AU CENTRE. Le logo était auparavant répété en diagonale sur
 * toute la surface, souligné d'une ombre sombre : il protégeait bien, mais il
 * couvrait l'affiche que la cliente venait composer, jusque sur les visages
 * et les prénoms. Un cercle au milieu protège autant — on ne recadre pas une
 * affiche en coupant son centre — et laisse voir le travail.
 *
 * Plus d'ombre non plus : elle rendait le filigrane lisible sur un ciel de
 * neige, mais le faisait peser partout ailleurs. La discrétion est voulue.
 *
 * Le repère du SVG suit l'affiche (viewBox au ratio A4 portrait) : le cercle
 * garde la même place et la même proportion sur la vignette de 80 px du panier
 * comme sur l'aperçu plein écran du configurateur.
 */

/** Chemin public du logo, servi par le site depuis apps/web/public. */
const LOGO_FILIGRANE = "/logo-filigrane.png";

/** Le repère de l'affiche : 1000 de large, 1414 de haut (1:√2). */
const LARGEUR = 1000;
const HAUTEUR = 1414;

/** Le cercle : 40 % de la largeur de l'affiche, centré. */
const CENTRE_X = LARGEUR / 2;
const CENTRE_Y = HAUTEUR / 2;
const RAYON = 200;

/** Le logo fait 500×222 : on garde son rapport, à 60 % du diamètre. */
const LOGO_LARGEUR = 240;
const LOGO_HAUTEUR = Math.round((LOGO_LARGEUR * 222) / 500);

export function Filigrane() {
  return (
    <svg
      viewBox={`0 0 ${LARGEUR} ${HAUTEUR}`}
      preserveAspectRatio="none"
      aria-hidden="true"
      style={{
        position: "absolute",
        inset: "0",
        width: "100%",
        height: "100%",
        "pointer-events": "none",
        "user-select": "none",
        // Au-dessus de TOUTES les couches de l'affiche, textes compris (z=200).
        "z-index": "300",
      }}
    >
      <circle
        cx={CENTRE_X}
        cy={CENTRE_Y}
        r={RAYON}
        fill="none"
        stroke="#ffffff"
        stroke-width="2"
        stroke-opacity="0.5"
        // Le trait garde son épaisseur quand l'aperçu rétrécit : sans cela,
        // le cercle disparaîtrait à la taille d'une vignette de panier.
        vector-effect="non-scaling-stroke"
      />
      <image
        href={LOGO_FILIGRANE}
        x={CENTRE_X - LOGO_LARGEUR / 2}
        y={CENTRE_Y - LOGO_HAUTEUR / 2}
        width={LOGO_LARGEUR}
        height={LOGO_HAUTEUR}
        opacity="0.4"
      />
    </svg>
  );
}
